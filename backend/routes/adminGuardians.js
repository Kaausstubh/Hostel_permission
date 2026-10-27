/**
 * Admin & Hostel Staff Guardian Management Routes
 *
 * Endpoints (protect, authorize('warden', 'hostel_staff', 'admin')):
 *  GET  /api/admin/guardians/students      - Student directory with guardian linking status
 *  GET  /api/admin/guardians/detail/:id   - Detailed guardian info for a student
 *  POST /api/admin/guardians/link-initial  - Link initial guardians for existing student
 *  POST /api/admin/guardians/resend-invite - Resend invite token (rate limited)
 *  PUT  /api/admin/guardians/update        - Update guardian details with audit logging
 *  GET  /api/admin/guardians/export        - Export CSV of parent approvals & overrides
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const User = require('../models/User');
const Guardian = require('../models/Guardian');
const ParentApproval = require('../models/ParentApproval');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const { protect, authorize } = require('../middleware/auth');
const {
  linkInitialGuardians,
  resendInvitation,
  updateGuardianDetails,
} = require('../services/guardianService');
const logger = require('../utils/logger');

router.use(protect, authorize('warden', 'hostel_staff', 'admin'));

// ── GET /students ────────────────────────────────────────────────────────────
router.get('/students', async (req, res) => {
  try {
    const { search, hostel, linkStatus, page = 1, limit = 50 } = req.query;
    const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, parseInt(limit, 10));

    const filter = { role: 'student' };
    if (hostel && hostel !== 'all') filter.hostel = hostel;
    if (search && search.trim()) {
      const q = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { rollNo: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ];
    }

    const students = await User.find(filter)
      .select('name rollNo email hostel roomNo phone parentPhone parentPhone2 studentPhoto')
      .sort({ rollNo: 1, name: 1 })
      .skip(skip)
      .limit(parseInt(limit, 10))
      .lean();

    const studentIds = students.map((s) => s._id);
    const guardians = await Guardian.find({ student_id: { $in: studentIds } }).lean();

    const guardianMap = new Map();
    guardians.forEach((g) => {
      const sId = String(g.student_id);
      if (!guardianMap.has(sId)) guardianMap.set(sId, []);
      guardianMap.get(sId).push({
        ...g,
        slot: g.guardian_slot || g.slot,
      });
    });

    const enriched = students.map((s) => {
      const sGuardians = guardianMap.get(String(s._id)) || [];
      let status = 'NOT_LINKED';
      if (sGuardians.length > 0) {
        const allActive = sGuardians.every((g) => g.status === 'ACTIVE');
        const anyActive = sGuardians.some((g) => g.status === 'ACTIVE');
        status = allActive ? 'ACTIVE' : anyActive ? 'PARTIALLY_ACTIVE' : 'INVITED';
      }
      return {
        ...s,
        guardianStatus: status,
        guardians: sGuardians,
      };
    });

    // Optional filter by computed status
    let finalStudents = enriched;
    const requestedStatus = (req.query.status || req.query.linkStatus || '').toUpperCase();
    if (requestedStatus && requestedStatus !== 'ALL') {
      if (requestedStatus === 'LINKED') {
        finalStudents = enriched.filter((s) => s.guardianStatus === 'ACTIVE');
      } else if (requestedStatus === 'PARTIAL') {
        finalStudents = enriched.filter((s) => s.guardianStatus === 'PARTIALLY_ACTIVE' || s.guardianStatus === 'INVITED');
      } else if (requestedStatus === 'NOT_LINKED') {
        finalStudents = enriched.filter((s) => s.guardianStatus === 'NOT_LINKED');
      } else {
        finalStudents = enriched.filter((s) => s.guardianStatus === requestedStatus);
      }
    }

    const totalCount = await User.countDocuments(filter);
    const parsedLimit = parseInt(limit, 10) || 15;
    const parsedPage = parseInt(page, 10) || 1;

    return res.json({
      success: true,
      students: finalStudents,
      totalCount,
      page: parsedPage,
      pagination: {
        page: parsedPage,
        totalPages: Math.ceil(totalCount / parsedLimit) || 1,
        total: totalCount,
      },
    });
  } catch (err) {
    logger.error('[AdminGuardians] Get students error', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /detail/:id ──────────────────────────────────────────────────────────
router.get('/detail/:id', async (req, res) => {
  try {
    const student = await User.findById(req.params.id)
      .select('name rollNo email hostel roomNo phone parentPhone parentPhone2 studentPhoto')
      .lean();

    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const guardians = await Guardian.find({ student_id: student._id }).sort({ guardian_slot: 1 }).lean();
    const audits = await ApprovalAuditLog.find({ student_id: student._id }).sort({ timestamp: -1 }).limit(30).lean();

    return res.json({
      success: true,
      student,
      guardians,
      audits,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /link-initial ───────────────────────────────────────────────────────
router.post('/link-initial', async (req, res) => {
  try {
    const studentId = req.body.studentId || req.body.student_id;
    const guardian1 = req.body.guardian1 || req.body.guardian_1;
    const guardian2 = req.body.guardian2 || req.body.guardian_2;

    if (!studentId || !guardian1) {
      return res.status(400).json({ success: false, message: 'Student ID and primary guardian details are required' });
    }

    const result = await linkInitialGuardians({
      studentId,
      guardian1,
      guardian2,
      ip: req.ip,
      actorId: req.user._id,
    });

    return res.json({
      success: true,
      message: 'Guardians successfully linked and invitations dispatched.',
      ...result,
    });
  } catch (err) {
    logger.warn('[AdminGuardians] Link initial error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /resend-invite ──────────────────────────────────────────────────────
router.post(['/resend-invite', '/resend-invite/:guardianId'], async (req, res) => {
  try {
    const guardianId = req.params.guardianId || req.body.guardianId;
    if (!guardianId) return res.status(400).json({ success: false, message: 'Guardian ID is required' });

    const result = await resendInvitation({
      guardianId,
      actorUser: req.user,
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: 'Invitation resent successfully.',
      inviteUrl: result?.inviteUrl || null,
    });
  } catch (err) {
    logger.warn('[AdminGuardians] Resend invite error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── PUT /update ──────────────────────────────────────────────────────────────
router.put(['/update', '/update/:guardianId'], async (req, res) => {
  try {
    const guardianId = req.params.guardianId || req.body.guardianId;
    const { name, relationship, phone, email, reason } = req.body;
    if (!guardianId) return res.status(400).json({ success: false, message: 'Guardian ID is required' });

    const updated = await updateGuardianDetails({
      guardianId,
      updates: { name, relationship, phone, email },
      actorUser: req.user,
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: 'Guardian details updated successfully.',
      guardian: updated,
    });
  } catch (err) {
    logger.warn('[AdminGuardians] Update guardian error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── GET /export ──────────────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.decided_at = {};
      if (startDate) filter.decided_at.$gte = new Date(startDate);
      if (endDate) {
        const d = new Date(endDate);
        d.setHours(23, 59, 59, 999);
        filter.decided_at.$lte = d;
      }
    }

    const approvals = await ParentApproval.find(filter)
      .populate('student_id', 'name rollNo hostel roomNo')
      .populate('guardian_id', 'relationship')
      .populate('home_visit_request_id', 'leave_date return_date place reason')
      .populate('staff_user_id', 'name email')
      .sort({ decided_at: -1 })
      .lean();

    // Generate CSV
    const headers = [
      'Record ID',
      'Student Name',
      'Roll Number',
      'Hostel',
      'Room',
      'Leave Date',
      'Return Date',
      'Destination',
      'Reason',
      'Decision',
      'Decision Source',
      'Decided At (IST)',
      'Decided By Name',
      'Decided By Phone',
      'Decided By Email',
      'Guardian Relationship',
      'Remarks',
      'Staff Override By',
      'Override Reason',
      'IP Address',
    ];

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = approvals.map((a) => {
      const istTime = new Date(a.decided_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
      });
      return [
        a._id,
        a.student_id?.name || 'N/A',
        a.student_id?.rollNo || 'N/A',
        a.student_id?.hostel || 'N/A',
        a.student_id?.roomNo || 'N/A',
        a.home_visit_request_id?.leave_date || 'N/A',
        a.home_visit_request_id?.return_date || 'N/A',
        a.home_visit_request_id?.place || 'N/A',
        a.home_visit_request_id?.reason || 'N/A',
        a.decision,
        a.decision_source,
        istTime,
        a.decided_by_name || 'N/A',
        a.decided_by_phone || 'N/A',
        a.decided_by_email || 'N/A',
        a.guardian_id?.relationship || 'N/A',
        a.remarks || '',
        a.staff_user_id?.name || (a.decision_source === 'STAFF_PHONE_OVERRIDE' ? a.decided_by_email : 'N/A'),
        a.override_reason || '',
        a.ip_address || '',
      ].map(escapeCsv).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=parent_approvals_${Date.now()}.csv`);
    return res.status(200).send(csvContent);
  } catch (err) {
    logger.error('[AdminGuardians] Export error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Export failed' });
  }
});

module.exports = router;
