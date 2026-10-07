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
const { getLogsCache, setLogsCache, invalidateLogsCache } = require('../services/logsCache');
const logger = require('../utils/logger');
const { recordDeletionAudit, getStorageStats } = require('../services/storageStatsService');

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const getPagination = (query, defaultLimit = 50, maxLimit = 2000) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ── Log Storage Capacity & Deletion Audit Stats (Warden/Admin/Security) ─────
router.get('/storage-stats', protect, authorize('warden', 'admin', 'security'), async (req, res) => {
  try {
    const stats = await getStorageStats();
    res.json({ success: true, ...stats });
  } catch (error) {
    logger.error('[Dashboard] Storage stats error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

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
    const { page, limit, skip } = getPagination(req.query, 50, 2000);
    const hostel = req.query.hostel ? req.query.hostel.toUpperCase() : '';
    const search = req.query.search ? req.query.search.trim() : '';

    const cacheKey = `logs:students:${req.user.role}:${page}:${limit}:${hostel}:${search}`;
    const cached = await getLogsCache(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached, cached: true });
    }

    // Optional filters
    const filter = { role: 'student' };
    if (hostel) filter.hostel = hostel;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { rollNo: { $regex: search, $options: 'i' } },
      ];
    }

    const studentSelect =
      req.user.role === 'security'
        ? 'name rollNo hostel createdAt'
        : 'name rollNo hostel phone email parentPhone parentPhone2 createdAt isActive';

    const [rawStudents, count] = await Promise.all([
      User.find(filter)
        .select(studentSelect)
        .sort({ hostel: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(8000),
      User.countDocuments(filter).maxTimeMS(5000),
    ]);

    const students = rawStudents.map((s) => ({
      ...s,
      studentPhoto: `/api/auth/student-photo/${s._id}`,
    }));

    const responsePayload = { count, page, limit, students };
    await setLogsCache(cacheKey, responsePayload, 60);

    res.json({ success: true, ...responsePayload, cached: false });
  } catch (error) {
    logger.error('[Dashboard] Students list error', { error: error.message, requestId: req.requestId });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Delete Individual Student ────────────────────────────────────────────────
router.delete('/students/:id', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Cascade delete associated operational records
    await Promise.all([
      InOutLog.deleteMany({ $or: [{ student_id: student._id }, { student: student._id }] }),
      HomeVisitLog.deleteMany({ $or: [{ student_id: student._id }, { student: student._id }] }),
      Complaint.deleteMany({ $or: [{ student_id: student._id }, { student: student._id }] }),
      User.findByIdAndDelete(student._id),
    ]);

    await invalidateLogsCache();

    logger.info('[Dashboard] Student deleted by warden', {
      wardenId: req.user._id,
      deletedStudentId: student._id,
      name: student.name,
      rollNo: student.rollNo,
    });

    res.json({ success: true, message: `Student ${student.name} and their records were deleted successfully.` });
  } catch (error) {
    logger.error('[Dashboard] Delete student error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Wipe Operational or Student Records ──────────────────────────────────────
router.post('/wipe-records', protect, authorize('warden', 'admin', 'security'), async (req, res) => {
  try {
    const { wipeStudents, target } = req.body;

    if (req.user.role === 'security' && target !== 'inout' && target !== 'homevisit') {
      return res.status(403).json({ success: false, message: 'Security personnel can only clear gate scan or home visit logs' });
    }

    if (target === 'inout') {
      const inoutRes = await InOutLog.deleteMany({});
      await invalidateLogsCache();
      await recordDeletionAudit({
        user: req.user,
        action: 'DELETE_ALL_GATE',
        targetType: 'GATE_INOUT',
        deletedCount: inoutRes.deletedCount,
        description: `Wiped all ${inoutRes.deletedCount} In/Out scan logs`,
      });
      logger.info('[Dashboard] In/Out logs cleared', { userId: req.user._id, role: req.user.role, inoutDeleted: inoutRes.deletedCount });
      return res.json({
        success: true,
        message: `Successfully deleted ${inoutRes.deletedCount} In/Out scan logs. Action recorded under ${req.user.name || req.user.email}.`,
        deleted: { inout: inoutRes.deletedCount },
        deletedByName: req.user.name || req.user.email,
      });
    }

    if (target === 'homevisit') {
      const homeRes = await HomeVisitLog.deleteMany({});
      await invalidateLogsCache();
      await recordDeletionAudit({
        user: req.user,
        action: 'DELETE_ALL_HOME',
        targetType: 'HOME_VISIT',
        deletedCount: homeRes.deletedCount,
        description: `Wiped all ${homeRes.deletedCount} Home Visit pass records`,
      });
      logger.info('[Dashboard] Home visit logs cleared', { userId: req.user._id, role: req.user.role, homeDeleted: homeRes.deletedCount });
      return res.json({
        success: true,
        message: `Successfully deleted ${homeRes.deletedCount} Home Visit records. Action recorded under ${req.user.name || req.user.email}.`,
        deleted: { homevisit: homeRes.deletedCount },
        deletedByName: req.user.name || req.user.email,
      });
    }

    const inoutRes = await InOutLog.deleteMany({});
    const homeRes = await HomeVisitLog.deleteMany({});
    const complaintRes = await Complaint.deleteMany({});
    await invalidateLogsCache();

    let studentsDeleted = 0;
    if (wipeStudents) {
      // Delete all student accounts (preserves warden and security staff accounts)
      const userRes = await User.deleteMany({ role: 'student' });
      studentsDeleted = userRes.deletedCount;
    }

    logger.info('[Dashboard] Records wiped by warden', {
      wardenId: req.user._id,
      wipeStudents: Boolean(wipeStudents),
      studentsDeleted,
      inoutDeleted: inoutRes.deletedCount,
      homeDeleted: homeRes.deletedCount,
    });

    res.json({
      success: true,
      message: wipeStudents
        ? `Successfully wiped all ${studentsDeleted} students and all pass/request records.`
        : `Successfully cleared ${inoutRes.deletedCount} In/Out and ${homeRes.deletedCount} Home Visit logs. Student accounts remain safe.`,
      deleted: {
        students: studentsDeleted,
        inout: inoutRes.deletedCount,
        homeVisits: homeRes.deletedCount,
        complaints: complaintRes.deletedCount,
      },
    });
  } catch (error) {
    logger.error('[Dashboard] Wipe records error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
