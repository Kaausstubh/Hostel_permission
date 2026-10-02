/**
 * In/Out Routes
 * POST /api/inout/generate-qr  - Student generates a QR code
 * POST /api/inout/scan         - Security scans QR to mark IN/OUT (legacy — prefer /api/gatescan/scan)
 * GET  /api/inout/logs         - Warden views all logs
 * GET  /api/inout/not-returned - Get not-returned students (today)
 * GET  /api/inout/history/:id  - Student history
 */

const express = require('express');
const router = express.Router();
const InOutLog = require('../models/InOutLog');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { generateQR, renderQRFromToken, validateQR, registerActiveQR, removeActiveQR, getActiveQRs } = require('../services/qrService');
const { withScanLock } = require('../services/scanLockService');
const logger = require('../utils/logger');
const getPagination = (query, defaultLimit = 50, maxLimit = 200) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// Utility: today's date string YYYY-MM-DD
const todayStr = () => new Date().toISOString().split('T')[0];

// ─── Generate QR ──────────────────────────────────────────────────────────────
// Student calls this to get a QR code they show at the gate
router.post('/generate-qr', protect, authorize('student'), async (req, res) => {
  try {
    const studentId = req.user._id.toString();

    // If there's an active session (OUT done but IN pending), re-issue the same QR.
    const activeSession = await InOutLog.findOne({
      student_id: studentId,
      date: todayStr(),
      returned: false,
    }).sort({ createdAt: -1 });

    if (activeSession) {
      const { qrDataUrl, qrPublicUrl, qrFilename } = await renderQRFromToken(
        activeSession.qr_token,
        `inout_${studentId}_active`
      );

      await registerActiveQR(activeSession.qr_token, {
        studentId,
        studentName: req.user.name,
        hostel: req.user.hostel || 'N/A',
        rollNumber: req.user.rollNo || 'N/A',
        scanType: activeSession.status === 'OUT' ? 'IN' : 'OUT',
        qrFilename,
        qrPublicUrl,
        qrDataUrl,
      });

      return res.json({
        success: true,
        message: `Active gate pass found. Use the SAME QR for your next scan (${activeSession.status === 'OUT' ? 'IN' : 'OUT'}).`,
        next_scan: activeSession.status === 'OUT' ? 'IN' : 'OUT',
        qrDataUrl,
        qrPublicUrl,
        token: activeSession.qr_token,
        expiresIn: `${process.env.QR_EXPIRY_SECONDS || 3600} seconds`,
      });
    }

    const payload = {
      // IMPORTANT: must match 'inout_request' so the unified /api/gatescan/scan
      // endpoint can correctly route this QR type.
      type: 'inout_request',
      student_id: studentId,
      date: todayStr(),
    };

    const { token, qrDataUrl, qrPublicUrl, qrFilename } = await generateQR(payload, `inout_${studentId}_${Date.now()}`);

    // Register in active store so Security Dashboard can see pending QRs
    await registerActiveQR(token, {
      studentId: studentId,
      studentName: req.user.name,
      hostel: req.user.hostel || 'N/A',
      rollNumber: req.user.rollNo || 'N/A',
      scanType: 'OUT',
      qrFilename,
      qrPublicUrl,
      qrDataUrl,
    });

    res.json({
      success: true,
      message: `Gate pass QR generated. Use the SAME QR to scan OUT and then IN.`,
      next_scan: 'OUT',
      qrDataUrl,
      qrPublicUrl,
      token,
      expiresIn: `${process.env.QR_EXPIRY_SECONDS || 3600} seconds`,
    });
  } catch (error) {
    console.error('Generate QR error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Scan QR (Legacy — prefer /api/gatescan/scan for new flows) ──────────────
// This endpoint is kept for backward compatibility.
// It now uses the distributed scan lock for race condition protection.
router.post('/scan', protect, authorize('security', 'warden'), async (req, res) => {
  const scanStart = Date.now();
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    const result = await withScanLock(token, async () => {
      // Validate JWT signature + expiry
      const { valid, payload, error } = validateQR(token);
      if (!valid) return { status: 400, body: { success: false, message: error } };

      // Accept both 'inout' (old) and 'inout_request' (new) types
      if (payload.type !== 'inout' && payload.type !== 'inout_request') {
        return { status: 400, body: { success: false, message: 'Invalid QR type for this scanner' } };
      }

      const student = await User.findById(payload.student_id).lean();
      if (!student) return { status: 404, body: { success: false, message: 'Student not found' } };

      const existing = await InOutLog.findOne({ qr_token: token }).lean().maxTimeMS(5000);
      const now = new Date();

      let log;
      let status;

      if (!existing) {
        status = 'OUT';
        try {
          log = await InOutLog.create({
            student_id: payload.student_id,
            name: student.name || '',
            rollNo: student.rollNo || '',
            email: student.email || '',
            phone: student.phone || '',
            parentPhone: student.parentPhone || '',
            hostel: student.hostel || '',
            qr_token: token,
            status,
            out_time: now,
            in_time: null,
            timestamp: now,
            date: todayStr(),
            returned: false,
            scannedBy: req.user._id,
          });
        } catch (err) {
          if (err?.code === 11000) {
            return { status: 200, body: { success: true, message: 'Student already marked as OUT',
              student: { name: student.name, rollNumber: student.rollNo, hostel: student.hostel },
              log: { status: 'OUT', timestamp: now } } };
          }
          throw err;
        }
      } else {
        if (existing.returned) {
          return { status: 400, body: { success: false, message: 'QR code already fully used (OUT+IN complete)' } };
        }
        if (existing.status !== 'OUT') {
          return { status: 400, body: { success: false, message: 'Invalid state for this QR' } };
        }
        status = 'IN';
        log = await InOutLog.findByIdAndUpdate(existing._id, {
          $set: { status: 'IN', in_time: now, timestamp: now, returned: true, scannedBy: req.user._id }
        }, { new: true }).lean();
        await removeActiveQR(token);
      }

      return {
        status: 200,
        body: {
          success: true,
          message: `Student marked as ${status}`,
          student: { name: student.name, rollNumber: student.rollNo, hostel: student.hostel },
          log: { status, timestamp: log.timestamp, out_time: log.out_time, in_time: log.in_time, returned: log.returned },
          scanDuration: Date.now() - scanStart,
        },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    logger.error('[InOut] Scan error', { error: error.message, requestId: req.requestId });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── All Logs (Warden) ────────────────────────────────────────────────────────
router.get('/logs', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    const { date, status } = req.query;
    const { page, limit, skip } = getPagination(req.query, 50, 200);
    const filter = {};
    if (date) filter.date = date;
    if (status) filter.status = status.toUpperCase();
    const studentSelect = req.user.role === 'security' ? 'name rollNo hostel picture' : 'name rollNo hostel phone picture';

    const [logs, count] = await Promise.all([
      InOutLog.find(filter)
        .populate('student_id', studentSelect)
        .populate('scannedBy', 'name rollNo email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InOutLog.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Not Returned Students (Today) ───────────────────────────────────────────
router.get('/not-returned', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query, 50, 200);
    const today = todayStr();

    // 1. Strictly exclude any students who are currently on an approved / active Home Visit!
    // Home visits are multi-day leaves with parent consent; they must NEVER be treated as daily curfew breaches.
    const HomeVisitLog = require('../models/HomeVisitLog');
    const activeHomeVisits = await HomeVisitLog.find({
      overall_status: { $in: ['approved', 'completed'] },
      leave_date: { $lte: today },
      return_date: { $gte: today },
    }).distinct('student_id');

    const filter = {
      status: 'OUT',
      returned: false,
      date: today,
    };

    if (activeHomeVisits && activeHomeVisits.length > 0) {
      filter.student_id = { $nin: activeHomeVisits };
    }

    // 2. Curfew threshold: 8:00 PM (20:00 local IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const currentHour = istDate.getUTCHours();
    const currentMinute = istDate.getUTCMinutes();
    const isPastCurfew = currentHour > 20 || (currentHour === 20 && currentMinute >= 0);

    const studentSelect = req.user.role === 'security'
      ? 'name rollNo hostel picture studentPhoto'
      : 'name rollNo hostel phone parentPhone picture studentPhoto';

    const [logs, count] = await Promise.all([
      InOutLog.find(filter)
        .populate('student_id', studentSelect)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InOutLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      curfewTime: '8:00 PM',
      isPastCurfew,
      curfewHour: 20,
      students: logs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Student History ──────────────────────────────────────────────────────────
router.get('/history/:id', protect, async (req, res) => {
  try {
    // Students can only view their own history; warden can view anyone
    if (req.user.role === 'student' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { page, limit, skip } = getPagination(req.query, 50, 200);
    const filter = { student_id: req.params.id };
    const [logs, count] = await Promise.all([
      InOutLog.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InOutLog.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Delete Individual Gate Log (Warden/Admin) ──────────────────────────────────
router.delete('/:id', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const log = await InOutLog.findByIdAndDelete(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: 'Gate log record not found' });
    logger.info('[InOut] Warden deleted log record', { id: req.params.id, warden: req.user.email });
    res.json({ success: true, message: 'Gate log record deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Bulk Purge Gate Logs by Cutoff Date (Warden/Admin) ──────────────────────
router.post('/purge', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { cutoffDate } = req.body;
    if (!cutoffDate) {
      return res.status(400).json({ success: false, message: 'cutoffDate is required (YYYY-MM-DD)' });
    }
    const cutoff = new Date(cutoffDate + 'T23:59:59.999Z');
    const result = await InOutLog.deleteMany({
      $or: [
        { timestamp: { $lte: cutoff } },
        { createdAt: { $lte: cutoff } },
        { date: { $lte: cutoffDate } }
      ]
    });
    logger.info('[InOut] Warden purged records', { cutoffDate, deletedCount: result.deletedCount, warden: req.user.email });
    res.json({ success: true, deletedCount: result.deletedCount || 0, message: `Purged ${result.deletedCount || 0} gate logs` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
