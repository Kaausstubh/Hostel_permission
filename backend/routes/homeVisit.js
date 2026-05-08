/**
 * Home Visit Routes
 * POST /api/homevisit/request           - Student submits request
 * POST /api/homevisit/parent-approve    - Parent approves/rejects
 * POST /api/homevisit/warden-approve    - Warden approves/rejects
 * GET  /api/homevisit/list              - Warden views all requests
 * GET  /api/homevisit/my               - Student views their requests
 * POST /api/homevisit/scan              - Gate scan for home visit QR
 */

const express = require('express');
const router = express.Router();
const HomeVisitLog = require('../models/HomeVisitLog');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { generateQR, validateQR, registerActiveQR } = require('../services/qrService');
const { enqueueWhatsAppMessage } = require('../queues/whatsappQueue');
const { normalizeToE164 } = require('../utils/phone');
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
  leaveDate.setMonth(leaveDate.getMonth() + 4);
  return formatLocalDate(leaveDate);
};
const buildOverlappingVisitFilter = (studentId, leaveDate, returnDate) => ({
  student_id: studentId,
  overall_status: { $in: ACTIVE_HOME_VISIT_STATUSES },
  leave_date: { $lte: returnDate },
  return_date: { $gte: leaveDate },
});
const getPagination = (query, defaultLimit = 25, maxLimit = 100) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── Student: Submit Home Visit Request ───────────────────────────────────────
router.post('/request', protect, authorize('student'), async (req, res) => {
  try {
    const { reason, leave_date, return_date } = req.body;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!reason || !leave_date || !return_date) {
      return res.status(400).json({ success: false, message: 'Reason, leave date, and return date are required' });
    }

    if (!dateRegex.test(leave_date) || !dateRegex.test(return_date)) {
      return res.status(400).json({ success: false, message: 'Dates must be in YYYY-MM-DD format' });
    }

    if (return_date <= leave_date) {
      return res.status(400).json({ success: false, message: 'Return date must be after leave date' });
    }

    const today = formatLocalDate(new Date());
    if (leave_date < today || return_date < today) {
      return res.status(400).json({ success: false, message: 'Leave and return dates cannot be before today' });
    }

    const maxReturnDate = getMaxReturnDateFromLeave(leave_date);
    if (return_date > maxReturnDate) {
      return res.status(400).json({
        success: false,
        message: `Return date cannot be more than 4 months after leave date. Maximum allowed return date is ${maxReturnDate}.`,
      });
    }

    const overlappingVisit = await HomeVisitLog.findOne(
      buildOverlappingVisitFilter(req.user._id, leave_date, return_date)
    )
      .sort({ createdAt: -1 })
      .lean();

    if (overlappingVisit) {
      return res.status(409).json({
        success: false,
        message: `An active home visit already exists for ${overlappingVisit.leave_date} to ${overlappingVisit.return_date}.`,
      });
    }

    // Create the request record
    const visit = await HomeVisitLog.create({
      student_id: req.user._id,
      reason,
      leave_date,
      return_date,
      name: req.user.name,
      rollNo: req.user.rollNo || '',
      parent_phone: req.user.parentPhone ? normalizeToE164(req.user.parentPhone) : null,
    });

    // In the "warden calls parent" workflow, we do not require parent WhatsApp approval.
    // (Optional notifications can still be added later if you want.)

    res.status(201).json({
      success: true,
      message: 'Home visit request submitted. Warden will call your parent to confirm.',
      visit,
    });
  } catch (error) {
    console.error('Home visit request error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden: Confirm parent call ───────────────────────────────────────────────
router.post('/warden-confirm-call', protect, authorize('warden'), async (req, res) => {
  try {
    const { visit_id } = req.body;
    if (!visit_id) return res.status(400).json({ success: false, message: 'visit_id is required' });

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.overall_status !== 'pending' || visit.warden_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending requests can be confirmed' });
    }

    visit.parent_call_confirmed = true;
    visit.parent_call_confirmed_at = new Date();
    visit.parent_call_confirmed_by = req.user._id;
    await visit.save();

    res.json({ success: true, message: 'Parent call confirmed', visit });
  } catch (error) {
    console.error('Warden confirm call error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Parent: Approve or Reject ────────────────────────────────────────────────
// Called via WhatsApp webhook or direct API (for web fallback)
router.post('/parent-approve', async (req, res) => {
  try {
    const { visit_id, action } = req.body; // action: 'approve' | 'reject'

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.parent_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request already responded to by parent' });
    }

    visit.parent_status = action === 'approve' ? 'approved' : 'rejected';
    visit.parent_response_time = new Date();

    if (action === 'approve') {
      visit.overall_status = 'parent_approved';

      // Notify warden
      const student = visit.student_id;
      const wardenUser = await User.findOne({ role: 'warden' });
      if (wardenUser && wardenUser.phone) {
        await enqueueWhatsAppMessage({
          to: wardenUser.phone,
          body: `🏠 *Home Visit — Parent Approved*\n\nStudent: *${student.name}* (${student.rollNo || 'N/A'})\nHostel: ${student.hostel || 'N/A'}\nReason: ${visit.reason}\n📅 Leave: ${visit.leave_date}\n📅 Return: ${visit.return_date}\n\nParent has approved. Awaiting your decision.\n\nReply:\n✅ *WARDEN_APPROVE ${visit._id}*\n❌ *WARDEN_REJECT ${visit._id}*`,
        });
      }
    } else {
      visit.overall_status = 'rejected';
      // Notify student of rejection
      await enqueueWhatsAppMessage({
        to: visit.student_id.phone,
        body: `❌ Your home visit request has been *rejected by your parent*.\nReason: ${visit.reason}\nDates: ${visit.leave_date} → ${visit.return_date}`,
      });
    }

    await visit.save();

    res.json({ success: true, message: `Parent ${action}d the request`, visit });
  } catch (error) {
    console.error('Parent approve error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden: Approve or Reject ────────────────────────────────────────────────
router.post('/warden-approve', protect, authorize('warden'), async (req, res) => {
  try {
    const { visit_id, action } = req.body; // action: 'approve' | 'reject'

    const visit = await HomeVisitLog.findById(visit_id).populate('student_id');
    if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });

    if (visit.warden_status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Warden already responded' });
    }

    visit.warden_status = action === 'approve' ? 'approved' : 'rejected';
    visit.warden_response_time = new Date();

    const student = visit.student_id;

    if (action === 'approve') {
      if (!visit.parent_call_confirmed) {
        return res.status(400).json({ success: false, message: 'Confirm parent call before approving' });
      }
      visit.overall_status = 'approved';

      // Generate QR for exit/entry
      const payload = {
        type: 'home_visit',
        student_id: student._id.toString(),
        visit_id: visit._id.toString(),
      };
      const { token, qrDataUrl, qrPublicUrl } = await generateQR(payload);
      visit.qr_token = token;

      // Register in active store for unified gate scanner pending list
      await registerActiveQR(token, {
        qrType: 'home_visit',
        studentId: student._id.toString(),
        studentName: student.name,
        hostel: student.hostel || 'N/A',
        rollNumber: student.rollNo || 'N/A',
        scanType: 'HOME OUT', // first scan is leaving
        qrPublicUrl,
        qrDataUrl,
      });

      // Send QR to student via WhatsApp
      await enqueueWhatsAppMessage({
        to: student.phone,
        body: `✅ *Home Visit Approved!*\n\nWarden has confirmed permission via parent call.\n📅 Leave: ${visit.leave_date}\n📅 Return: ${visit.return_date}\n\nYour QR gate pass is ready.\n\nQR Token (for dashboard scan): ${token.substring(0, 30)}...\nQR Image (if accessible): ${qrPublicUrl || '(configured locally)'}`,
      });
    } else {
      visit.overall_status = 'rejected';
      await enqueueWhatsAppMessage({
        to: student.phone,
        body: `❌ Your home visit request has been *rejected by the warden*.\nDates: ${visit.leave_date} → ${visit.return_date}`,
      });
    }

    await visit.save();

    res.json({ success: true, message: `Warden ${action}d the request`, visit });
  } catch (error) {
    console.error('Warden approve error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Home Visit QR Scan (Gate) ────────────────────────────────────────────────
router.post('/scan', protect, authorize('security', 'warden'), async (req, res) => {
  try {
    const { token } = req.body;
    const { valid, payload, error } = validateQR(token);
    if (!valid) return res.status(400).json({ success: false, message: error });

    if (payload.type !== 'home_visit') {
      return res.status(400).json({ success: false, message: 'Not a home visit QR code' });
    }

    const visit = await HomeVisitLog.findById(payload.visit_id).populate('student_id');
    if (!visit || visit.overall_status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Visit not found or not approved' });
    }

    let scanResult;
    if (!visit.qr_used_out) {
      // First scan = HOME OUT
      visit.qr_used_out = true;
      visit.actual_out_time = new Date();
      scanResult = 'HOME OUT';
    } else if (!visit.qr_used_in) {
      // Second scan = HOME IN
      visit.qr_used_in = true;
      visit.actual_in_time = new Date();
      visit.overall_status = 'completed';
      scanResult = 'HOME IN';
    } else {
      return res.status(400).json({ success: false, message: 'QR code already fully used' });
    }

    await visit.save();

    res.json({
      success: true,
      message: `Marked as ${scanResult}`,
      student: { name: visit.student_id.name, rollNumber: visit.student_id.rollNo },
      scanResult,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Home visit scan error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden/Security: List All Requests ───────────────────────────────────────
router.get('/list', protect, authorize('warden', 'security'), async (req, res) => {
  try {
    const { status } = req.query;
    const { page, limit, skip } = getPagination(req.query, 25, 100);
    const filter = status ? { overall_status: status } : {};

    const [visits, count] = await Promise.all([
      HomeVisitLog.find(filter)
        .populate('student_id', 'name rollNo hostel parentPhone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      HomeVisitLog.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, visits });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Student: View Own Requests ───────────────────────────────────────────────
router.get('/my', protect, authorize('student'), async (req, res) => {
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
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
