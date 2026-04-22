/**
 * Complaints Routes
 * POST  /api/complaints/file           - Student files a complaint
 * GET   /api/complaints/status/:id     - Student views their complaints
 * GET   /api/complaints/all            - Warden views all complaints
 * PATCH /api/complaints/:id/resolve    - Warden resolves a complaint
 */

const express = require('express');
const router = express.Router();
const Complaint = require('../models/Complaint');
const { protect, authorize } = require('../middleware/auth');
const getPagination = (query, defaultLimit = 25, maxLimit = 100) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── File a Complaint ─────────────────────────────────────────────────────────
router.post('/file', protect, authorize('student'), async (req, res) => {
  try {
    const { hostel, complaint_text } = req.body;

    if (!hostel || !complaint_text) {
      return res.status(400).json({ success: false, message: 'Hostel and complaint text are required' });
    }

    if (!['BH1', 'BH2', 'GH'].includes(hostel)) {
      return res.status(400).json({ success: false, message: 'Hostel must be BH1, BH2, or GH' });
    }

    const complaint = await Complaint.create({
      student_id: req.user._id,
      hostel,
      complaint_text,
    });

    res.status(201).json({ success: true, message: 'Complaint filed successfully', complaint });
  } catch (error) {
    console.error('File complaint error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Student: View Own Complaint Status ───────────────────────────────────────
router.get('/status/:student_id', protect, async (req, res) => {
  try {
    // Students can only view their own; wardens can view anyone
    if (req.user.role === 'student' && req.user._id.toString() !== req.params.student_id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { page, limit, skip } = getPagination(req.query, 25, 100);
    const filter = { student_id: req.params.student_id };
    const [complaints, count] = await Promise.all([
      Complaint.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      Complaint.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, complaints });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden: View All Complaints ─────────────────────────────────────────────
router.get('/all', protect, authorize('warden'), async (req, res) => {
  try {
    const { hostel, status } = req.query;
    const { page, limit, skip } = getPagination(req.query, 25, 100);
    const filter = {};
    if (hostel) filter.hostel = hostel;
    if (status) filter.status = status;

    const [complaints, count] = await Promise.all([
      Complaint.find(filter)
        .populate('student_id', 'name rollNumber hostel phone')
        .populate('resolvedBy', 'name')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      Complaint.countDocuments(filter),
    ]);

    res.json({ success: true, count, page, limit, complaints });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Warden: Resolve a Complaint ──────────────────────────────────────────────
router.patch('/:id/resolve', protect, authorize('warden'), async (req, res) => {
  try {
    const { resolutionNote } = req.body;

    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: req.user._id,
        resolutionNote: resolutionNote || 'Resolved by warden',
      },
      { new: true }
    ).populate('student_id', 'name');

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    res.json({ success: true, message: 'Complaint resolved', complaint });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
