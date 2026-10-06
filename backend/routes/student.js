/**
 * Student Portal Routes
 * Protected endpoints for the in-portal student chatbot.
 * All routes require: JWT + role=student
 *
 * GET  /api/student/status     - Current status summary
 * POST /api/student/request-inout - Create daily in/out request for security approval
 * POST /api/student/home-visit  - Submit home visit request
 * POST /api/student/complaint   - File a complaint
 * GET  /api/student/complaints  - My complaints
 * GET  /api/student/home-visits - My home visit requests
 */

const express = require('express');
const router = express.Router();
const { protect, authorize, invalidateUserCache } = require('../middleware/auth');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');
const User = require('../models/User');
const logger = require('../utils/logger');
const {
  INOUT_REQUEST_EXPIRY,
  createPendingInOutRequest,
  getPendingInOutRequest,
  removePendingInOutRequest,
} = require('../services/inOutRequestService');
const { renderQRFromToken } = require('../services/qrService');
const {
  issueHomeVisitGatePass,
  isLegacyHomeJwtToken,
} = require('../services/homeVisitQrService');
const { normalizeToE164, validateIndianPhone } = require('../utils/phone');

const { validatePlaceGeo } = require('../utils/placeValidator');

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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

const getPagination = (query, defaultLimit = 20, maxLimit = 100) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ── All student routes require login + student role ───────────────────────────
router.use(protect, authorize('student'));

