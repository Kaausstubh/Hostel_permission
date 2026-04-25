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
const { normalizeToE164 } = require('../utils/phone');

const todayStr = () => new Date().toISOString().split('T')[0];
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

    // Current IN/OUT status today
    const todayOut = await InOutLog.findOne({
      student_id: studentId,
      status: 'OUT',
      returned: false,
      date: todayStr(),
    });

    const pendingInOutRequest = await getPendingInOutRequest(studentId.toString());

    // Pending home visit requests
    const pendingVisits = await HomeVisitLog.find({
      student_id: studentId,
      overall_status: { $in: ['pending'] },
    })
      .sort({ createdAt: -1 })
      .limit(3);

    const approvedVisits = await HomeVisitLog.find({
      student_id: studentId,
      overall_status: 'approved',
    })
      .sort({ createdAt: -1 })
      .limit(3);

    // Recent complaints
    const recentComplaints = await Complaint.find({ student_id: studentId })
      .sort({ timestamp: -1 })
      .limit(3);

    // Today's log entries
    const todayLogs = await InOutLog.find({
      student_id: studentId,
      date: todayStr(),
    }).sort({ timestamp: -1 });

    res.json({
      success: true,
      status: {
        currentStatus: todayOut ? 'OUT' : 'IN',
        isOutside: !!todayOut,
        outSince: todayOut ? todayOut.timestamp : null,
        pendingInOutRequest,
        pendingVisits,
        approvedVisits,
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
    if (return_date < today) {
      return res.status(400).json({
        success: false,
        message: 'Return date cannot be before today',
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
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
      HomeVisitLog.countDocuments(filter),
    ]);
    res.json({ success: true, count, page, limit, visits });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
