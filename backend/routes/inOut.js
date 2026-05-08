/**
 * In/Out Routes
 * POST /api/inout/generate-qr  - Student generates a QR code
 * POST /api/inout/scan         - Security scans QR to mark IN/OUT
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
      type: 'inout',
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

// ─── Scan QR (Security Dashboard) ────────────────────────────────────────────
router.post('/scan', protect, authorize('security', 'warden'), async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    // Validate JWT signature + expiry
    const { valid, payload, error } = validateQR(token);
    if (!valid) return res.status(400).json({ success: false, message: error });

    if (payload.type !== 'inout') {
      return res.status(400).json({ success: false, message: 'Invalid QR type for this scanner' });
    }

    const student = await User.findById(payload.student_id);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    // Single-QR flow:
    // - First scan creates an OUT record (out_time)
    // - Second scan updates the SAME record to IN (in_time) and marks returned=true
    const existing = await InOutLog.findOne({ qr_token: token });
    const now = new Date();

    let log;
    let status;

    if (!existing) {
      status = 'OUT';
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
      // Keep token active: it must be scanned again for IN.
    } else {
      if (existing.returned) {
        return res.status(400).json({ success: false, message: 'QR code already fully used (OUT+IN complete)' });
      }
      if (existing.status !== 'OUT') {
        return res.status(400).json({ success: false, message: 'Invalid state for this QR' });
      }
      status = 'IN';
      existing.status = 'IN';
      existing.in_time = now;
      existing.timestamp = now;
      existing.returned = true;
      existing.scannedBy = req.user._id;
      await existing.save();
      log = existing;

      // Remove from active store — QR has been fully consumed now
      await removeActiveQR(token);
    }

    res.json({
      success: true,
      message: `Student marked as ${status}`,
      student: { name: student.name, rollNumber: student.rollNo, hostel: student.hostel },
      log: { status, timestamp: log.timestamp, out_time: log.out_time, in_time: log.in_time, returned: log.returned },
    });
  } catch (error) {
    console.error('Scan error:', error);
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
    const studentSelect = req.user.role === 'security' ? 'name rollNo hostel' : 'name rollNo hostel phone';

    const [logs, count] = await Promise.all([
      InOutLog.find(filter)
        .populate('student_id', studentSelect)
        .populate('scannedBy', 'name rollNo email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
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
    const filter = {
      status: 'OUT',
      returned: false,
      date: todayStr(),
    };
    const studentSelect = req.user.role === 'security' ? 'name rollNo hostel' : 'name rollNo hostel phone parentPhone';
    const [logs, count] = await Promise.all([
      InOutLog.find(filter)
        .populate('student_id', studentSelect)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      InOutLog.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, students: logs });
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
        .limit(limit),
      InOutLog.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Pending Active QRs (Security Dashboard live panel) ──────────────────────────────────────────
// Returns all QR codes that have been generated but NOT yet scanned
router.get('/pending-qrs', protect, authorize('warden', 'security'), async (req, res) => {
  const qrs = await getActiveQRs(); // prunes expired automatically
  res.json({ success: true, count: qrs.length, qrs });
});

module.exports = router;
