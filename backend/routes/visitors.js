/**
 * Visitor Routes
 *
 * GET  /api/visitors          - List visitor records with search (name, phone, student, vehicleNumber),
 *                               hasVehicle filter, status, purpose, date, and headcount statistics.
 * GET  /api/visitors/inside   - Quick list of all visitors currently inside campus with headcount sum.
 * GET  /api/visitors/students-search - Autocomplete search for student hosts.
 * GET  /api/visitors/my-pending - Get pending visitor approval requests for student.
 * POST /api/visitors/:id/student-response - Student approves/rejects visitor pass.
 * POST /api/visitors/:id/staff-action - Staff override / approval at gate.
 * POST /api/visitors          - Manual visitor entry (Duty Guard / Warden).
 * POST /api/visitors/:id/exit - Mark visitor as exited.
 * POST /api/visitors/webhook  - Webhook for Google Form submissions (via Apps Script).
 * GET  /api/visitors/export-data - Export visitor data with aggregated headcount for PDF/Excel.
 * DELETE /api/visitors/:id    - Delete visitor log (Warden / Admin only).
 */

const express = require('express');
const router = express.Router();
const VisitorLog = require('../models/VisitorLog');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const {
  normalizeVehicleNumber,
  parseVisitorCount,
  parseBoolean,
  maskPhone,
  maskVehicle,
} = require('../utils/visitorValidation');
const { validateIndianPhone } = require('../utils/phone');
const { VISITOR_PURPOSES, PURPOSE_STUDENT_REQUIRED, PURPOSE_OTHER } = require('../constants/visitorPurposes');
const {
  getIO,
  broadcastVisitorRequest,
  broadcastVisitorResponse,
} = require('../services/socketService');
const { invalidateDashboardCache } = require('../services/dashboardCache');

const QRCode = require('qrcode');

// Helper: current date in Asia/Kolkata timezone
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Helper: calculate total headcount sum from an array or query
const sumHeadcount = (list = []) => list.reduce((acc, item) => acc + (Number(item.visitorCount) || 1), 0);

// ─── GET /api/visitors/public/stats ───────────────────────────────────────────
// Public endpoint for visitor self-registration page to get total students count
router.get('/public/stats', async (req, res) => {
  try {
    const totalStudents = await User.countDocuments({ role: 'student', isActive: true });
    res.json({
      success: true,
      totalStudents,
      campusName: 'IIIT Pune Hostel Campus',
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to fetch visitor public stats', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch student directory stats' });
  }
});

// ─── GET /api/visitors/public/students-search ──────────────────────────────────
// Public autocomplete search for student hosts by Name or MIS (rollNo).
// Returns only safe public directory fields (_id, name, rollNo, hostel, roomNo).
router.get('/public/students-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const hostel = String(req.query.hostel || '').trim();
    const totalStudents = await User.countDocuments({ role: 'student', isActive: true });

    const filter = { role: 'student', isActive: true };
    if (hostel && hostel !== 'ALL') {
      filter.hostel = hostel;
    }

    if (!q || q.length < 1) {
      // Return list of recommended/enrolled students
      const recommended = await User.find(filter)
        .select('_id name rollNo hostel roomNo')
        .sort({ name: 1 })
        .limit(20)
        .lean();
      return res.json({ success: true, students: recommended, totalStudents });
    }

    const escapedTerm = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedTerm, 'i');

    filter.$or = [
      { name: searchRegex },
      { rollNo: searchRegex },
      { roomNo: searchRegex },
    ];

    const students = await User.find(filter)
      .select('_id name rollNo hostel roomNo')
      .sort({ name: 1 })
      .limit(20)
      .lean();

    res.json({ success: true, students, totalStudents });
  } catch (err) {
    logger.error('[Visitor Route] Public student search failed', { error: err.message });
    res.status(500).json({ success: false, message: 'Student search failed: ' + err.message });
  }
});

// ─── GET /api/visitors/public/pass-status/:id ──────────────────────────────────
// Public status check for visitor pass so visitor web page updates live
router.get('/public/pass-status/:id', async (req, res) => {
  try {
    const visitor = await VisitorLog.findById(req.params.id).lean();
    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Visitor pass not found' });
    }

    res.json({
      success: true,
      visitor: {
        _id: visitor._id,
        passNumber: visitor.passNumber,
        name: visitor.name,
        phone: maskPhone(visitor.phone),
        purpose: visitor.purpose,
        purposeDetails: visitor.purposeDetails,
        visitorCount: visitor.visitorCount,
        hasVehicle: visitor.hasVehicle,
        vehicleNumber: visitor.vehicleNumber,
        student_id: visitor.student_id,
        studentName: visitor.studentName,
        studentRollNo: visitor.studentRollNo,
        studentHostel: visitor.studentHostel,
        studentRoomNo: visitor.studentRoomNo,
        studentApprovalStatus: visitor.studentApprovalStatus,
        studentApprovalRemarks: visitor.studentApprovalRemarks,
        studentApprovalTime: visitor.studentApprovalTime,
        status: visitor.status,
        entryTime: visitor.entryTime,
        date: visitor.date,
        entryGate: visitor.entryGate,
        source: visitor.source,
      },
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to fetch pass status', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to retrieve pass status' });
  }
});