// ── GET /status ───────────────────────────────────────────────────────────────
// Returns a summary card for the student: current IN/OUT, pending items
router.get('/status', async (req, res) => {
  try {
    const studentId = req.user._id;

    const today = todayStr();

    const [
      todayOut,
      pendingInOutRequest,
      activeVisitsRaw,
      recentVisitHistory,
      recentComplaints,
      todayLogs,
    ] = await Promise.all([
      InOutLog.findOne({
        student_id: studentId,
        status: 'OUT',
        returned: false,
        date: today,
      }).lean(),
      (async () => {
        const pending = await getPendingInOutRequest(studentId.toString());
        if (pending?.expiresAt && new Date(pending.expiresAt).getTime() <= Date.now()) {
          await removePendingInOutRequest(studentId.toString());
          return null;
        }
        return pending;
      })(),
      HomeVisitLog.find({
        student_id: studentId,
        overall_status: { $in: ACTIVE_HOME_VISIT_STATUSES },
      })
        .sort({ leave_date: -1, createdAt: -1 })
        .limit(5)
        .lean(),
      HomeVisitLog.find({
        student_id: studentId,
        overall_status: { $in: ['completed', 'rejected'] },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Complaint.find({ student_id: studentId })
        .sort({ timestamp: -1 })
        .limit(3)
        .lean(),
      InOutLog.find({
        student_id: studentId,
        date: today,
      })
        .sort({ timestamp: -1 })
        .lean(),
    ]);

    const attachHomeVisitQR = async (visit) => {
      if (visit.overall_status === 'completed' || visit.qr_used_in) return null;
      if (visit.overall_status !== 'approved') return visit;
      if (!visit.qr_used_out && visit.return_date < today) return null;

      if (!visit.qr_token || isLegacyHomeJwtToken(visit.qr_token)) {
        const issued = await issueHomeVisitGatePass(visit);
        return { ...visit, qr_token: issued.token, qrDataUrl: issued.qrDataUrl };
      }

      const { qrDataUrl } = await renderQRFromToken(visit.qr_token, `hv_${visit._id}`);
      return { ...visit, qrDataUrl };
    };

    const activeVisits = (await Promise.all(activeVisitsRaw.map(attachHomeVisitQR))).filter(Boolean);

    const pendingVisits = activeVisits.filter((visit) => {
      if (!['pending', 'parent_approved'].includes(visit.overall_status)) return false;
      if (!visit.qr_used_out && visit.return_date < today) return false;
      return true;
    });

    const approvedSeen = new Set();
    const approvedVisits = activeVisits.filter((visit) => {
      if (visit.overall_status !== 'approved') return false;
      if (visit.qr_used_in) return false;
      if (!visit.qr_used_out && visit.return_date < today) return false;
      const id = String(visit._id);
      if (approvedSeen.has(id)) return false;
      approvedSeen.add(id);
      return true;
    });

    res.json({
      success: true,
      status: {
        currentStatus: todayOut ? 'OUT' : 'IN',
        isOutside: !!todayOut,
        outSince: todayOut ? todayOut.timestamp : null,
        pendingInOutRequest,
        pendingVisits,
        approvedVisits,
        recentVisitHistory,
        recentComplaints,
        todayLogs,
        studentPhoto: req.user?.studentPhoto || req.user?.picture || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /request-inout ───────────────────────────────────────────────────────
// Create a short-lived IN or OUT request for security approval
router.post('/request-inout', async (req, res) => {
  try {
    const user = req.user;
    const studentId = user._id.toString();
    const place = String(req.body.place || '').trim().slice(0, 120);

    // Determine scan direction
    const existingOut = await InOutLog.findOne({
      student_id: studentId,
      status: 'OUT',
      returned: false,
      date: todayStr(),
    });
    const scanType = existingOut ? 'IN' : 'OUT';

    if (scanType === 'OUT' && (!place || !(await validatePlaceGeo(place)))) {
      return res.status(400).json({ success: false, message: 'A valid destination (place) is required for going out (real city, town, village, or place name)' });
    }

    let request = await getPendingInOutRequest(studentId);
    if (request && request.scanType !== scanType) {
      await removePendingInOutRequest(studentId);
      request = null;
    }

    if (request) {
      return res.json({
        success: true,
        message: `Active ${request.scanType} request already exists`,
        scan_type: request.scanType,
        request,
        qrDataUrl: request.qrDataUrl,
        qrPublicUrl: request.qrPublicUrl,
        token: request.token,
        expiresIn: request.expiresAt ? `${INOUT_REQUEST_EXPIRY} seconds` : null,
        student: {
          name: user.name,
          rollNo: user.rollNo,
          hostel: user.hostel,
        },
      });
    }

    if (!request) {
      request = await createPendingInOutRequest({
        studentId,
        studentName: user.name,
        hostel: user.hostel || 'N/A',
        rollNumber: user.rollNo || 'N/A',
        studentPhone: user.phone || '',
        parentPhone: user.parentPhone || '',
        studentPhoto: user.studentPhoto || user.picture || '',
        scanType,
        place: scanType === 'OUT' ? place : (existingOut?.place || place),
        reason: '',
      });
    }

    res.json({
      success: true,
      message: `In/Out request sent for ${scanType}`,
      scan_type: scanType,
      place: request.place || place,
      request,
      qrDataUrl: request.qrDataUrl,
      qrPublicUrl: request.qrPublicUrl,
      token: request.token,
      expiresIn: `${INOUT_REQUEST_EXPIRY} seconds`,
      student: {
        name: user.name,
        rollNo: user.rollNo,
        hostel: user.hostel,
      },
    });
  } catch (err) {
    console.error('Student in/out request error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /home-visit ──────────────────────────────────────────────────────────
// Submit a new home visit request
router.post('/home-visit', async (req, res) => {
  try {
    const { reason, leave_date, return_date, place } = req.body;
    const user = req.user;

    if (!reason || !leave_date || !return_date || !place || !(await validatePlaceGeo(place))) {
      return res.status(400).json({
        success: false,
        message: 'reason, leave_date, return_date, and a valid destination place are required (real city, town, village, or place name)',
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(leave_date) || !dateRegex.test(return_date)) {
      return res.status(400).json({
        success: false,
        message: 'Dates must be in YYYY-MM-DD format',
      });
    }

    if (return_date <= leave_date) {
      return res.status(400).json({
        success: false,
        message: 'Return date must be after leave date',
      });
    }

    const today = todayStr();
    if (leave_date < today) {
      return res.status(400).json({
        success: false,
        message: 'Leave date cannot be before today',
      });
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
        message: 'Return date cannot exceed 3.5 months from leave date',
      });
    }
    if (return_date < today) {
      return res.status(400).json({
        success: false,
        message: 'Return date cannot be before today',
      });
    }

    // Removed duplicated maxReturnDate check

    // Prevent multiple active passes from existing for overlapping periods.
    const overlappingVisit = await HomeVisitLog.findOne(
      buildOverlappingVisitFilter(user._id, leave_date, return_date)
    )
      .sort({ createdAt: -1 })
      .lean();

    if (overlappingVisit) {
      return res.status(409).json({
        success: false,
        message: `An active home visit already exists for ${overlappingVisit.leave_date} to ${overlappingVisit.return_date}. Complete or cancel the existing pass before creating another overlapping one.`,
      });
    }

    const visit = await HomeVisitLog.create({
      student_id: user._id,
      name: user.name,
      rollNo: user.rollNo || '',
      student_photo: user.studentPhoto || user.picture || null,
      parent_phone: user.parentPhone ? normalizeToE164(user.parentPhone) : null,
      reason,
      leave_date,
      return_date,
      place: String(place).trim().slice(0, 200),
    });

    res.status(201).json({
      success: true,
      message: 'Home visit request submitted. Awaiting warden confirmation call to parent.',
      visit,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /complaint ───────────────────────────────────────────────────────────
// File a complaint
router.post('/complaint', async (req, res) => {
  try {
    const { hostel, complaint_text, complaint_type, photo } = req.body;
    const user = req.user;

    const trimmedText = typeof complaint_text === 'string' ? complaint_text.trim() : '';
    const trimmedPhoto = typeof photo === 'string' && photo.trim() ? photo.trim() : null;

    if (!trimmedText && !trimmedPhoto) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a complaint description or a photo.',
      });
    }

    const complaintHostel = (hostel || user.hostel || 'BH1').toUpperCase();
    if (!['BH1', 'BH2', 'GH'].includes(complaintHostel)) {
      return res.status(400).json({
        success: false,
        message: 'Valid hostel is required (BH1, BH2, or GH)',
      });
    }

    const allowedTypes = ['electricity', 'wifi', 'washing_machine', 'carpenter', 'plumber', 'others'];
    const normalizedType = allowedTypes.includes((complaint_type || '').toLowerCase())
      ? complaint_type.toLowerCase()
      : 'others';

    const finalDescription = trimmedText
      ? `[${normalizedType}] ${trimmedText}`
      : `[${normalizedType}] Maintenance required. Photo evidence attached.`;

    const complaint = await Complaint.create({
      student_id: user._id,
      name: user.name,
      rollNo: user.rollNo || '',
      hostel: complaintHostel,
      complaint_type: normalizedType,
      complaint_text: finalDescription,
      photo: trimmedPhoto,
    });

    res.status(201).json({
      success: true,
      message: 'Complaint filed successfully',
      complaint,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /complaints ───────────────────────────────────────────────────────────
// Fetch student's own complaints
router.get('/complaints', async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, 20, 100);
    const filter = { student_id: req.user._id };
    const [complaints, count] = await Promise.all([
      Complaint.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
      Complaint.countDocuments(filter),
    ]);
    res.json({ success: true, count, page, limit, complaints });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /home-visits ──────────────────────────────────────────────────────────
// Fetch student's own home visit requests
router.get('/home-visits', async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, 20, 100);
    const filter = { student_id: req.user._id };
    const [visits, count] = await Promise.all([
      HomeVisitLog.find(filter)
        .sort({ leave_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      HomeVisitLog.countDocuments(filter),
    ]);

    // Keep only the latest active/meaningful items first so the UI does not
    // surface stale duplicate-looking passes above current ones.
    const active = [];
    const recentHistory = [];
    const seenDates = new Set();
    for (const visit of visits) {
      const dateKey = `${visit.leave_date}_${visit.return_date}`;
      if (ACTIVE_HOME_VISIT_STATUSES.includes(visit.overall_status)) {
        active.push(visit);
        seenDates.add(dateKey);
      } else {
        // Deduplicate rejected/completed items for the same date span
        if (!seenDates.has(dateKey) && recentHistory.length < 5) {
          recentHistory.push(visit);
          seenDates.add(dateKey);
        }
      }
    }

    const attachQr = async (visit) => {
      if (visit.overall_status !== 'approved' || visit.qr_used_in) return visit;
      try {
        if (!visit.qr_token || isLegacyHomeJwtToken(visit.qr_token)) {
          const issued = await issueHomeVisitGatePass(visit);
          return { ...visit, qr_token: issued.token, qrDataUrl: issued.qrDataUrl };
        }
        const { qrDataUrl } = await renderQRFromToken(visit.qr_token, `hv_${visit._id}`);
        return { ...visit, qrDataUrl };
      } catch {
        return visit;
      }
    };

    const activeWithQr = await Promise.all(active.map(attachQr));

    res.json({
      success: true,
      count,
      page,
      limit,
      visits: [...activeWithQr, ...recentHistory],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /validate-place ──────────────────────────────────────────────────────
router.post('/validate-place', async (req, res) => {
  try {
    const { place } = req.body;
    if (!place) return res.status(400).json({ success: false, message: 'place required' });
    const valid = await validatePlaceGeo(place);
    res.json({ success: true, valid });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /onboard ─────────────────────────────────────────────────────────────
// Complete student profile onboarding (called once after first Google OAuth login)
router.put('/onboard', async (req, res) => {
  try {
    const { name, rollNo, phone, parentPhone, parentPhone2, hostel, photo } = req.body;
    const user = req.user;

    // Validate presence (including compulsory face photo)
    if (!name || !rollNo || !phone || !parentPhone || !parentPhone2 || !hostel) {
      return res.status(400).json({
        success: false,
        message: 'Name, Roll/MIS number, phone, both parent phone numbers, and hostel selection are required.',
      });
    }

    if (!photo || typeof photo !== 'string' || !photo.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A clear student face photo is compulsory for verification records.',
      });
    }

    // Validate Name format
    const trimmedName = String(name).trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      return res.status(400).json({
        success: false,
        message: 'Name must be between 2 and 80 characters.',
      });
    }

    // Validate Roll Number format
    const normalizedRollNo = String(rollNo).trim().toUpperCase();
    if (normalizedRollNo.length < 3 || normalizedRollNo.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Roll/MIS number format.',
      });
    }

    // Ensure Roll/MIS matches student's college email if present
    const emailLocalPart = (user.email ? user.email.split('@')[0] : '').trim();
    const emailMisMatch = emailLocalPart.match(/\d+/);
    if (emailMisMatch && normalizedRollNo !== emailMisMatch[0].toUpperCase()) {
      return res.status(400).json({
        success: false,
        message: `Roll/MIS must match your registered college email (${emailMisMatch[0]}).`,
      });
    }

    // Check duplicate rollNo
    const existingRoll = await User.findOne({ rollNo: normalizedRollNo, _id: { $ne: user._id } }).lean();
    if (existingRoll) {
      return res.status(409).json({
        success: false,
        message: 'This Roll/MIS number is already registered to another student.',
      });
    }

    // Validate phone numbers (Must be 10 digits, +91<10 digits>, or +91 <10 digits>)
    const phoneCheck = validateIndianPhone(phone, 'Your Phone Number');
    if (!phoneCheck.valid) {
      return res.status(400).json({ success: false, message: phoneCheck.error });
    }

    const parentCheck = validateIndianPhone(parentPhone, 'Parent Phone 1');
    if (!parentCheck.valid) {
      return res.status(400).json({ success: false, message: parentCheck.error });
    }

    const parent2Check = validateIndianPhone(parentPhone2, 'Parent Phone 2');
    if (!parent2Check.valid) {
      return res.status(400).json({ success: false, message: parent2Check.error });
    }

    // All three phone numbers student enters should be different
    if (phoneCheck.digits10 === parentCheck.digits10) {
      return res.status(400).json({
        success: false,
        message: 'Your Phone Number cannot be the same as Parent Phone 1. All three phone numbers must be unique.',
      });
    }

    if (phoneCheck.digits10 === parent2Check.digits10) {
      return res.status(400).json({
        success: false,
        message: 'Your Phone Number cannot be the same as Parent Phone 2. All three phone numbers must be unique.',
      });
    }

    if (parentCheck.digits10 === parent2Check.digits10) {
      return res.status(400).json({
        success: false,
        message: 'Parent Phone 1 and Parent Phone 2 cannot be the same number. All three phone numbers must be unique.',
      });
    }

    const normalizedPhone = phoneCheck.e164;
    const normalizedParentPhone = parentCheck.e164;
    const normalizedParentPhone2 = parent2Check.e164;

    // Validate hostel selection
    const allowedHostels = ['BH1', 'BH2', 'GH'];
    const normalizedHostel = String(hostel).trim().toUpperCase();
    if (!allowedHostels.includes(normalizedHostel)) {
      return res.status(400).json({
        success: false,
        message: 'Hostel must be BH1, BH2, or GH.',
      });
    }

    // Update student details
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          name: trimmedName,
          rollNo: normalizedRollNo,
          phone: normalizedPhone,
          parentPhone: normalizedParentPhone,
          parentPhone2: normalizedParentPhone2,
          hostel: normalizedHostel,
          picture: photo.trim(),
          studentPhoto: photo.trim(),
        },
      },
      { new: true }
    );

    // Invalidate session cache so subsequent requests load fresh profile & photo
    await invalidateUserCache(String(user._id));

    res.json({
      success: true,
      message: 'Onboarding completed successfully!',
      user: {
        id:           updatedUser._id,
        name:         updatedUser.name,
        email:        updatedUser.email,
        role:         updatedUser.role,
        picture:      updatedUser.studentPhoto || updatedUser.picture || null,
        studentPhoto: updatedUser.studentPhoto || null,
        hostel:       updatedUser.hostel || null,
        rollNo:       updatedUser.rollNo || null,
        phone:        updatedUser.phone || null,
        parentPhone:  updatedUser.parentPhone || null,
        parentPhone2: updatedUser.parentPhone2 || null,
      },
    });
  } catch (err) {
    logger.error('[Student] Onboarding error', { error: err.message, userId: req.user._id });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /photo ───────────────────────────────────────────────────────────────
// Verified student registration photo is strictly one-time only. Locked once set.
router.put('/photo', async (req, res) => {
  try {
    const existing = await User.findById(req.user._id).select('studentPhoto').lean();
    if (existing?.studentPhoto) {
      return res.status(403).json({
        success: false,
        message: 'Your official registration face photo is locked and cannot be edited. Please contact your hostel warden for changes.',
      });
    }

    const { photo } = req.body;
    if (!photo || typeof photo !== 'string' || !photo.trim()) {
      return res.status(400).json({ success: false, message: 'Photo is required' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          studentPhoto: photo.trim(),
          picture: photo.trim(),
        },
      },
      { new: true }
    );

    // Invalidate session cache so subsequent requests load fresh profile & photo
    await invalidateUserCache(String(req.user._id));

    res.json({
      success: true,
      message: 'Student registration photo updated successfully',
      user: {
        id:           updatedUser._id,
        name:         updatedUser.name,
        email:        updatedUser.email,
        role:         updatedUser.role,
        picture:      updatedUser.studentPhoto || updatedUser.picture || null,
        studentPhoto: updatedUser.studentPhoto || null,
        hostel:       updatedUser.hostel || null,
        rollNo:       updatedUser.rollNo || null,
        phone:        updatedUser.phone || null,
        parentPhone:  updatedUser.parentPhone || null,
        parentPhone2: updatedUser.parentPhone2 || null,
      },
    });
  } catch (err) {
    logger.error('[Student] Photo update error', { error: err.message, userId: req.user._id });
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
