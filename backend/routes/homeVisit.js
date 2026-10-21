/**
 * Home Visit Routes
 * POST /api/homevisit/request           - Student submits request
 * POST /api/homevisit/parent-approve    - Parent approves/rejects
 * POST /api/homevisit/warden-approve    - Warden approves/rejects
 * GET  /api/homevisit/list              - Warden views all requests
 * GET  /api/homevisit/my               - Student views their requests
 * POST /api/homevisit/scan              - Gate scan for home visit QR
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const HomeVisitLog = require('../models/HomeVisitLog');
const GatePass = require('../models/GatePass');
const User = require('../models/User');
const Guardian = require('../models/Guardian');
const ParentApproval = require('../models/ParentApproval');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const { protect, authorize } = require('../middleware/auth');
const {
  validateQR,
  normalizeScannedToken,
} = require('../services/qrService');
const { enqueueWhatsAppMessage } = require('../queues/whatsappQueue');
const {
  issueHomeVisitGatePass,
  findHomeVisitByScanToken,
  createHomeVisitCompactToken,
} = require('../services/homeVisitQrService');
const { normalizeToE164 } = require('../utils/phone');
const { validatePlaceGeo } = require('../utils/placeValidator');
const { sendLeaveRequestEmail, sendLeaveOutcomeEmailToStudent } = require('../services/mailService');
const { recordStaffPhoneOverride } = require('../services/parentApprovalService');
const logger = require('../utils/logger');
const { recordDeletionAudit } = require('../services/storageStatsService');
const { getLogsCache, setLogsCache, invalidateLogsCache } = require('../services/logsCache');
const {
  generateParentApprovalToken,
  hashParentToken,
  verifyTokenHash,
} = require('../utils/parentToken');
const {
  sendParentApprovalEmail,
  sendViaGoogleAppsScript,
} = require('../services/gasMailService');

const ACTIVE_HOME_VISIT_STATUSES = ['pending', 'parent_approved', 'approved'];
const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const parseLocalDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const getMaxReturnDateFromLeave = (leaveDateStr) => {
  const leaveDate = parseLocalDate(leaveDateStr);
  leaveDate.setDate(leaveDate.getDate() + 105);
  return formatLocalDate(leaveDate);
};
const getMaxLeaveDateFromToday = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return formatLocalDate(d);
};
const buildOverlappingVisitFilter = (studentId, leaveDate, returnDate) => ({
  student_id: studentId,
  overall_status: { $in: ACTIVE_HOME_VISIT_STATUSES },
  leave_date: { $lte: returnDate },
  return_date: { $gte: leaveDate },
});
const getPagination = (query, defaultLimit = 25, maxLimit = 100) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── Student: Submit Home Visit Request ───────────────────────────────────────
router.post('/request', protect, authorize('student'), async (req, res) => {
  try {
    const { reason, leave_date, return_date, place } = req.body;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!reason || !leave_date || !return_date || !place || !(await validatePlaceGeo(place))) {
      return res.status(400).json({ success: false, message: 'Reason, leave date, return date, and a valid destination place are required (real city, town, village, or place name)' });
    }

    if (!dateRegex.test(leave_date) || !dateRegex.test(return_date)) {
      return res.status(400).json({ success: false, message: 'Dates must be in YYYY-MM-DD format' });
    }

    if (return_date <= leave_date) {
      return res.status(400).json({ success: false, message: 'Return date must be after leave date' });
    }

    const today = formatLocalDate(new Date());
    if (leave_date < today || return_date < today) {
      return res.status(400).json({ success: false, message: 'Leave and return dates cannot be before today' });
    }

    const maxLeaveDate = getMaxLeaveDateFromToday();
    if (leave_date > maxLeaveDate) {
      return res.status(400).json({
        success: false,
        message: 'Leave date cannot be more than 1 month in the future',
      });
    }

    const maxReturnDate = getMaxReturnDateFromLeave(leave_date);
    if (return_date > maxReturnDate) {
      return res.status(400).json({
        success: false,
        message: `Return date cannot exceed 3.5 months from leave date. Maximum allowed return date is ${maxReturnDate}.`,
      });
    }

    const overlappingVisit = await HomeVisitLog.findOne(
      buildOverlappingVisitFilter(req.user._id, leave_date, return_date)
    )
      .sort({ createdAt: -1 })
      .lean();

    if (overlappingVisit) {
      if (req.body.cancel_previous === true) {
        if (overlappingVisit.qr_used_out) {
          return res.status(400).json({
            success: false,
            message: 'Cannot cancel previous pass because it has already been scanned out at the campus gate.',
          });
        }
        await HomeVisitLog.updateMany(
          buildOverlappingVisitFilter(req.user._id, leave_date, return_date),
          {
            $set: {
              overall_status: 'rejected',
              parent_approval_status: 'parent_rejected',
              warden_status: 'rejected',
            },
          }
        );

        await GatePass.updateMany(
          { student_id: req.user._id, pass_type: 'HOME_VISIT', status: { $in: ['PENDING', 'APPROVED', 'AWAITING_APPROVAL'] } },
          { $set: { status: 'CANCELLED' } }
        ).catch(() => {});

        await ApprovalAuditLog.create({
          event: 'REQUEST_CANCELLED_BY_STUDENT_FOR_NEW_REQUEST',
          home_visit_request_id: overlappingVisit._id,
          student_id: req.user._id,
          actor_id: req.user._id,
          actor_role: 'student',
          actor_email: req.user.email,
          ip_address: req.ip,
        }).catch(() => {});
      } else {
        return res.status(409).json({
          success: false,
          overlappingVisitId: overlappingVisit._id,
          canCancel: !overlappingVisit.qr_used_out,
          conflictDates: {
            leave_date: overlappingVisit.leave_date,
            return_date: overlappingVisit.return_date,
          },
          message: `An active home visit already exists for ${overlappingVisit.leave_date} to ${overlappingVisit.return_date}. Complete or cancel the existing pass before creating another overlapping one.`,
        });
      }
    }

    // 1. Resolve parent contact details strictly from registered guardians or verified records
    let parentEmail = null;
    let parentName = '';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const registeredGuardians = await Guardian.find({
      student_id: req.user._id,
      status: { $ne: 'REVOKED' },
    }).sort({ guardian_slot: 1 }).lean();

    const allowedGuardianEmails = registeredGuardians.map((g) => g.email.toLowerCase());
    if (req.user.parentEmail && emailRegex.test(req.user.parentEmail)) {
      allowedGuardianEmails.push(req.user.parentEmail.toLowerCase());
    }

    if (req.body.parent_email && emailRegex.test(String(req.body.parent_email).trim())) {
      const chosenEmail = String(req.body.parent_email).trim().toLowerCase();
      const matchedGuardian = registeredGuardians.find((g) => g.email.toLowerCase() === chosenEmail);

      if (matchedGuardian) {
        parentEmail = matchedGuardian.email;
        parentName = matchedGuardian.name;
      } else if (allowedGuardianEmails.includes(chosenEmail)) {
        parentEmail = chosenEmail;
        parentName = req.body.parent_name || req.user.parentName || 'Parent / Guardian';
      } else if (allowedGuardianEmails.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Please select one of your registered parent email addresses on file.',
        });
      } else {
        parentEmail = chosenEmail;
        parentName = String(req.body.parent_name || '').trim();
      }
    } else {
      const primaryGuardian = registeredGuardians[0];
      if (primaryGuardian && primaryGuardian.email) {
        parentEmail = primaryGuardian.email.trim().toLowerCase();
        parentName = primaryGuardian.name || '';
      } else if (req.user.parentEmail && emailRegex.test(req.user.parentEmail)) {
        parentEmail = req.user.parentEmail.trim().toLowerCase();
        parentName = req.user.parentName || '';
      }
    }

    if (parentEmail) {
      await User.findByIdAndUpdate(req.user._id, {
        parentEmail,
        ...(parentName ? { parentName } : {}),
      }).catch(() => {});

      try {
        const existingGuardian = await Guardian.findOne({ student_id: req.user._id, guardian_slot: 1 });
        if (!existingGuardian) {
          await Guardian.create({
            student_id: req.user._id,
            guardian_slot: 1,
            name: parentName || 'Parent / Guardian',
            relationship: 'Guardian',
            phone: req.user.parentPhone || '+919999999999',
            email: parentEmail,
            status: 'ACTIVE',
          });
        } else if (!existingGuardian.email || existingGuardian.email !== parentEmail) {
          existingGuardian.email = parentEmail;
          if (parentName) existingGuardian.name = parentName;
          await existingGuardian.save();
        }
      } catch (gErr) {
        logger.warn('[HomeVisit] Guardian sync error:', gErr.message);
      }
    }

    // 2. Generate cryptographically random, high-entropy approval token (stored as SHA-256 hash)
    const { rawToken, tokenHash, expiresAt } = generateParentApprovalToken();

    // 3. Create the request record with a unique persistent gate token and pending statuses
    const studentPhoto = req.user.studentPhoto || (req.user.picture && !req.user.picture.includes('googleusercontent.com') ? req.user.picture : null) || req.user.picture || null;
    const persistentToken = createHomeVisitCompactToken();
    const visit = await HomeVisitLog.create({
      student_id: req.user._id,
      reason,
      leave_date,
      return_date,
      place: String(place).trim().slice(0, 200),
      name: req.user.name,
      rollNo: req.user.rollNo || '',
      student_photo: studentPhoto,
      parent_phone: req.user.parentPhone ? normalizeToE164(req.user.parentPhone) : null,
      parent_phone_alt: req.user.parentPhone2 ? normalizeToE164(req.user.parentPhone2) : null,
      parent_email: parentEmail,
      parent_name: parentName,
      departure_time: req.body.departure_time || '09:00 AM',
      return_time: req.body.return_time || '08:00 PM',
      parent_token_hash: tokenHash,
      parent_token_expires_at: expiresAt,
      parent_approval_status: 'pending',
      warden_status: 'pending',
      overall_status: 'pending',
      email_notification_status: parentEmail ? 'PENDING' : 'FAILED',
      email_failure_reason: parentEmail ? null : 'No registered parent email address found for student',
      qr_token: persistentToken,
      accompanying: req.body.accompanying ? String(req.body.accompanying).trim().slice(0, 100) : '',
    });

    // Mirror to GatePass for single MongoDB source of truth
    await GatePass.create({
      student_id: req.user._id,
      pass_type: 'HOME_VISIT',
      home_visit_id: visit._id,
      qr_token: persistentToken,
      status: 'PENDING',
      place: visit.place,
      reason: visit.reason,
    }).catch((gpErr) => console.warn('[HomeVisit] GatePass creation notice:', gpErr.message));

    // 4. Automated Parent Email Notification via Google Apps Script (Free Tier)
    let emailDispatchSuccess = false;
    let approvalPageUrl = null;

    if (parentEmail) {
      try {
        const baseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'https://iiitpune-hosteel-gate-management.vercel.app';
        const emailResult = await sendParentApprovalEmail({
          visit,
          rawToken,
          parentEmail,
          baseUrl,
        });

        approvalPageUrl = emailResult.approvalUrl;

        if (emailResult.success) {
          emailDispatchSuccess = true;
          visit.email_notification_status = 'SUBMITTED';
          visit.email_sent_at = new Date();
          visit.email_failure_reason = null;
        } else {
          visit.email_notification_status = 'FAILED';
          visit.email_failure_reason = emailResult.error || 'Failed to dispatch email via Google Apps Script';
        }
        await visit.save();

        ApprovalAuditLog.create({
          event: 'REQUEST_NOTIFIED',
          home_visit_request_id: visit._id,
          student_id: req.user._id,
          actor_id: req.user._id,
          actor_role: 'student',
          actor_email: req.user.email,
          ip_address: req.ip,
          details: {
            parentEmail,
            notificationStatus: visit.email_notification_status,
            error: visit.email_failure_reason,
          },
        }).catch(() => {});
      } catch (notifyErr) {
        logger.warn('[HomeVisit] Parent notification dispatch error:', notifyErr.message);
        visit.email_notification_status = 'FAILED';
        visit.email_failure_reason = notifyErr.message;
        await visit.save();
      }
    }

    const cleanVisit = visit.toObject ? visit.toObject() : { ...visit };
    delete cleanVisit.parent_token_hash; // Never expose token hash to client

    res.status(201).json({
      success: true,
      message: parentEmail
        ? `Home visit request submitted. Digital approval notification sent to parent (${parentEmail}).`
        : 'Home visit request submitted. Note: No parent email is registered; please notify warden.',
      parentEmail,
      emailSent: emailDispatchSuccess,
      email_notification_status: visit.email_notification_status,
      visit: cleanVisit,
    });
  } catch (error) {
    console.error('Home visit request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden: Confirm parent call ───────────────────────────────────────────────
router.post('/warden-confirm-call', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { visit_id } = req.body;
    if (!visit_id) return res.status(400).json({ success: false, message: 'visit_id is required' });

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.overall_status !== 'pending' || visit.warden_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending requests can be confirmed' });
    }

    visit.parent_call_confirmed = true;
    visit.parent_call_confirmed_at = new Date();
    visit.parent_call_confirmed_by = req.user._id;
    await visit.save();

    res.json({ success: true, message: 'Parent call confirmed', visit });
  } catch (error) {
    console.error('Warden confirm call error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Staff Manual Phone Confirmation Override ─────────────────────────────────
// Allows staff to manually confirm parent permission via phone call when parents
// have no internet, emergency, or did not respond. Works even when no guardian is linked.
router.post('/staff-phone-override', protect, authorize('warden', 'hostel_staff', 'admin'), async (req, res) => {
  try {
    const { visit_id, guardian_id, contact_name, contact_phone, override_reason } = req.body;
    if (!visit_id) {
      return res.status(400).json({ success: false, message: 'visit_id is required' });
    }

    const result = await recordStaffPhoneOverride({
      visitId: visit_id,
      staffUser: req.user,
      guardianId: guardian_id || null,
      contactName: contact_name || '',
      contactPhone: contact_phone || '',
      overrideReason: override_reason || '',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
    });

    return res.json({
      success: true,
      message: 'Staff phone confirmation override applied successfully.',
      ...result,
    });
  } catch (err) {
    logger.warn('[HomeVisit] Staff phone override error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ─── Public: Verify Token & Fetch Visit Details for Parent Approval Page ─────
// SAFE GET: Strictly read-only, never mutates state. Safe for email link scanners/bots.
router.get('/parent-verify/:visitId', async (req, res) => {
  try {
    const { visitId } = req.params;
    const rawToken = String(req.query.token || '').trim();

    if (!visitId || !mongoose.isValidObjectId(visitId)) {
      return res.status(400).json({ success: false, message: 'Invalid home visit request link' });
    }

    const visit = await HomeVisitLog.findById(visitId).populate(
      'student_id',
      'name rollNo hostel roomNo studentPhoto picture parentPhone'
    );

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Home visit request not found or link is invalid' });
    }

    const isExpired = Boolean(visit.parent_token_expires_at && new Date() > new Date(visit.parent_token_expires_at));
    const isDecided = visit.parent_approval_status !== 'pending';

    // If still pending, verify the cryptographic token hash to prevent unauthorized access
    if (!isDecided && !isExpired) {
      if (!rawToken) {
        return res.status(401).json({
          success: false,
          invalidToken: true,
          message: 'Approval token is missing from the link. Please use the original link from your email.',
        });
      }
      const tokenHash = hashParentToken(rawToken);
      if (!visit.parent_token_hash || !verifyTokenHash(visit.parent_token_hash, tokenHash)) {
        return res.status(403).json({
          success: false,
          invalidToken: true,
          message: 'Invalid or unauthorized approval token. Please check the link from your email.',
        });
      }
    }

    return res.json({
      success: true,
      visit: {
        _id: visit._id,
        studentName: visit.student_id?.name || visit.name,
        studentId: visit.student_id?.rollNo || visit.rollNo || 'N/A',
        hostel: visit.student_id?.hostel || visit.hostel || 'Hostel Campus',
        roomNo: visit.student_id?.roomNo || visit.roomNo || 'N/A',
        studentPhoto: visit.student_id?.studentPhoto || visit.student_photo || visit.student_id?.picture || null,
        place: visit.place || 'Home',
        reason: visit.reason,
        leave_date: visit.leave_date,
        departure_time: visit.departure_time || '09:00 AM',
        return_date: visit.return_date,
        return_time: visit.return_time || '08:00 PM',
        parent_approval_status: visit.parent_approval_status || 'pending',
        warden_status: visit.warden_status || 'pending',
        overall_status: visit.overall_status || 'pending',
        alreadyDecided: isDecided,
        decision: visit.parent_approval_status,
        expired: isExpired,
        createdAt: visit.createdAt,
      },
    });
  } catch (err) {
    logger.error('[HomeVisit] parent-verify error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Public: Fetch Visit Details (Legacy endpoint maintained for compatibility)
router.get('/public-details/:visitId', async (req, res) => {
  try {
    const { visitId } = req.params;
    if (!visitId || !mongoose.isValidObjectId(visitId)) {
      return res.status(400).json({ success: false, message: 'Invalid visit request link' });
    }

    const visit = await HomeVisitLog.findById(visitId).populate(
      'student_id',
      'name rollNo hostel roomNo studentPhoto picture parentPhone'
    );
    if (!visit) {
      return res.status(404).json({ success: false, message: 'Home visit request not found or expired' });
    }

    const isExpired = Boolean(visit.parent_token_expires_at && new Date() > new Date(visit.parent_token_expires_at));
    const isDecided = visit.parent_approval_status !== 'pending';

    return res.json({
      success: true,
      visit: {
        _id: visit._id,
        studentName: visit.student_id?.name || visit.name,
        studentId: visit.student_id?.rollNo || visit.rollNo,
        hostel: visit.student_id?.hostel || visit.hostel || 'Hostel Campus',
        roomNo: visit.student_id?.roomNo || visit.roomNo || 'N/A',
        studentPhoto: visit.student_id?.studentPhoto || visit.student_photo || visit.student_id?.picture || null,
        place: visit.place || 'Home',
        reason: visit.reason,
        leave_date: visit.leave_date,
        departure_time: visit.departure_time || '09:00 AM',
        return_date: visit.return_date,
        return_time: visit.return_time || '08:00 PM',
        parent_approval_status: visit.parent_approval_status || visit.parent_status || 'pending',
        overall_status: visit.overall_status,
        alreadyDecided: isDecided,
        decision: visit.parent_approval_status,
        expired: isExpired,
        createdAt: visit.createdAt,
      },
    });
  } catch (err) {
    logger.error('[HomeVisit] Failed to fetch public details:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Public: Parent Decision Submission (Single-Use Token Authenticated) ──────
// Atomic findOneAndUpdate prevents race conditions and replay attacks.
router.post('/parent-respond', async (req, res) => {
  try {
    const { visit_id, token, action, decision, remarks } = req.body;
    const finalAction = (action || decision || '').trim().toLowerCase();

    if (!visit_id || !mongoose.isValidObjectId(visit_id)) {
      return res.status(400).json({ success: false, message: 'Valid visit_id is required' });
    }
    if (!['approve', 'reject'].includes(finalAction)) {
      return res.status(400).json({ success: false, message: "Action must be 'approve' or 'reject'" });
    }
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Approval token is required to submit your decision' });
    }

    const tokenHash = hashParentToken(token.trim());
    const isApprove = finalAction === 'approve';
    const cleanRemarks = String(remarks || '').trim().slice(0, 500);

    const updateSet = {
      parent_status: isApprove ? 'approved' : 'rejected',
      parent_approval_status: isApprove ? 'parent_approved' : 'parent_rejected',
      parent_response_time: new Date(),
      parent_decision_at: new Date(),
      final_parent_decision_at: new Date(),
      parent_decision_source: 'PARENT_EMAIL_LINK',
      parent_decision_ip: req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '',
      parent_decision_remarks: cleanRemarks,
      parent_token_hash: null, // Atomically consume token on first decision!
    };

    if (isApprove) {
      updateSet.overall_status = 'approved';
      updateSet.warden_status = 'approved';
      updateSet.warden_decision_time = new Date();
      updateSet.warden_remarks = 'Auto-approved upon verified digital parent email consent';
    } else {
      updateSet.overall_status = 'rejected';
      updateSet.warden_status = 'rejected';
      updateSet.warden_decision_time = new Date();
      updateSet.warden_remarks = 'Rejected upon parent disapproval';
    }

    // Atomic conditional update ensures concurrency safety & prevents replay
    const updatedVisit = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit_id,
        parent_token_hash: tokenHash,
        parent_approval_status: 'pending',
        parent_token_expires_at: { $gt: new Date() },
      },
      { $set: updateSet },
      { new: true }
    ).populate('student_id');

    if (!updatedVisit) {
      // Diagnostic check to return precise message
      const existing = await HomeVisitLog.findById(visit_id).lean();
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Home visit request not found' });
      }
      if (existing.parent_approval_status !== 'pending') {
        const isPrevApproved = existing.parent_approval_status === 'parent_approved';
        return res.status(400).json({
          success: false,
          alreadyDecided: true,
          message: `This request has already been ${isPrevApproved ? 'approved' : 'rejected'}. Duplicate decisions are not permitted.`,
        });
      }
      if (existing.parent_token_expires_at && new Date() > new Date(existing.parent_token_expires_at)) {
        return res.status(400).json({
          success: false,
          expired: true,
          message: 'This approval link has expired. Please contact the hostel office if you need a new approval link.',
        });
      }
      return res.status(403).json({
        success: false,
        invalidToken: true,
        message: 'Invalid or previously consumed approval link. Each link can only be used once.',
      });
    }

    try {
      if (isApprove) {
        await GatePass.findOneAndUpdate(
          { home_visit_id: updatedVisit._id },
          {
            $set: {
              status: 'APPROVED',
              approved_at: new Date(),
              place: updatedVisit.place,
              reason: updatedVisit.reason,
            },
          },
          { upsert: true }
        ).catch(() => {});

        // Pre-sync active QR in Redis / cache for immediate student & security readiness
        await syncHomeVisitActiveQR(updatedVisit, updatedVisit.qr_token).catch(() => {});
      } else {
        await GatePass.updateOne({ home_visit_id: updatedVisit._id }, { status: 'CANCELLED' }).catch(() => {});
      }

      await ApprovalAuditLog.create({
        event: 'DECISION_MADE',
        home_visit_request_id: updatedVisit._id,
        student_id: updatedVisit.student_id?._id || updatedVisit.student_id,
        actor_role: 'parent',
        actor_email: updatedVisit.parent_email || 'parent@email.link',
        ip_address: req.ip,
        details: {
          decision: isApprove ? 'APPROVED' : 'REJECTED',
          remarks: cleanRemarks,
          source: 'PARENT_EMAIL_LINK',
        },
      }).catch(() => {});

      if (updatedVisit.student_id?.email) {
        sendLeaveOutcomeEmailToStudent({
          to: updatedVisit.student_id.email,
          studentName: updatedVisit.student_id.name || updatedVisit.name,
          decision: isApprove ? 'APPROVED' : 'REJECTED',
          parentName: updatedVisit.parent_name || 'Parent / Guardian',
          remarks: cleanRemarks,
          place: updatedVisit.place,
          leaveDate: updatedVisit.leave_date,
          returnDate: updatedVisit.return_date,
        }).catch((e) => logger.warn('[HomeVisit] Student outcome email error:', e.message));
      }
    } catch (postErr) {
      logger.warn('[HomeVisit] Post-decision notification notice:', postErr.message);
    }

    return res.json({
      success: true,
      decision: isApprove ? 'APPROVED' : 'REJECTED',
      message: isApprove
        ? 'Home-visit request approved. Gate pass QR code has been generated and is now active on the student dashboard.'
        : 'Home-visit request rejected. The student will not be permitted to leave campus for this request.',
      visit: updatedVisit,
    });
  } catch (err) {
    logger.error('[HomeVisit] parent-respond error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Parent: Approve or Reject (Legacy / Fallback endpoint) ───────────────────
router.post('/parent-approve', async (req, res) => {
  try {
    const { visit_id, action, remarks, token } = req.body; // action: 'approve' | 'reject'
    if (!visit_id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be 'approve' or 'reject'" });
    }

    // If token is provided, delegate to secure parent-respond flow
    if (token) {
      req.body.decision = action;
      return router.handle(req, res);
    }

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.parent_approval_status === 'parent_approved' || visit.overall_status === 'approved') {
      return res.status(400).json({ success: false, message: 'This request has already been approved' });
    }
    if (visit.parent_approval_status === 'parent_rejected' || visit.overall_status === 'rejected') {
      return res.status(400).json({ success: false, message: 'This request has already been rejected' });
    }

    const cleanRemarks = String(remarks || '').trim().slice(0, 500);
    visit.parent_status = action === 'approve' ? 'approved' : 'rejected';
    visit.parent_approval_status = action === 'approve' ? 'parent_approved' : 'parent_rejected';
    visit.parent_response_time = new Date();
    visit.parent_decision_at = new Date();
    visit.final_parent_decision_at = new Date();
    visit.parent_decision_source = 'PARENT_PORTAL';
    visit.parent_decision_remarks = cleanRemarks;
    visit.parent_token_hash = null; // Invalidate token

    if (action === 'approve') {
      visit.warden_status = 'approved';
      visit.overall_status = 'approved';
      visit.warden_remarks = 'Auto-approved upon verified digital parent consent';
      visit.warden_decision_time = new Date();
      await GatePass.findOneAndUpdate(
        { home_visit_id: visit._id },
        {
          $set: {
            status: 'APPROVED',
            approved_at: new Date(),
            place: visit.place,
            reason: visit.reason,
          },
        },
        { upsert: true }
      ).catch(() => {});
      await syncHomeVisitActiveQR(visit, visit.qr_token).catch(() => {});

      if (visit.student_id?.email) {
        sendLeaveOutcomeEmailToStudent({
          to: visit.student_id.email,
          studentName: visit.student_id.name || visit.name,
          decision: 'APPROVED',
          parentName: visit.parent_name || 'Parent / Guardian',
          remarks: cleanRemarks,
          place: visit.place,
          leaveDate: visit.leave_date,
          returnDate: visit.return_date,
        }).catch((e) => logger.warn('[HomeVisit] Student outcome email error:', e.message));
      }
    } else {
      visit.warden_status = 'rejected';
      visit.overall_status = 'rejected';
      await GatePass.updateOne({ home_visit_id: visit._id }, { status: 'CANCELLED' }).catch(() => {});

      if (visit.student_id?.email) {
        sendLeaveOutcomeEmailToStudent({
          to: visit.student_id.email,
          studentName: visit.student_id.name || visit.name,
          decision: 'REJECTED',
          parentName: visit.parent_name || 'Parent / Guardian',
          remarks: cleanRemarks,
          place: visit.place,
          leaveDate: visit.leave_date,
          returnDate: visit.return_date,
        }).catch((e) => logger.warn('[HomeVisit] Student outcome email error:', e.message));
      }
    }

    await visit.save();

    await ApprovalAuditLog.create({
      event: 'DECISION_MADE',
      home_visit_request_id: visit._id,
      student_id: visit.student_id?._id || visit.student_id,
      actor_role: 'parent',
      actor_email: visit.parent_email || visit.parent_phone || 'parent@guardian.portal',
      ip_address: req.ip,
      details: { decision: action === 'approve' ? 'APPROVED' : 'REJECTED', remarks: cleanRemarks, source: 'PORTAL' },
    }).catch(() => {});

    return res.json({
      success: true,
      decision: action === 'approve' ? 'APPROVED' : 'REJECTED',
      message: action === 'approve'
        ? 'Home-visit request approved. Awaiting final warden authorization.'
        : 'Home-visit request rejected.',
      visit,
    });
  } catch (error) {
    logger.error('Parent approve error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Protected: Resend Parent Email Notification (Student or Staff) ───────────
router.post('/resend-notification', protect, async (req, res) => {
  try {
    const { visit_id } = req.body;
    if (!visit_id || !mongoose.isValidObjectId(visit_id)) {
      return res.status(400).json({ success: false, message: 'Valid visit_id is required' });
    }

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) {
      return res.status(404).json({ success: false, message: 'Home visit request not found' });
    }

    const isStudentOwner = req.user.role === 'student' && visit.student_id?._id?.toString() === req.user._id.toString();
    const isStaff = ['warden', 'hostel_staff', 'admin'].includes(req.user.role);

    if (!isStudentOwner && !isStaff) {
      return res.status(403).json({ success: false, message: 'Unauthorized to resend notification for this request' });
    }

    if (visit.parent_approval_status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${visit.parent_approval_status === 'parent_approved' ? 'approved' : 'rejected'} by parent.`,
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let recipientEmail = null;
    if (req.body.parent_email && emailRegex.test(String(req.body.parent_email).trim())) {
      recipientEmail = String(req.body.parent_email).trim().toLowerCase();
      visit.parent_email = recipientEmail;
      await User.findByIdAndUpdate(visit.student_id?._id || visit.student_id, { parentEmail: recipientEmail }).catch(() => {});
    } else {
      recipientEmail = visit.parent_email;
      if (!recipientEmail) {
        const guardian = await Guardian.findOne({
          student_id: visit.student_id?._id || visit.student_id,
          status: { $ne: 'REVOKED' },
        }).sort({ guardian_slot: 1 });
        if (guardian && guardian.email) {
          recipientEmail = guardian.email;
          visit.parent_email = recipientEmail;
        } else if (visit.student_id?.parentEmail && emailRegex.test(visit.student_id.parentEmail)) {
          recipientEmail = visit.student_id.parentEmail.trim().toLowerCase();
          visit.parent_email = recipientEmail;
        }
      }
    }

    if (!recipientEmail) {
      visit.email_notification_status = 'FAILED';
      visit.email_failure_reason = 'No registered parent email address found';
      await visit.save();
      return res.status(400).json({
        success: false,
        message: 'No registered parent email address found for this student. Please add a guardian first.',
      });
    }

    // Generate fresh high-entropy token and expiry
    const { rawToken, tokenHash, expiresAt } = generateParentApprovalToken();
    visit.parent_token_hash = tokenHash;
    visit.parent_token_expires_at = expiresAt;

    const emailResult = await sendParentApprovalEmail({
      visit,
      rawToken,
      parentEmail: recipientEmail,
      baseUrl: process.env.APP_BASE_URL || process.env.FRONTEND_URL,
    });

    if (emailResult.success) {
      visit.email_notification_status = 'SUBMITTED';
      visit.email_sent_at = new Date();
      visit.email_failure_reason = null;
    } else {
      visit.email_notification_status = 'FAILED';
      visit.email_failure_reason = emailResult.error || 'Failed to dispatch email';
    }

    await visit.save();

    return res.json({
      success: emailResult.success,
      message: emailResult.success
        ? `Approval email successfully submitted to ${recipientEmail}`
        : `Email delivery failed: ${emailResult.error}`,
      email_notification_status: visit.email_notification_status,
      email_failure_reason: visit.email_failure_reason,
      emailSentAt: visit.email_sent_at,
    });
  } catch (err) {
    logger.error('[HomeVisit] resend-notification error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Warden: Approve or Reject ────────────────────────────────────────────────
router.post('/warden-approve', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { visit_id, action } = req.body; // action: 'approve' | 'reject'

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.warden_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Hostel staff already responded' });
    }

    const student = visit.student_id;
    const studentPhone = student?.phone || visit.student_phone || visit.phone || null;

    if (action === 'approve') {
      const isLegacy = visit.parent_approval_status === 'legacy';
      if (!isLegacy) {
        if (visit.parent_approval_status === 'parent_rejected') {
          return res.status(400).json({
            success: false,
            message: 'Cannot approve home visit: Parent has rejected this request.',
          });
        }
        const isParentApproved = visit.parent_approval_status === 'parent_approved';
        const isPhoneOverride = Boolean(visit.parent_call_confirmed);
        if (!isParentApproved && !isPhoneOverride) {
          return res.status(400).json({
            success: false,
            message: 'Digital parent approval (or staff phone confirmation override) is required before final approval',
          });
        }
      } else {
        // Legacy record — backwards compatible with original parent call confirmation
        if (!visit.parent_call_confirmed) {
          return res.status(400).json({ success: false, message: 'Confirm parent call before approving' });
        }
      }
      visit.warden_status = 'approved';
      visit.warden_response_time = new Date();
      visit.overall_status = 'approved';

      const visitLean = visit.toObject();
      visitLean.student_id = student;
      const { token, qrPublicUrl } = await issueHomeVisitGatePass(visitLean);
      visit.qr_token = token;

      // Send QR to student via WhatsApp if phone is present (non-blocking)
      if (studentPhone) {
        try {
          await enqueueWhatsAppMessage({
            to: studentPhone,
            body: `✅ *Home Visit Approved!*\n\nHostel staff has confirmed permission via parent call.\n📅 Leave: ${visit.leave_date}\n📅 Return: ${visit.return_date}\n\nYour QR gate pass is ready.\n\nQR Token (for dashboard scan): ${token.substring(0, 30)}...\nQR Image (if accessible): ${qrPublicUrl || '(configured locally)'}`,
          });
        } catch (msgErr) {
          console.warn('[HomeVisit] WhatsApp notification error (non-fatal):', msgErr.message);
        }
      }
    } else {
      visit.overall_status = 'rejected';
      if (studentPhone) {
        try {
          await enqueueWhatsAppMessage({
            to: studentPhone,
            body: `❌ Your home visit request has been *rejected by the hostel staff*.\nDates: ${visit.leave_date} → ${visit.return_date}`,
          });
        } catch (msgErr) {
          console.warn('[HomeVisit] WhatsApp notification error (non-fatal):', msgErr.message);
        }
      }
    }

    await visit.save();

    res.json({ success: true, message: `Hostel staff ${action}d the request`, visit });
  } catch (error) {
    console.error('Warden approve error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Home Visit QR Scan (Gate) ────────────────────────────────────────────────
router.post('/scan', protect, authorize('security', 'warden'), async (req, res) => {
  try {
    const token = normalizeScannedToken(req.body.token);
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    let visit = await findHomeVisitByScanToken(token);
    if (visit) {
      visit = await HomeVisitLog.findById(visit._id).populate('student_id');
    } else {
      const { valid, payload, error } = validateQR(token);
      if (!valid) return res.status(400).json({ success: false, message: error });
      if (payload.type !== 'home_visit') {
        return res.status(400).json({ success: false, message: 'Not a home visit QR code' });
      }
      visit = await HomeVisitLog.findById(payload.visit_id).populate('student_id');
    if (!visit || (visit.overall_status !== 'approved' && visit.parent_approval_status !== 'parent_approved')) {
      return res.status(400).json({ success: false, message: 'Visit not found or not approved' });
    }

    let scanResult;
    const scannerName = req.user.name || req.user.rollNo || req.user.email || 'Security Guard';

    if (!visit.qr_used_out) {
      // First scan = HOME OUT
      visit.qr_used_out = true;
      visit.actual_out_time = new Date();
      visit.scanned_by_out = req.user._id;
      visit.scannedBy = req.user._id;
      visit.scanned_by_name = scannerName;
      scanResult = 'HOME OUT';
    } else if (!visit.qr_used_in) {
      // Second scan = HOME IN
      visit.qr_used_in = true;
      visit.actual_in_time = new Date();
      visit.scanned_by_in = req.user._id;
      visit.scannedBy = req.user._id;
      visit.scanned_by_name = scannerName;
      visit.overall_status = 'completed';
      scanResult = 'HOME IN';
    } else {
      return res.status(400).json({ success: false, message: 'QR code already fully used' });
    }

    await visit.save();

    // Sync GatePass status
    if (visit.qr_token) {
      if (scanResult === 'HOME OUT') {
        await GatePass.updateOne(
          { qr_token: visit.qr_token },
          { $set: { status: 'OUTSIDE', out_time: new Date(), scanned_by_out: req.user._id, scanned_by_name: scannerName } }
        ).catch(() => {});
      } else if (scanResult === 'HOME IN') {
        await GatePass.updateOne(
          { qr_token: visit.qr_token },
          { $set: { status: 'COMPLETED', in_time: new Date(), completed_at: new Date(), scanned_by_in: req.user._id, scanned_by_name: scannerName } }
        ).catch(() => {});
      }
    }

    res.json({
      success: true,
      message: `Marked as ${scanResult}`,
      student: {
        name: visit.student_id?.name || visit.name || 'Student',
        rollNumber: visit.student_id?.rollNo || visit.rollNo || 'N/A',
      },
      scanResult,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Home visit scan error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden/Security: List All Requests ───────────────────────────────────────
router.get('/list', protect, authorize('warden', 'security'), async (req, res) => {
  const queryStart = Date.now();
  try {
    const { status, parentApprovalStatus, scanStatus, scannedOnly, date, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, 50, 100);
    const searchTrim = (search || '').trim();

    const cacheKey = `logs:home:${status || 'all'}:${parentApprovalStatus || 'all'}:${scanStatus || 'all'}:${scannedOnly || 'all'}:${date || 'all'}:${searchTrim || 'all'}:${page}:${limit}`;
    const cached = await getLogsCache(cacheKey);
    if (cached) {
      res.set('X-Response-Time', `${Date.now() - queryStart}ms`);
      return res.json({ success: true, ...cached, cached: true });
    }

    const conditions = [];
    if (status) conditions.push({ overall_status: status });
    if (parentApprovalStatus && parentApprovalStatus !== 'all') {
      conditions.push({ parent_approval_status: parentApprovalStatus });
    }
    if (scannedOnly === 'true') {
      conditions.push({
        $or: [
          { actual_out_time: { $ne: null } },
          { actual_in_time: { $ne: null } },
          { qr_used_out: true },
          { qr_used_in: true },
        ],
      });
    }
    if (scanStatus === 'OUT') {
      conditions.push({ actual_out_time: { $ne: null }, actual_in_time: null });
    } else if (scanStatus === 'IN') {
      conditions.push({ actual_in_time: { $ne: null } });
    }
    if (date) {
      conditions.push({
        $or: [
          { leave_date: date },
          { return_date: date },
        ],
      });
    }
    if (searchTrim) {
      conditions.push({
        $or: [
          { name: { $regex: searchTrim, $options: 'i' } },
          { rollNo: { $regex: searchTrim, $options: 'i' } },
        ],
      });
    }

    const filter = conditions.length > 1 ? { $and: conditions } : (conditions[0] || {});

    // ⚡ Lean projection: load fields rendered in the table to minimize response payload
    const [rawVisits, count] = await Promise.all([
      HomeVisitLog.find(filter)
        .select('_id student_id name rollNo hostel roomNo place reason leave_date return_date parentPhone parentPhone2 overall_status parent_approval_status final_parent_decision_at parent_decision_source accompanying parent_call_confirmed actual_out_time actual_in_time qr_used_out qr_used_in scanned_by_name scannedBy student_photo createdAt')
        .populate('student_id', 'name rollNo hostel roomNo parentPhone parentPhone2 studentPhoto picture')
        .populate('scannedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      (conditions.length === 0 && skip === 0)
        ? null
        : (conditions.length === 0
            ? HomeVisitLog.estimatedDocumentCount()
            : HomeVisitLog.countDocuments(filter)),
    ]);

    // Attach linked guardians & parent approvals for audit inspection
    const visitIds = rawVisits.map((v) => v._id);
    const studentIds = rawVisits.map((v) => v.student_id?._id || v.student_id).filter(Boolean);

    const [approvals, guardians] = await Promise.all([
      ParentApproval.find({ home_visit_request_id: { $in: visitIds } }).lean(),
      Guardian.find({ student_id: { $in: studentIds } }).lean(),
    ]);

    const approvalMap = new Map();
    approvals.forEach((a) => {
      const vId = String(a.home_visit_request_id);
      if (!approvalMap.has(vId)) approvalMap.set(vId, []);
      approvalMap.get(vId).push(a);
    });

    const guardianMap = new Map();
    guardians.forEach((g) => {
      const sId = String(g.student_id);
      if (!guardianMap.has(sId)) guardianMap.set(sId, []);
      guardianMap.get(sId).push(g);
    });

    const visits = rawVisits.map((v) => ({
      ...v,
      parentApprovals: approvalMap.get(String(v._id)) || [],
      guardians: guardianMap.get(String(v.student_id?._id || v.student_id)) || [],
    }));

    const finalCount = count !== null ? count : visits.length;
    const hasMore = (skip + visits.length) < finalCount;
    const nextCursor = visits.length > 0 ? visits[visits.length - 1]._id : null;

    const sanitizedVisits = visits.map((visit) => {
      if (visit.student_id && visit.student_id._id) {
        visit.student_id.studentPhoto = visit.student_id.studentPhoto || visit.student_id.picture || `/api/auth/student-photo/${visit.student_id._id}`;
      }
      return visit;
    });

    const responsePayload = {
      count: finalCount,
      page,
      limit,
      hasMore,
      nextCursor,
      visits: sanitizedVisits,
    };
    await setLogsCache(cacheKey, responsePayload, 30);

    res.set('X-Response-Time', `${Date.now() - queryStart}ms`);
    res.json({ success: true, ...responsePayload, cached: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Student: View Own Requests ───────────────────────────────────────────────
router.get('/my', protect, authorize('student'), async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, 20, 100);
    const filter = { student_id: req.user._id };
    const [visits, count] = await Promise.all([
      HomeVisitLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      HomeVisitLog.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, visits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Delete Individual Home Visit Record (Warden/Admin) ─────────────────────
router.delete('/:id', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const existingVisit = await HomeVisitLog.findById(req.params.id).populate('student_id', 'name rollNo hostel').lean();
    if (!existingVisit) return res.status(404).json({ success: false, message: 'Home visit record not found' });

    await HomeVisitLog.findByIdAndDelete(req.params.id);
    await invalidateLogsCache();

    const studentName = existingVisit.name || existingVisit.student_id?.name || 'Student';
    const desc = `Deleted home visit pass for ${studentName} (${existingVisit.leave_date || 'N/A'} to ${existingVisit.return_date || 'N/A'})`;

    await recordDeletionAudit({
      user: req.user,
      action: 'DELETE_SINGLE_HOME',
      targetType: 'HOME_VISIT',
      deletedCount: 1,
      description: desc,
      metadata: { recordId: req.params.id, studentName, rollNo: existingVisit.rollNo },
    });

    logger.info('[HomeVisit] Deleted visit record', { id: req.params.id, user: req.user.email, role: req.user.role });
    res.json({ success: true, message: 'Home visit record deleted successfully', deletedByName: req.user.name || req.user.email });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Delete All Home Visit Records (Warden/Admin) ───────────────────────────
router.delete('/', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const totalCountBefore = await HomeVisitLog.countDocuments();
    const result = await HomeVisitLog.deleteMany({});
    await invalidateLogsCache();
    const deletedCount = result.deletedCount != null ? result.deletedCount : totalCountBefore;

    const desc = `Cleared all ${deletedCount} home visit pass records from database`;
    await recordDeletionAudit({
      user: req.user,
      action: 'DELETE_ALL_HOME',
      targetType: 'HOME_VISIT',
      deletedCount,
      description: desc,
    });

    logger.info('[HomeVisit] Cleared all home visits', { user: req.user.email, role: req.user.role, deletedCount });
    res.json({
      success: true,
      deletedCount,
      deletedByName: req.user.name || req.user.email,
      message: `Cleared ${deletedCount} home visit records successfully. Action recorded under ${req.user.name || req.user.email}.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Bulk Purge Home Visits by Cutoff Date (Warden/Admin) ────────────────────
router.post('/purge', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { cutoffDate } = req.body;
    if (!cutoffDate) {
      return res.status(400).json({ success: false, message: 'cutoffDate is required (YYYY-MM-DD)' });
    }
    const cutoff = new Date(cutoffDate + 'T23:59:59.999Z');
    const result = await HomeVisitLog.deleteMany({
      $or: [
        { createdAt: { $lte: cutoff } },
        { leave_date: { $lte: cutoffDate } },
        { return_date: { $lte: cutoffDate } },
        { actual_in_time: { $lte: cutoff } },
        { actual_out_time: { $lte: cutoff } },
      ]
    });
    await invalidateLogsCache();

    const deletedCount = result.deletedCount || 0;
    const desc = `Purged ${deletedCount} home visit records before ${cutoffDate}`;

    await recordDeletionAudit({
      user: req.user,
      action: 'PURGE_HOME',
      targetType: 'HOME_VISIT',
      deletedCount,
      description: desc,
      metadata: { cutoffDate },
    });

    logger.info('[HomeVisit] Warden purged records', { cutoffDate, deletedCount, warden: req.user.email });
    res.json({
      success: true,
      deletedCount,
      deletedByName: req.user.name || req.user.email,
      message: `Purged ${deletedCount} home visit records before ${cutoffDate}. Action recorded under ${req.user.name || req.user.email}.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