// ─── GET /api/visitors/public/kiosk-qr ─────────────────────────────────────────
// Generates QR code for campus gate signage pointing to visitor self-check-in URL
router.get('/public/kiosk-qr', async (req, res) => {
  try {
    const rawOrigin = req.query.origin || req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:5173';
    const origin = rawOrigin.split(',')[0].trim().replace(/\/+$/, '');
    const targetUrl = `${origin}/visitor-pass`;

    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      errorCorrectionLevel: 'H',
      width: 480,
      margin: 3,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    res.json({
      success: true,
      url: targetUrl,
      qrDataUrl,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to generate kiosk QR', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to generate kiosk QR' });
  }
});

// ─── POST /api/visitors/public/register ────────────────────────────────────────
// Public self-check-in endpoint for visitors on the webpage
router.post('/public/register', async (req, res) => {
  try {
    const {
      name,
      phone,
      purpose,
      purposeDetails,
      student_id,
      studentName,
      studentRollNo,
      studentHostel,
      studentRoomNo,
      visitorCount: rawVisitorCount,
      hasVehicle: rawHasVehicle,
      vehicleNumber: rawVehicleNumber,
      entryGate,
    } = req.body;

    // Validate Name
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Visitor name is required.' });
    }

    // Validate Phone
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: 'Visitor phone number is required.' });
    }
    const phoneValidation = validateIndianPhone(phone, 'Visitor phone');
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.error });
    }
    const normalizedPhone = phoneValidation.e164 || String(phone).trim();

    // Validate Purpose
    const sanitizedPurpose = purpose ? String(purpose).trim() : 'Other';

    // Resolve Student Details if Purpose is 'Meeting a student'
    const isStudentVisit = (sanitizedPurpose === PURPOSE_STUDENT_REQUIRED || sanitizedPurpose.toLowerCase().includes('student'));
    let resolvedStudentId = null;
    let resolvedStudentName = studentName ? String(studentName).trim() : '';
    let resolvedRollNo = studentRollNo ? String(studentRollNo).trim() : '';
    let resolvedStudentHostel = studentHostel ? String(studentHostel).trim() : '';
    let resolvedStudentRoom = studentRoomNo ? String(studentRoomNo).trim() : '';

    if (isStudentVisit) {
      if (student_id) {
        const targetUser = await User.findById(student_id);
        if (targetUser && targetUser.role === 'student') {
          resolvedStudentId = targetUser._id;
          resolvedStudentName = targetUser.name || resolvedStudentName;
          resolvedRollNo = targetUser.rollNo || resolvedRollNo;
          resolvedStudentHostel = targetUser.hostel || resolvedStudentHostel;
          resolvedStudentRoom = targetUser.roomNo || resolvedStudentRoom;
        }
      } else if (resolvedRollNo || resolvedStudentName) {
        const matchCriteria = [];
        if (resolvedRollNo) matchCriteria.push({ rollNo: resolvedRollNo });
        if (resolvedStudentName) matchCriteria.push({ name: new RegExp(`^${resolvedStudentName}$`, 'i') });
        if (matchCriteria.length > 0) {
          const targetUser = await User.findOne({ role: 'student', $or: matchCriteria });
          if (targetUser) {
            resolvedStudentId = targetUser._id;
            resolvedStudentName = targetUser.name || resolvedStudentName;
            resolvedRollNo = targetUser.rollNo || resolvedRollNo;
            resolvedStudentHostel = targetUser.hostel || resolvedStudentHostel;
            resolvedStudentRoom = targetUser.roomNo || resolvedStudentRoom;
          }
        }
      }

      if (!resolvedStudentName) {
        return res.status(400).json({ success: false, message: 'Student name is required when purpose is "Meeting a student".' });
      }
      if (!resolvedStudentHostel) {
        return res.status(400).json({ success: false, message: 'Student hostel is required.' });
      }
      if (!resolvedStudentRoom) {
        return res.status(400).json({ success: false, message: 'Student room number is required.' });
      }
    }

    // If purpose is 'Other', require purpose details
    if (sanitizedPurpose === PURPOSE_OTHER || sanitizedPurpose.toLowerCase() === 'other') {
      if (!purposeDetails || !String(purposeDetails).trim()) {
        return res.status(400).json({ success: false, message: 'Specific reason / details is required when purpose is "Other".' });
      }
    }

    // Parse visitor count
    const countRes = parseVisitorCount(rawVisitorCount);
    if (!countRes.valid) {
      return res.status(400).json({ success: false, message: countRes.error });
    }
    const visitorCount = countRes.count;

    // Parse hasVehicle & vehicleNumber
    const hasVehicle = parseBoolean(rawHasVehicle);
    const vehicleRes = normalizeVehicleNumber(rawVehicleNumber, hasVehicle);
    if (!vehicleRes.valid) {
      return res.status(400).json({ success: false, message: vehicleRes.error });
    }
    const vehicleNumber = vehicleRes.normalized;

    const now = new Date();
    const date = todayStr();
    const passNumber = `VIS-WEB-${date.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Student visit -> PENDING (student approves/rejects from portal)
    // Non-student visit -> INSIDE
    const status = isStudentVisit ? 'PENDING' : 'INSIDE';
    const studentApprovalStatus = isStudentVisit ? 'PENDING' : 'NA';

    const newVisitor = await VisitorLog.create({
      name: String(name).trim(),
      phone: normalizedPhone,
      visitorCount,
      hasVehicle,
      vehicleNumber,
      purpose: sanitizedPurpose,
      purposeDetails: purposeDetails ? String(purposeDetails).trim() : '',
      student_id: resolvedStudentId,
      studentName: resolvedStudentName,
      studentRollNo: resolvedRollNo,
      studentHostel: resolvedStudentHostel,
      studentRoomNo: resolvedStudentRoom,
      studentApprovalStatus,
      status,
      entryTime: isStudentVisit ? null : now,
      exitTime: null,
      date,
      entryGate: entryGate ? String(entryGate).trim() : 'Main Gate (Visitor Kiosk)',
      loggedBy: null,
      logged_by_name: 'Visitor Self Check-In',
      source: 'SELF_WEB',
      passNumber,
    });

    logger.info('[Visitor Web] Self check-in pass requested', {
      visitorId: newVisitor._id,
      passNumber,
      purpose: sanitizedPurpose,
      status,
      studentApprovalStatus,
      studentId: resolvedStudentId,
      visitorCount,
      hasVehicle,
      maskedPhone: maskPhone(normalizedPhone),
      maskedVehicle: maskVehicle(vehicleNumber),
    });

    // Real-time broadcast
    if (isStudentVisit) {
      // Dispatches real-time popup to the student's dashboard
      broadcastVisitorRequest(newVisitor, resolvedStudentId);
    } else {
      const io = getIO();
      if (io) {
        io.of('/dashboard').emit('visitor:new', {
          action: 'entry',
          visitor: newVisitor,
          timestamp: now.toISOString(),
        });
        io.of('/scanner').emit('visitor:new', {
          action: 'entry',
          visitor: newVisitor,
          timestamp: now.toISOString(),
        });
      }
    }

    invalidateDashboardCache().catch(() => {});

    res.status(201).json({
      success: true,
      message: isStudentVisit
        ? 'Pass request created! Notification sent to student portal for approval.'
        : 'Visitor pass issued successfully.',
      passNumber,
      visitorId: newVisitor._id,
      visitor: newVisitor,
    });
  } catch (err) {
    logger.error('[Visitor Web] Self check-in error', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to process visitor registration: ' + err.message });
  }
});

// ─── GET /api/visitors ────────────────────────────────────────────────────────
// List all visitor logs with multi-field search and filters
router.get('/', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const skip = (page - 1) * limit;

    const { search, hasVehicle, status, studentApprovalStatus, purpose, date } = req.query;
    const filter = {};

    // Date filter
    if (date && date.trim()) {
      filter.date = date.trim();
    }

    // Status filter
    if (status && status !== 'all') {
      filter.status = status.toUpperCase();
    }

    // Student approval filter
    if (studentApprovalStatus && studentApprovalStatus !== 'all') {
      filter.studentApprovalStatus = studentApprovalStatus.toUpperCase();
    }

    // Purpose filter
    if (purpose && purpose !== 'all') {
      filter.purpose = purpose;
    }

    // hasVehicle filter
    if (hasVehicle !== undefined && hasVehicle !== '' && hasVehicle !== 'all') {
      filter.hasVehicle = parseBoolean(hasVehicle);
    }

    // Multi-field search: name, phone, studentName, studentRollNo, vehicleNumber
    if (search && search.trim()) {
      const term = search.trim();
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedTerm, 'i');

      // Also create a stripped version for vehicle lookup (e.g., "MH 12" -> "MH12")
      const strippedTerm = term.toUpperCase().replace(/[\s-]/g, '');
      const vehicleRegex = new RegExp(strippedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      filter.$or = [
        { name: searchRegex },
        { phone: searchRegex },
        { studentName: searchRegex },
        { studentRollNo: searchRegex },
        { studentHostel: searchRegex },
        { studentRoomNo: searchRegex },
        { purposeDetails: searchRegex },
        { vehicleNumber: vehicleRegex },
        { passNumber: searchRegex },
      ];
    }

    const today = todayStr();

    // Run parallel queries: Paginated list, total count, and summary aggregation
    const [visitors, count, todayDocs, insideDocs, pendingDocs] = await Promise.all([
      VisitorLog.find(filter).sort({ createdAt: -1, entryTime: -1 }).skip(skip).limit(limit).lean(),
      VisitorLog.countDocuments(filter),
      VisitorLog.find({ date: today }).select('visitorCount hasVehicle status').lean(),
      VisitorLog.find({ status: 'INSIDE' }).select('visitorCount hasVehicle').lean(),
      VisitorLog.find({ status: 'PENDING' }).select('visitorCount hasVehicle').lean(),
    ]);

    // Headcount for currently filtered results
    const filteredAllDocs = await VisitorLog.find(filter).select('visitorCount').lean();
    const totalFilteredHeadcount = sumHeadcount(filteredAllDocs);

    // Summary calculations
    const totalInside = insideDocs.length;
    const totalInsideHeadcount = sumHeadcount(insideDocs);
    const vehiclesInside = insideDocs.filter((d) => d.hasVehicle).length;

    const totalPending = pendingDocs.length;
    const totalPendingHeadcount = sumHeadcount(pendingDocs);
    const readyToAdmit = pendingDocs.filter((d) => d.studentApprovalStatus === 'APPROVED').length;
    const awaitingStudent = pendingDocs.filter((d) => d.studentApprovalStatus === 'PENDING').length;

    const totalToday = todayDocs.length;
    const totalTodayHeadcount = sumHeadcount(todayDocs);

    res.json({
      success: true,
      count,
      totalHeadcount: totalFilteredHeadcount,
      page,
      limit,
      totalPages: Math.ceil(count / limit) || 1,
      hasMore: skip + visitors.length < count,
      summary: {
        totalInside,
        totalInsideHeadcount,
        vehiclesInside,
        totalPending,
        totalPendingHeadcount,
        readyToAdmit,
        awaitingStudent,
        totalToday,
        totalTodayHeadcount,
      },
      visitors,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to fetch visitor logs', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch visitor logs: ' + err.message });
  }
});

// ─── GET /api/visitors/inside ─────────────────────────────────────────────────
// Get all visitors currently inside with total headcount
router.get('/inside', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const insideVisitors = await VisitorLog.find({ status: 'INSIDE' })
      .sort({ entryTime: -1 })
      .lean();

    const totalEntries = insideVisitors.length;
    const totalHeadcount = sumHeadcount(insideVisitors);
    const vehiclesCount = insideVisitors.filter((v) => v.hasVehicle).length;

    res.json({
      success: true,
      totalEntries,
      totalHeadcount,
      vehiclesCount,
      visitors: insideVisitors,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to fetch inside visitors', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch inside visitors: ' + err.message });
  }
});

// ─── GET /api/visitors/students-search ────────────────────────────────────────
// Search students for quick visitor pass creation autocomplete
router.get('/students-search', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 1) {
      return res.json({ success: true, students: [] });
    }
    const escapedTerm = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedTerm, 'i');

    const students = await User.find({
      role: 'student',
      $or: [
        { name: searchRegex },
        { rollNo: searchRegex },
        { email: searchRegex },
        { roomNo: searchRegex },
      ],
    })
      .select('_id name email rollNo hostel roomNo phone')
      .limit(15)
      .lean();

    res.json({ success: true, students });
  } catch (err) {
    logger.error('[Visitor Route] Student search failed', { error: err.message });
    res.status(500).json({ success: false, message: 'Student search failed: ' + err.message });
  }
});

// ─── GET /api/visitors/my-pending ─────────────────────────────────────────────
// Get pending visitor requests for the logged-in student
router.get('/my-pending', protect, authorize('student', 'admin'), async (req, res) => {
  try {
    const studentId = req.user._id;
    const studentRollNo = req.user.rollNo ? String(req.user.rollNo).trim() : null;

    const query = {
      studentApprovalStatus: 'PENDING',
      status: 'PENDING',
    };

    if (req.user.role !== 'admin') {
      const orClauses = [{ student_id: studentId }];
      if (studentRollNo) {
        orClauses.push({ studentRollNo: { $regex: new RegExp(`^${studentRollNo}$`, 'i') } });
      }
      query.$or = orClauses;
    }

    const pendingRequests = await VisitorLog.find(query)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, pendingRequests });
  } catch (err) {
    logger.error('[Visitor Route] Failed to fetch pending requests', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch pending requests: ' + err.message });
  }
});

// ─── POST /api/visitors/:id/student-response ──────────────────────────────────
// Student Approves or Rejects a pending visitor pass request
router.post('/:id/student-response', protect, authorize('student', 'admin'), async (req, res) => {
  try {
    const { action, remarks } = req.body;
    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    const visitor = await VisitorLog.findById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Visitor record not found.' });
    }

    const reqUserId = String(req.user._id || req.user.id || '');
    const visitorStudentId = visitor.student_id ? String(visitor.student_id) : '';
    const reqRollNo = String(req.user.rollNo || '').trim().toUpperCase();
    const visitorRollNo = String(visitor.studentRollNo || '').trim().toUpperCase();

    const isMatch =
      (visitorStudentId && visitorStudentId === reqUserId) ||
      (reqRollNo && visitorRollNo && reqRollNo === visitorRollNo) ||
      (req.user.role === 'admin');

    if (!isMatch) {
      return res.status(403).json({ success: false, message: 'You are not authorized to respond to this visitor request.' });
    }

    if (!visitor.student_id && req.user.role === 'student') {
      visitor.student_id = req.user._id;
    }

    if (visitor.studentApprovalStatus !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `This visitor request has already been ${visitor.studentApprovalStatus.toLowerCase()}.`,
        visitor,
      });
    }

    const now = new Date();
    if (action === 'APPROVE') {
      visitor.studentApprovalStatus = 'APPROVED';
      // Student approved from portal; visitor remains PENDING physical gate check-in by security
      visitor.status = 'PENDING';
      visitor.studentApprovalTime = now;
      visitor.studentApprovalRemarks = String(remarks || '').trim();
    } else {
      visitor.studentApprovalStatus = 'REJECTED';
      visitor.status = 'REJECTED';
      visitor.studentApprovalTime = now;
      visitor.studentApprovalRemarks = String(remarks || '').trim();
    }

    await visitor.save();

    logger.info(`[Visitor] Student ${action.toLowerCase()}d visitor request`, {
      visitorId: visitor._id,
      passNumber: visitor.passNumber,
      studentId: req.user._id,
      action,
    });

    broadcastVisitorResponse(visitor, action, req.user.name);
    invalidateDashboardCache().catch(() => {});

    res.json({
      success: true,
      message: action === 'APPROVE'
        ? 'Visitor pass confirmed! Gate security has been notified to grant entry.'
        : 'Visitor request declined.',
      visitor,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to process student response', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to process response: ' + err.message });
  }
});

// ─── POST /api/visitors/:id/staff-action ──────────────────────────────────────
// Guard or Warden physical admission or override at gate
router.post('/:id/staff-action', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const { action, remarks } = req.body;
    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT.' });
    }

    const visitor = await VisitorLog.findById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Visitor record not found.' });
    }

    const now = new Date();
    const staffName = req.user?.name || 'Gate Security';
    if (action === 'APPROVE') {
      const isStudentVisit = visitor.purpose === PURPOSE_STUDENT_REQUIRED || Boolean(visitor.student_id);
      if (isStudentVisit && visitor.studentApprovalStatus === 'PENDING') {
        if (req.user?.role !== 'admin' && req.user?.role !== 'warden') {
          return res.status(400).json({
            success: false,
            message: 'Cannot admit visitor: Host student must confirm and approve the visit first.',
          });
        }
      }

      visitor.status = 'INSIDE';
      visitor.entryTime = now;
      visitor.loggedBy = req.user?._id;
      visitor.logged_by_name = staffName;
      if (visitor.studentApprovalStatus !== 'APPROVED') {
        visitor.studentApprovalStatus = 'APPROVED';
        visitor.studentApprovalTime = now;
        visitor.studentApprovalRemarks = `Staff override (${staffName}): ${remarks ? String(remarks).trim() : 'Approved at gate'}`;
      }
    } else {
      visitor.studentApprovalStatus = 'REJECTED';
      visitor.status = 'REJECTED';
      visitor.studentApprovalTime = now;
      visitor.studentApprovalRemarks = `Denied at gate (${staffName}): ${remarks ? String(remarks).trim() : 'Rejected by security'}`;
    }

    await visitor.save();

    broadcastVisitorResponse(visitor, action, staffName);
    invalidateDashboardCache().catch(() => {});

    res.json({
      success: true,
      message: `Visitor request ${action === 'APPROVE' ? 'approved' : 'rejected'} by staff.`,
      visitor,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to process staff action', { error: err.message });
    res.status(500).json({ success: false, message: 'Staff action failed: ' + err.message });
  }
});

// ─── POST /api/visitors ───────────────────────────────────────────────────────
// Manual visitor check-in (Guard or Warden)
router.post('/', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const {
      name,
      phone,
      purpose,
      purposeDetails,
      student_id,
      studentRollNo,
      studentName,
      studentHostel,
      studentRoomNo,
      visitorCount: rawVisitorCount,
      hasVehicle: rawHasVehicle,
      vehicleNumber: rawVehicleNumber,
      entryGate,
    } = req.body;

    // Validate Name
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Visitor name is required.' });
    }

    // Validate Phone
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: 'Visitor phone number is required.' });
    }
    const phoneValidation = validateIndianPhone(phone, 'Visitor phone');
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.error });
    }
    const normalizedPhone = phoneValidation.e164 || String(phone).trim();

    // Validate Purpose
    if (!purpose || !String(purpose).trim()) {
      return res.status(400).json({ success: false, message: 'Purpose of visit is required.' });
    }

    // Resolve Student Details if Purpose is 'Meeting a student'
    const isStudentVisit = (purpose === PURPOSE_STUDENT_REQUIRED);
    let resolvedStudentId = null;
    let resolvedStudentName = studentName ? String(studentName).trim() : '';
    let resolvedRollNo = studentRollNo ? String(studentRollNo).trim() : '';
    let resolvedStudentHostel = studentHostel ? String(studentHostel).trim() : '';
    let resolvedStudentRoom = studentRoomNo ? String(studentRoomNo).trim() : '';

    if (isStudentVisit) {
      if (student_id) {
        const targetUser = await User.findById(student_id);
        if (targetUser) {
          resolvedStudentId = targetUser._id;
          resolvedStudentName = targetUser.name || resolvedStudentName;
          resolvedRollNo = targetUser.rollNo || resolvedRollNo;
          resolvedStudentHostel = targetUser.hostel || resolvedStudentHostel;
          resolvedStudentRoom = targetUser.roomNo || resolvedStudentRoom;
        }
      } else if (resolvedRollNo || resolvedStudentName) {
        // Fallback match by roll number or name
        const matchCriteria = [];
        if (resolvedRollNo) matchCriteria.push({ rollNo: resolvedRollNo });
        if (resolvedStudentName) matchCriteria.push({ name: new RegExp(`^${resolvedStudentName}$`, 'i') });
        if (matchCriteria.length > 0) {
          const targetUser = await User.findOne({ role: 'student', $or: matchCriteria });
          if (targetUser) {
            resolvedStudentId = targetUser._id;
            resolvedStudentName = targetUser.name || resolvedStudentName;
            resolvedRollNo = targetUser.rollNo || resolvedRollNo;
            resolvedStudentHostel = targetUser.hostel || resolvedStudentHostel;
            resolvedStudentRoom = targetUser.roomNo || resolvedStudentRoom;
          }
        }
      }

      if (!resolvedStudentName) {
        return res.status(400).json({ success: false, message: 'Student name is required when purpose is "Meeting a student".' });
      }
      if (!resolvedStudentHostel) {
        return res.status(400).json({ success: false, message: 'Student hostel is required.' });
      }
      if (!resolvedStudentRoom) {
        return res.status(400).json({ success: false, message: 'Student room number is required.' });
      }
    }

    // If purpose is 'Other', require purpose details
    if (purpose === PURPOSE_OTHER || String(purpose).trim().toLowerCase() === 'other') {
      if (!purposeDetails || !String(purposeDetails).trim()) {
        return res.status(400).json({ success: false, message: 'Specific reason / details is required when purpose is "Other".' });
      }
    }

    // Parse visitor count defensively
    const countRes = parseVisitorCount(rawVisitorCount);
    if (!countRes.valid) {
      return res.status(400).json({ success: false, message: countRes.error });
    }
    const visitorCount = countRes.count;

    // Parse hasVehicle & vehicleNumber
    const hasVehicle = parseBoolean(rawHasVehicle);
    const vehicleRes = normalizeVehicleNumber(rawVehicleNumber, hasVehicle);
    if (!vehicleRes.valid) {
      return res.status(400).json({ success: false, message: vehicleRes.error });
    }
    const vehicleNumber = vehicleRes.normalized;

    const now = new Date();
    const date = todayStr();
    const passNumber = `VIS-${date.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const loggedByName = req.user?.name || req.user?.email || 'Duty Guard';

    const status = isStudentVisit ? 'PENDING' : 'INSIDE';
    const studentApprovalStatus = isStudentVisit ? 'PENDING' : 'NA';

    const newVisitor = await VisitorLog.create({
      name: String(name).trim(),
      phone: normalizedPhone,
      visitorCount,
      hasVehicle,
      vehicleNumber,
      purpose: String(purpose).trim(),
      purposeDetails: purposeDetails ? String(purposeDetails).trim() : '',
      student_id: resolvedStudentId,
      studentName: resolvedStudentName,
      studentRollNo: resolvedRollNo,
      studentHostel: resolvedStudentHostel,
      studentRoomNo: resolvedStudentRoom,
      studentApprovalStatus,
      status,
      entryTime: isStudentVisit ? null : now,
      exitTime: null,
      date,
      entryGate: entryGate ? String(entryGate).trim() : 'Main Gate',
      loggedBy: req.user?._id || null,
      logged_by_name: loggedByName,
      source: 'MANUAL',
      passNumber,
    });

    // Mask phone and vehicle in application logs for privacy
    logger.info('[Visitor] New visitor pass recorded', {
      visitorId: newVisitor._id,
      passNumber,
      purpose: newVisitor.purpose,
      status,
      studentApprovalStatus,
      studentId: resolvedStudentId,
      visitorCount,
      hasVehicle,
      maskedPhone: maskPhone(normalizedPhone),
      maskedVehicle: maskVehicle(vehicleNumber),
      guard: loggedByName,
    });

    // Real-time broadcast
    if (isStudentVisit) {
      broadcastVisitorRequest(newVisitor, resolvedStudentId);
    } else {
      const io = getIO();
      if (io) {
        io.of('/dashboard').emit('visitor:new', {
          action: 'entry',
          visitor: newVisitor,
          timestamp: now.toISOString(),
        });
        io.of('/scanner').emit('visitor:new', {
          action: 'entry',
          visitor: newVisitor,
          timestamp: now.toISOString(),
        });
      }
    }

    invalidateDashboardCache().catch(() => {});

    res.status(201).json({
      success: true,
      message: isStudentVisit
        ? (resolvedStudentId
            ? 'Visitor pass issued — approval request sent to student.'
            : 'Visitor pass issued awaiting student approval.')
        : 'Visitor entry recorded successfully.',
      visitor: newVisitor,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to create visitor log', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to record visitor: ' + err.message });
  }
});

