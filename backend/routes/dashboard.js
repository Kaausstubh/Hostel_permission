/**
 * Dashboard Routes
 * GET /api/dashboard/summary   - Warden: full overview stats
 * GET /api/dashboard/students  - List all students (warden)
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');
const { protect, authorize } = require('../middleware/auth');

const todayStr = () => new Date().toISOString().split('T')[0];
const getPagination = (query, defaultLimit = 50, maxLimit = 200) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── Dashboard Summary ─────────────────────────────────────────────────────────
router.get('/summary', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    const today = todayStr();

    const [
      totalStudents,
      studentsOut,
      notReturned,
      pendingHomeVisits,
      pendingComplaints,
      totalComplaints,
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      InOutLog.countDocuments({ status: 'OUT', returned: false, date: today }),
      InOutLog.countDocuments({ status: 'OUT', returned: false, date: today, alertSent: true }),
      HomeVisitLog.countDocuments({ overall_status: { $in: ['pending', 'parent_approved'] } }),
      Complaint.countDocuments({ status: 'pending' }),
      Complaint.countDocuments({}),
    ]);

    res.json({
      success: true,
      summary: {
        totalStudents,
        studentsOut,
        notReturned,
        pendingHomeVisits,
        pendingComplaints,
        totalComplaints,
        date: today,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Student List ──────────────────────────────────────────────────────────────
router.get('/students', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, 50, 200);
    const filter = { role: 'student' };
    const [students, count] = await Promise.all([
      User.find(filter)
        .select('name rollNumber hostel phone email createdAt')
        .sort({ hostel: 1, name: 1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, students });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
