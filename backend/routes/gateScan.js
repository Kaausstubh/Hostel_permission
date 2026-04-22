/**
 * Unified Gate Scanner Routes
 * - GET  /api/gatescan/pending-qrs  - Combined pending list (in/out + home visit)
 * - POST /api/gatescan/scan         - Scan token and dispatch by payload.type
 *
 * This keeps the security UI simple: one scanner for all QR types.
 */
const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const {
  validateQR,
  getActiveQRs,
  registerActiveQR,
  removeActiveQR,
} = require('../services/qrService');

const todayStr = () => new Date().toISOString().split('T')[0];

router.use(protect, authorize('warden', 'security'));

router.get('/pending-qrs', async (req, res) => {
  const qrs = await getActiveQRs();
  res.json({ success: true, count: qrs.length, qrs });
});

router.post('/scan', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    const { valid, payload, error } = validateQR(token);
    if (!valid) return res.status(400).json({ success: false, message: error });

    // ── In/Out single-QR flow ───────────────────────────────────────────────
    if (payload.type === 'inout') {
      const student = await User.findById(payload.student_id);
      if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

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

        // Keep token pending for the second scan (ENTRY)
        await registerActiveQR(token, {
          qrType: 'inout',
          studentId: payload.student_id,
          studentName: student.name,
          hostel: student.hostel || 'N/A',
          rollNumber: student.rollNo || 'N/A',
          scanType: 'IN',
        });
      } else {
        if (existing.returned) {
          return res.status(400).json({ success: false, message: 'QR code already fully used (OUT+IN complete)' });
        }
        status = 'IN';
        existing.status = 'IN';
        existing.in_time = now;
        existing.timestamp = now;
        existing.returned = true;
        existing.scannedBy = req.user._id;
        await existing.save();
        log = existing;

        await removeActiveQR(token);
      }

      return res.json({
        success: true,
        message: `Student marked as ${status}`,
        kind: 'inout',
        student: { name: student.name, rollNumber: student.rollNo, hostel: student.hostel },
        log: { status, timestamp: log.timestamp, out_time: log.out_time, in_time: log.in_time, returned: log.returned },
      });
    }

    // ── Home visit (same QR: HOME OUT then HOME IN) ─────────────────────────
    if (payload.type === 'home_visit') {
      const visit = await HomeVisitLog.findById(payload.visit_id).populate('student_id');
      if (!visit || visit.overall_status !== 'approved') {
        return res.status(400).json({ success: false, message: 'Visit not found or not approved' });
      }

      const student = visit.student_id;
      const now = new Date();

      let scanResult;
      if (!visit.qr_used_out) {
        visit.qr_used_out = true;
        visit.actual_out_time = now;
        scanResult = 'HOME OUT';

        // Keep token pending for the second scan (HOME RETURN)
        await registerActiveQR(token, {
          qrType: 'home_visit',
          studentId: student._id.toString(),
          studentName: student.name,
          hostel: student.hostel || 'N/A',
          rollNumber: student.rollNo || 'N/A',
          scanType: 'HOME IN',
        });
      } else if (!visit.qr_used_in) {
        visit.qr_used_in = true;
        visit.actual_in_time = now;
        visit.overall_status = 'completed';
        scanResult = 'HOME IN';

        await removeActiveQR(token);
      } else {
        return res.status(400).json({ success: false, message: 'QR code already fully used' });
      }

      await visit.save();

      return res.json({
        success: true,
        message: `Marked as ${scanResult}`,
        kind: 'home_visit',
        student: { name: student.name, rollNumber: student.rollNo, hostel: student.hostel },
        log: { status: scanResult, timestamp: now },
      });
    }

    return res.status(400).json({ success: false, message: 'Unsupported QR type' });
  } catch (error) {
    console.error('Unified scan error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