// ─── POST /api/visitors/:id/exit ──────────────────────────────────────────────
// Mark a visitor as EXITED
router.post('/:id/exit', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const visitor = await VisitorLog.findById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Visitor record not found.' });
    }

    if (visitor.status === 'EXITED') {
      return res.status(400).json({ success: false, message: 'Visitor is already marked as EXITED.' });
    }

    const now = new Date();
    visitor.status = 'EXITED';
    visitor.exitTime = now;
    await visitor.save();

    logger.info('[Visitor] Visitor marked as exited', {
      visitorId: visitor._id,
      passNumber: visitor.passNumber,
      maskedPhone: maskPhone(visitor.phone),
      maskedVehicle: maskVehicle(visitor.vehicleNumber),
      exitTime: now.toISOString(),
    });

    const io = getIO();
    if (io) {
      io.of('/dashboard').emit('visitor:exit', {
        action: 'exit',
        visitor,
        timestamp: now.toISOString(),
      });
      io.of('/scanner').emit('visitor:exit', {
        action: 'exit',
        visitor,
        timestamp: now.toISOString(),
      });
    }

    invalidateDashboardCache().catch(() => {});

    res.json({
      success: true,
      message: 'Visitor exit recorded successfully.',
      visitor,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to record exit', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to record visitor exit: ' + err.message });
  }
});

