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
const { protect, authorize } = require('../middleware/auth');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');
const {
  INOUT_REQUEST_EXPIRY,
  createPendingInOutRequest,
  getPendingInOutRequest,
  removePendingInOutRequest,
} = require('../services/inOutRequestService');
const { renderQRFromToken } = require('../services/qrService');
const { normalizeToE164 } = require('../utils/phone');

const todayStr = () => new Date().toISOString().split('T')[0];
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
      getPendingInOutRequest(studentId.toString()),
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

    const activeVisits = await Promise.all(
      activeVisitsRaw.map(async (visit) => {
        if (!visit.qr_token) return visit;
        const { qrDataUrl } = await renderQRFromToken(visit.qr_token);
        return { ...visit, qrDataUrl };
      })
    );

    const pendingVisits = activeVisits.filter((visit) => {
      if (!['pending', 'parent_approved'].includes(visit.overall_status)) return false;
      if (!visit.qr_used_out && visit.return_date < today) return false; // Abandoned/Expired
      return true;
    });
    
    const approvedVisits = activeVisits.filter((visit) => {
      if (visit.overall_status !== 'approved') return false;
      if (!visit.qr_used_out && visit.return_date < today) return false; // Abandoned/Expired
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

    // Determine scan direction
    const existingOut = await InOutLog.findOne({
      student_id: studentId,
      status: 'OUT',
      returned: false,
      date: todayStr(),
    });
    const scanType = existingOut ? 'IN' : 'OUT';

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
        scanType,
      });
    }

    res.json({
      success: true,
      message: `In/Out request sent for ${scanType}`,
      scan_type: scanType,
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
    const { reason, leave_date, return_date } = req.body;
    const user = req.user;

    if (!reason || !leave_date || !return_date) {
      return res.status(400).json({
        success: false,
        message: 'reason, leave_date, and return_date are required',
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
      parent_phone: user.parentPhone ? normalizeToE164(user.parentPhone) : null,
      reason,
      leave_date,
      return_date,
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
    const { hostel, complaint_text, complaint_type } = req.body;
    const user = req.user;

    if (!complaint_text) {
      return res.status(400).json({
        success: false,
        message: 'complaint_text is required',
      });
    }

    const complaintHostel = (hostel || user.hostel || '').toUpperCase();
    if (!['BH1', 'BH2', 'GH'].includes(complaintHostel)) {
      return res.status(400).json({
        success: false,
        message: 'Valid hostel is required (BH1, BH2, or GH)',
      });
    }

    const allowedTypes = ['electricity', 'wifi', 'washing_machine', 'others'];
    const normalizedType = allowedTypes.includes((complaint_type || '').toLowerCase())
      ? complaint_type.toLowerCase()
      : 'others';

    const complaint = await Complaint.create({
      student_id: user._id,
      name: user.name,
      rollNo: user.rollNo || '',
      hostel: complaintHostel,
      complaint_text: `[${normalizedType}] ${complaint_text}`,
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
      .limit(limit),
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

    res.json({
      success: true,
      count,
      page,
      limit,
      visits: [...active, ...recentHistory],
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
