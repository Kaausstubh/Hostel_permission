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
const { getLogsCache, setLogsCache, invalidateLogsCache } = require('../services/logsCache');
const getPagination = (query, defaultLimit = 25, maxLimit = 100) => {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10), 1), maxLimit);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// ─── File a Complaint ─────────────────────────────────────────────────────────
router.post('/file', protect, authorize('student'), async (req, res) => {
  try {
    const { hostel, complaint_text, complaint_type, photo } = req.body;

    const trimmedText = typeof complaint_text === 'string' ? complaint_text.trim() : '';
    const trimmedPhoto = typeof photo === 'string' && photo.trim() ? photo.trim() : null;

    if (!trimmedText && !trimmedPhoto) {
      return res.status(400).json({ success: false, message: 'Complaint description or photo is required' });
    }

    if (!['BH1', 'BH2', 'GH', 'GH1', 'GH2'].includes(hostel)) {
      return res.status(400).json({ success: false, message: 'Hostel must be BH1, BH2, GH1, or GH2' });
    }

    const allowedTypes = ['electricity', 'wifi', 'washing_machine', 'carpenter', 'plumber', 'others'];
    const normalizedType = allowedTypes.includes((complaint_type || '').toLowerCase())
      ? complaint_type.toLowerCase()
      : 'others';

    const finalDescription = trimmedText
      ? `[${normalizedType}] ${trimmedText}`
      : `[${normalizedType}] Maintenance required. Photo evidence attached.`;

    const complaint = await Complaint.create({
      student_id: req.user._id,
      name: req.user.name,
      rollNo: req.user.rollNo || '',
      hostel,
      complaint_type: normalizedType,
      complaint_text: finalDescription,
      photo: trimmedPhoto,
      hasPhoto: Boolean(trimmedPhoto),
    });

    await invalidateLogsCache();

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
        .select('-photo')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Complaint.countDocuments(filter),
    ]);

    const sanitizedComplaints = complaints.map((c) => ({
      ...c,
      photoUrl: (c.hasPhoto || c.photo) ? `/api/complaints/${c._id}/photo` : null,
    }));

    res.json({ success: true, count, page, limit, complaints: sanitizedComplaints });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Fast On-Demand Cached Binary Evidence Photo Endpoint ─────────────────────
// Serves binary image directly with 24-hour browser caching headers.
// Keeps the complaints table payload light (~15KB instead of ~50MB).
router.get('/:id/photo', async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id).select('photo').lean();
    if (!complaint || !complaint.photo) {
      return res.status(404).send('No photo evidence');
    }

    const photo = complaint.photo;
    if (photo.startsWith('http')) {
      return res.redirect(photo);
    }

    if (photo.startsWith('data:image/')) {
      const parts = photo.split(',');
      if (parts.length >= 2) {
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const buffer = Buffer.from(parts[1], 'base64');
        res.set('Content-Type', mime);
        res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        return res.send(buffer);
      }
    }

    return res.status(404).send('Invalid photo format');
  } catch (error) {
    res.status(500).send('Error');
  }
});

// ─── Warden: View All Complaints (High-Performance Query) ─────────────────────
router.get('/all', protect, authorize('warden'), async (req, res) => {
  try {
    const { hostel, status } = req.query;
    const { page, limit, skip } = getPagination(req.query, 25, 100);
    const filter = {};
    if (hostel) {
      const hUpper = hostel.toUpperCase();
      filter.hostel = (hUpper === 'GH1' || hUpper === 'GH') ? { $in: ['GH1', 'GH'] } : hUpper;
    }
    if (status) filter.status = status;

    const cacheKey = `complaints:all:${hostel || 'all'}:${status || 'all'}:${page}:${limit}`;
    const cached = await getLogsCache(cacheKey);
    if (cached) {
      return res.json({ success: true, ...cached, cached: true });
    }

    const [complaints, count] = await Promise.all([
      Complaint.find(filter)
        .select('-photo')
        .populate('student_id', 'name rollNo hostel phone')
        .populate('resolvedBy', 'name')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Complaint.countDocuments(filter),
    ]);

    const sanitizedComplaints = complaints.map((c) => {
      const studentId = c.student_id?._id;
      return {
        ...c,
        hasPhoto: Boolean(c.hasPhoto),
        photoUrl: c.hasPhoto ? `/api/complaints/${c._id}/photo` : null,
        student_id: c.student_id ? {
          ...c.student_id,
          studentPhoto: studentId ? `/api/auth/student-photo/${studentId}` : null,
        } : null,
      };
    });

    const payload = { count, page, limit, complaints: sanitizedComplaints };
    await setLogsCache(cacheKey, payload, 30);

    res.json({ success: true, ...payload, cached: false });
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
        resolutionNote: resolutionNote || 'Resolved by hostel staff',
      },
      { new: true }
    ).populate('student_id', 'name');

    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    await invalidateLogsCache();

    res.json({ success: true, message: 'Complaint resolved', complaint });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