// ─── POST /api/visitors/webhook ───────────────────────────────────────────────
// Webhook endpoint for Google Forms & Apps Script automation.
// The form URL is kept private — only a QR code is distributed physically at the gate.
// When a studentName / studentRollNo is present → status PENDING (student approves/rejects).
// When no student is mentioned → status INSIDE directly (general campus visitor).
router.post('/webhook', async (req, res) => {
  try {
    // Optional secret verification
    const configuredSecret = process.env.VISITOR_WEBHOOK_SECRET;
    if (configuredSecret) {
      const headerSecret = req.headers['x-webhook-secret'] || req.query.secret;
      if (headerSecret !== configuredSecret) {
        logger.warn('[Visitor Webhook] Unauthorized webhook attempt: invalid secret');
        return res.status(401).json({ success: false, message: 'Invalid webhook secret token.' });
      }
    }

    const {
      purpose,
      purposeDetails,
      studentName,
      studentHostel,
      studentRoomNo,
      name,
      phone,
      visitorCount: rawVisitorCount,
      hasVehicle: rawHasVehicle,
      vehicleNumber: rawVehicleNumber,
      entryGate,
    } = req.body;

    // Validate Name
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Visitor name is required.' });
    }

    // Validate Phone
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: 'Visitor phone number is required.' });
    }
    const phoneValidation = validateIndianPhone(phone, 'Visitor phone');
    const normalizedPhone = phoneValidation.valid ? phoneValidation.e164 : String(phone).trim();

    // Validate Purpose
    const sanitizedPurpose = purpose ? String(purpose).trim() : 'Other';

    // If purpose is 'Other', require purpose details
    if (sanitizedPurpose === PURPOSE_OTHER || sanitizedPurpose.toLowerCase() === 'other') {
      if (!purposeDetails || !String(purposeDetails).trim()) {
        return res.status(400).json({ success: false, message: 'Specific reason / details is required when purpose is "Other".' });
      }
    }

    // Parse visitor count defensively from form string
    const countRes = parseVisitorCount(rawVisitorCount);
    const visitorCount = countRes.valid ? countRes.count : 1;

    // Parse hasVehicle boolean
    const hasVehicle = parseBoolean(rawHasVehicle);

    // Normalize vehicle number if hasVehicle is true; otherwise ignore and set to null
    let vehicleNumber = null;
    if (hasVehicle) {
      const vehRes = normalizeVehicleNumber(rawVehicleNumber, true);
      vehicleNumber = vehRes.valid ? vehRes.normalized : (rawVehicleNumber ? String(rawVehicleNumber).trim().toUpperCase().replace(/[\s-]/g, '') : null);
    }

    // ── Student Lookup ────────────────────────────────────────────────────────
    // If the visitor mentions a student (roll no. or name), route the request
    // as PENDING so the student can approve/reject it from their portal.
    // This mirrors the manual guard entry flow for "Meeting a student" purpose.
    const rawStudentRollNo = req.body.studentRollNo ? String(req.body.studentRollNo).trim() : '';
    const resolvedStudentName = studentName ? String(studentName).trim() : '';
    const resolvedStudentHostel = studentHostel ? String(studentHostel).trim() : '';
    const resolvedStudentRoom = studentRoomNo ? String(studentRoomNo).trim() : '';

    let resolvedStudentId = null;
    let resolvedRollNo = rawStudentRollNo;
    const isStudentVisit = !!(resolvedStudentName || rawStudentRollNo);

    if (isStudentVisit) {
      // Attempt to find the student in the DB for live socket notification
      const matchCriteria = [];
      if (rawStudentRollNo) matchCriteria.push({ rollNo: rawStudentRollNo });
      if (resolvedStudentName) matchCriteria.push({ name: new RegExp(`^${resolvedStudentName}$`, 'i') });
      if (matchCriteria.length > 0) {
        const targetUser = await User.findOne({ role: 'student', $or: matchCriteria });
        if (targetUser) {
          resolvedStudentId = targetUser._id;
          resolvedRollNo = targetUser.rollNo || resolvedRollNo;
        }
      }
    }

    const now = new Date();
    const date = todayStr();
    const passNumber = `VIS-GF-${date.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Student visit → PENDING (student approves/rejects from portal)
    // General visitor → INSIDE directly (no student approval needed)
    const status = isStudentVisit ? 'PENDING' : 'INSIDE';
    const studentApprovalStatus = isStudentVisit ? 'PENDING' : 'NA';

    const newVisitor = await VisitorLog.create({
      name: String(name).trim(),
      phone: normalizedPhone,
      visitorCount,
      hasVehicle,
      vehicleNumber,
      purpose: sanitizedPurpose,
      purposeDetails: purposeDetails ? String(purposeDetails).trim() : '',
      student_id: resolvedStudentId,
      studentName: resolvedStudentName,
      studentRollNo: resolvedRollNo,
      studentHostel: resolvedStudentHostel,
      studentRoomNo: resolvedStudentRoom,
      studentApprovalStatus,
      status,
      entryTime: isStudentVisit ? null : now,
      exitTime: null,
      date,
      entryGate: entryGate ? String(entryGate).trim() : 'Google Form Gate',
      loggedBy: null,
      logged_by_name: 'Google Form Self Check-In',
      source: 'GOOGLE_FORM',
      passNumber,
    });

    logger.info('[Visitor Webhook] Google Form check-in recorded', {
      visitorId: newVisitor._id,
      passNumber,
      purpose: sanitizedPurpose,
      status,
      studentApprovalStatus,
      isStudentVisit,
      visitorCount,
      hasVehicle,
      maskedPhone: maskPhone(normalizedPhone),
      maskedVehicle: maskVehicle(vehicleNumber),
    });

    const io = getIO();
    if (io) {
      if (isStudentVisit) {
        // Push real-time approval popup to the student's portal
        broadcastVisitorRequest(newVisitor, resolvedStudentId);
      } else {
        io.of('/dashboard').emit('visitor:new', {
          action: 'entry',
          visitor: newVisitor,
          timestamp: now.toISOString(),
        });
        io.of('/scanner').emit('visitor:new', {
          action: 'entry',
          visitor: newVisitor,
          timestamp: now.toISOString(),
        });
      }
    }

    invalidateDashboardCache().catch(() => {});

    res.status(201).json({
      success: true,
      message: isStudentVisit
        ? 'Visitor request submitted — awaiting student approval in the portal.'
        : 'Visitor pass created from Google Form.',
      passNumber,
      visitorId: newVisitor._id,
    });
  } catch (err) {
    logger.error('[Visitor Webhook] Failed to process webhook submission', { error: err.message });
    res.status(500).json({ success: false, message: 'Webhook processing error: ' + err.message });
  }
});

// ─── GET /api/visitors/export-data ────────────────────────────────────────────
// Compile visitor data and summary for official PDF / Excel export
router.get('/export-data', protect, authorize('warden', 'hostel_staff', 'admin', 'security'), async (req, res) => {
  try {
    const { date, status, purpose, hasVehicle } = req.query;
    const filter = {};

    if (date && date.trim()) filter.date = date.trim();
    if (status && status !== 'all') filter.status = status.toUpperCase();
    if (purpose && purpose !== 'all') filter.purpose = purpose;
    if (hasVehicle !== undefined && hasVehicle !== '' && hasVehicle !== 'all') {
      filter.hasVehicle = parseBoolean(hasVehicle);
    }

    const records = await VisitorLog.find(filter).sort({ entryTime: -1 }).lean();
    const totalEntries = records.length;
    const totalHeadcount = sumHeadcount(records);
    const insideCount = records.filter((r) => r.status === 'INSIDE').length;
    const insideHeadcount = sumHeadcount(records.filter((r) => r.status === 'INSIDE'));
    const exitedCount = records.filter((r) => r.status === 'EXITED').length;
    const exitedHeadcount = sumHeadcount(records.filter((r) => r.status === 'EXITED'));
    const vehiclesCount = records.filter((r) => r.hasVehicle).length;

    res.json({
      success: true,
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: req.user?.name || 'Authorized Staff',
        role: req.user?.role || 'Staff',
        filter: { date: date || 'All Dates', status: status || 'All Statuses', purpose: purpose || 'All Purposes' },
      },
      summary: {
        totalEntries,
        totalHeadcount,
        insideCount,
        insideHeadcount,
        exitedCount,
        exitedHeadcount,
        vehiclesCount,
      },
      records,
    });
  } catch (err) {
    logger.error('[Visitor Route] Failed to compile export data', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to generate export data: ' + err.message });
  }
});

// ─── DELETE /api/visitors/:id ─────────────────────────────────────────────────
// Delete visitor log (Warden/Admin only)
router.delete('/:id', protect, authorize('warden', 'hostel_staff', 'admin'), async (req, res) => {
  try {
    const visitor = await VisitorLog.findByIdAndDelete(req.params.id);
    if (!visitor) {
      return res.status(404).json({ success: false, message: 'Visitor record not found.' });
    }

    logger.info('[Visitor] Record deleted by admin/warden', {
      visitorId: req.params.id,
      deletedBy: req.user?.name,
    });

    res.json({ success: true, message: 'Visitor log deleted successfully.' });
  } catch (err) {
    logger.error('[Visitor Route] Failed to delete visitor log', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to delete record: ' + err.message });
  }
});

module.exports = router;
