/**
 * Dashboard Routes — with Redis caching + Socket.IO integration
 * GET /api/dashboard/summary  - Warden: full overview stats (cached 30s)
 * GET /api/dashboard/students - List all students (warden, paginated)
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');
const { protect, authorize } = require('../middleware/auth');
const { getDashboardCache, setDashboardCache } = require('../services/dashboardCache');
const logger = require('../utils/logger');

const todayStr = () => new Date().toISOString().split('T')[0];
const getPagination = (query, defaultLimit = 50, maxLimit = 200) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ── Dashboard Summary ─────────────────────────────────────────────────────────
router.get('/summary', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    // ⚡ Try cache first (30s TTL) — dramatically reduces DB load during rush hours
    const cached = await getDashboardCache();
    if (cached) {
      return res.json({ success: true, summary: cached, cached: true });
    }

    const today = todayStr();

    // All 7 queries run in parallel — total time ≈ slowest single query (~25ms)
    const [
      totalStudents,
      studentsOut,
      notReturned,
      pendingHomeVisits,
      pendingComplaints,
      totalComplaints,
      homeScanRecords,
    ] = await Promise.all([
      User.countDocuments({ role: 'student' }).maxTimeMS(5000),
      InOutLog.countDocuments({ status: 'OUT', returned: false, date: today }).maxTimeMS(5000),
      InOutLog.countDocuments({ status: 'OUT', returned: false, date: today, alertSent: true }).maxTimeMS(5000),
      HomeVisitLog.countDocuments({ overall_status: { $in: ['pending', 'parent_approved'] } }).maxTimeMS(5000),
      Complaint.countDocuments({ status: 'pending' }).maxTimeMS(5000),
      Complaint.countDocuments({}).maxTimeMS(5000),
      HomeVisitLog.countDocuments({
        $or: [
          { actual_out_time: { $ne: null } },
          { actual_in_time: { $ne: null } },
          { overall_status: 'completed' },
        ],
      }).maxTimeMS(5000),
    ]);

    const summary = {
      totalStudents,
      studentsOut,
      notReturned,
      pendingHomeVisits,
      pendingComplaints,
      totalComplaints,
      homeScanRecords,
      date: today,
    };

    // Cache the result
    await setDashboardCache(summary);

    res.json({ success: true, summary, cached: false });
  } catch (error) {
    logger.error('[Dashboard] Summary error', { error: error.message, requestId: req.requestId });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Student List ──────────────────────────────────────────────────────────────
router.get('/students', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, 50, 200);

    // Optional filters
    const filter = { role: 'student' };
    if (req.query.hostel) filter.hostel = req.query.hostel.toUpperCase();
    if (req.query.search) {
      const s = req.query.search.trim();
      filter.$or = [
        { name: { $regex: s, $options: 'i' } },
        { rollNo: { $regex: s, $options: 'i' } },
      ];
    }

    const studentSelect =
      req.user.role === 'security'
        ? 'name rollNo hostel createdAt'
        : 'name rollNo hostel phone email parentPhone createdAt isActive';

    const [students, count] = await Promise.all([
      User.find(filter)
        .select(studentSelect)
        .sort({ hostel: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(8000),
      User.countDocuments(filter).maxTimeMS(5000),
    ]);

    res.json({ success: true, count, page, limit, students });
  } catch (error) {
    logger.error('[Dashboard] Students list error', { error: error.message, requestId: req.requestId });
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
