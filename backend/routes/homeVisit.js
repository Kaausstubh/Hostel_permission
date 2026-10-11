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
const HomeVisitLog = require('../models/HomeVisitLog');
const GatePass = require('../models/GatePass');
const User = require('../models/User');
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
const logger = require('../utils/logger');
const { recordDeletionAudit } = require('../services/storageStatsService');
const { getLogsCache, setLogsCache, invalidateLogsCache } = require('../services/logsCache');

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
      return res.status(409).json({
        success: false,
        message: `An active home visit already exists for ${overlappingVisit.leave_date} to ${overlappingVisit.return_date}.`,
      });
    }

    // Create the request record with a unique persistent token
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
      qr_token: persistentToken,
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

    // In the "warden calls parent" workflow, we do not require parent WhatsApp approval.
    // (Optional notifications can still be added later if you want.)

    res.status(201).json({
      success: true,
      message: 'Home visit request submitted. Hostel staff will call your parent to confirm.',
      visit,
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

// ─── Parent: Approve or Reject ────────────────────────────────────────────────
// Called via WhatsApp webhook or direct API (for web fallback)
router.post('/parent-approve', async (req, res) => {
  try {
    const { visit_id, action } = req.body; // action: 'approve' | 'reject'

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.parent_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request already responded to by parent' });
    }

    visit.parent_status = action === 'approve' ? 'approved' : 'rejected';
    visit.parent_response_time = new Date();

    if (action === 'approve') {
      visit.overall_status = 'parent_approved';

      // Notify warden (safe, non-blocking)
      try {
        const student = visit.student_id;
        const studentName = student?.name || visit.name || 'Student';
        const studentRoll = student?.rollNo || visit.rollNo || 'N/A';
        const studentHostel = student?.hostel || 'N/A';
        const wardenUser = await User.findOne({ role: { $in: ['warden', 'hostel_staff'] } });
        if (wardenUser && wardenUser.phone) {
          await enqueueWhatsAppMessage({
            to: wardenUser.phone,
            body: `🏠 *Home Visit — Parent Approved*\n\nStudent: *${studentName}* (${studentRoll})\nHostel: ${studentHostel}\n📍 Destination: ${visit.place || 'N/A'}\nReason: ${visit.reason}\n📅 Leave: ${visit.leave_date}\n📅 Return: ${visit.return_date}\n\nParent has approved. Awaiting your decision.\n\nReply:\n✅ *WARDEN_APPROVE ${visit._id}*\n❌ *WARDEN_REJECT ${visit._id}*`,
          });
        }
      } catch (msgErr) {
        console.warn('[HomeVisit] Warden WhatsApp alert error (non-fatal):', msgErr.message);
      }
    } else {
      visit.overall_status = 'rejected';
      const studentPhone = visit.student_id?.phone || visit.student_phone || visit.phone || null;
      if (studentPhone) {
        try {
          await enqueueWhatsAppMessage({
            to: studentPhone,
            body: `❌ Your home visit request has been *rejected by your parent*.\n📍 Destination: ${visit.place || 'N/A'}\nReason: ${visit.reason}\nDates: ${visit.leave_date} → ${visit.return_date}`,
          });
        } catch (msgErr) {
          console.warn('[HomeVisit] Student rejection WhatsApp error (non-fatal):', msgErr.message);
        }
      }
    }

    await visit.save();

    res.json({ success: true, message: `Parent ${action}d the request`, visit });
  } catch (error) {
    console.error('Parent approve error:', error);
    res.status(500).json({ success: false, message: error.message });
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

    visit.warden_status = action === 'approve' ? 'approved' : 'rejected';
    visit.warden_response_time = new Date();

    const student = visit.student_id;
    const studentPhone = student?.phone || visit.student_phone || visit.phone || null;

    if (action === 'approve') {
      if (!visit.parent_call_confirmed) {
        return res.status(400).json({ success: false, message: 'Confirm parent call before approving' });
      }
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
    }
    if (!visit || visit.overall_status !== 'approved') {
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
    const { status, scanStatus, scannedOnly, date, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, 50, 100);
    const searchTrim = (search || '').trim();

    const cacheKey = `logs:home:${status || 'all'}:${scanStatus || 'all'}:${scannedOnly || 'all'}:${date || 'all'}:${searchTrim || 'all'}:${page}:${limit}`;
    const cached = await getLogsCache(cacheKey);
    if (cached) {
      res.set('X-Response-Time', `${Date.now() - queryStart}ms`);
      return res.json({ success: true, ...cached, cached: true });
    }

    const conditions = [];
    if (status) conditions.push({ overall_status: status });
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

    // ⚡ Lean projection: load only fields rendered in the table to minimize response payload
    const [visits, count] = await Promise.all([
      HomeVisitLog.find(filter)
        .select('_id student_id name rollNo hostel roomNo place reason leave_date return_date parentPhone parentPhone2 overall_status parent_call_confirmed actual_out_time actual_in_time qr_used_out qr_used_in scanned_by_name scannedBy student_photo createdAt')
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
