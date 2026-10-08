/**
 * Room Allocation Routes
 * REST API endpoints for managing hostel structure, rooms, and student allocations.
 */

const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../middleware/auth');
const allocationService = require('../services/allocationService');
const pdfImportService = require('../services/pdfImportService');
const logger = require('../utils/logger');

// ── Module Guard Middleware ──────────────────────────────────────────────────
const checkModuleEnabled = (req, res, next) => {
  if (process.env.ROOM_ALLOCATION_MODULE_ENABLED === 'false') {
    return res.status(403).json({
      success: false,
      message: 'Room Allocation module is currently disabled by administrator',
      code: 'MODULE_DISABLED',
    });
  }
  next();
};

router.use(checkModuleEnabled);

// ── Structure Endpoints ───────────────────────────────────────────────────────

/**
 * GET /api/allocations/hostels
 * Available to authenticated users (admin, warden, security, student)
 */
router.get('/hostels', protect, async (req, res) => {
  try {
    const hostels = await allocationService.getHostels();
    res.json({ success: true, data: hostels });
  } catch (err) {
    logger.error('[Allocation] Failed to fetch hostels', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/allocations/hostels/:id/floors
 */
router.get('/hostels/:id/floors', protect, async (req, res) => {
  try {
    const floors = await allocationService.getFloorsByHostel(req.params.id);
    res.json({ success: true, data: floors });
  } catch (err) {
    logger.error('[Allocation] Failed to fetch floors', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/allocations/floors/:id/rooms
 * Query params: status (optional)
 */
router.get('/floors/:id/rooms', protect, async (req, res) => {
  try {
    const rooms = await allocationService.getRoomsByFloor(req.params.id, req.query.status);
    res.json({ success: true, data: rooms });
  } catch (err) {
    logger.error('[Allocation] Failed to fetch rooms', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/allocations/rooms/:id
 */
router.get('/rooms/:id', protect, async (req, res) => {
  try {
    const details = await allocationService.getRoomDetails(req.params.id);
    res.json({ success: true, data: details });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message, code: err.code });
  }
});

/**
 * POST /api/allocations/rooms
 * Create a new room (admin/warden only)
 */
router.post('/rooms', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const { hostel_id, floor_id, room_number, capacity, room_type, status, remarks } = req.body;
    if (!hostel_id || !floor_id || !room_number) {
      return res.status(400).json({
        success: false,
        message: 'hostel_id, floor_id, and room_number are required',
      });
    }

    const room = await allocationService.createRoom({
      hostel_id,
      floor_id,
      room_number,
      capacity,
      room_type,
      status,
      remarks,
    });
    res.status(201).json({ success: true, data: room });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message, code: err.code });
  }
});

/**
 * PATCH /api/allocations/rooms/:id
 * Update room capacity or mark maintenance/blocked (admin/warden only)
 */
router.patch('/rooms/:id', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const updated = await allocationService.updateRoom(req.params.id, req.body, req.user);
    res.json({ success: true, data: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, message: err.message, code: err.code });
  }
});

// ── Allocation Mutation Endpoints ─────────────────────────────────────────────

/**
 * POST /api/allocations/allocate
 * Manual allocation of student to room (admin/warden only)
 */
router.post('/allocate', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const { student_id, room_id, bed_number, remarks } = req.body;
    if (!student_id || !room_id) {
      return res.status(400).json({
        success: false,
        message: 'student_id and room_id are required',
      });
    }

    const allocation = await allocationService.allocateStudent({
      student_id,
      room_id,
      bed_number,
      remarks,
      actor_id: req.user._id,
      actor_role: req.user.role,
      source: 'manual',
    });

    res.status(201).json({ success: true, data: allocation });
  } catch (err) {
    logger.warn('[Allocation] Allocation failed', { error: err.message, code: err.code });
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message,
      code: err.code || 'ALLOCATION_ERROR',
    });
  }
});

/**
 * POST /api/allocations/:id/transfer
 * Atomically transfer student to new room (admin/warden only)
 */
router.post('/:id/transfer', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const { new_room_id, bed_number, reason } = req.body;
    if (!new_room_id || !reason) {
      return res.status(400).json({
        success: false,
        message: 'new_room_id and reason are required',
        code: 'MISSING_FIELDS',
      });
    }

    const newAllocation = await allocationService.transferStudent({
      allocation_id: req.params.id,
      new_room_id,
      bed_number,
      reason,
      actor_id: req.user._id,
      actor_role: req.user.role,
    });

    res.json({ success: true, data: newAllocation });
  } catch (err) {
    logger.warn('[Allocation] Transfer failed', { error: err.message, code: err.code });
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message,
      code: err.code || 'TRANSFER_ERROR',
    });
  }
});

/**
 * POST /api/allocations/:id/vacate
 * Vacate student from room (admin/warden only)
 */
router.post('/:id/vacate', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const { reason, vacated_on } = req.body;
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required to vacate an allocation',
        code: 'REASON_REQUIRED',
      });
    }

    const vacated = await allocationService.vacateStudent({
      allocation_id: req.params.id,
      reason,
      vacated_on,
      actor_id: req.user._id,
      actor_role: req.user.role,
    });

    res.json({ success: true, data: vacated });
  } catch (err) {
    logger.warn('[Allocation] Vacate failed', { error: err.message, code: err.code });
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message,
      code: err.code || 'VACATE_ERROR',
    });
  }
});

// ── PDF Import Endpoints ───────────────────────────────────────────────────────

/**
 * POST /api/allocations/import/preview
 * Generate validation report for authoritative BH2 allocation PDF without committing
 */
router.post('/import/preview', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const report = await pdfImportService.generatePreviewReport();
    res.json({ success: true, data: report });
  } catch (err) {
    logger.error('[Allocation Import] Preview failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/allocations/import/confirm
 * Atomically execute the BH2 allocation import
 */
router.post('/import/confirm', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const result = await pdfImportService.confirmAndExecuteImport({
      actor_id: req.user._id,
      actor_role: req.user.role,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('[Allocation Import] Confirmation failed', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Search & Views ────────────────────────────────────────────────────────────

/**
 * GET /api/allocations/search
 * Search allocations by student name/roll number (admin, warden, security)
 */
router.get('/search', protect, authorize('admin', 'warden', 'security'), async (req, res) => {
  try {
    const { search, floorId, hostelId, status } = req.query;
    const results = await allocationService.searchAllocations({ search, floorId, hostelId, status });
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/allocations/export
 * Download active allocations as CSV (admin, warden)
 */
router.get('/export', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const csvData = await allocationService.exportAllocationsCsv(req.query.hostelId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="room_allocations.csv"');
    res.send(csvData);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/allocations/students/:id/allocation
 * Student can view their own; warden/admin can view any
 */
router.get('/students/:id/allocation', protect, async (req, res) => {
  try {
    const targetStudentId = req.params.id;

    // Students can only query their own allocation
    if (req.user.role === 'student' && req.user._id.toString() !== targetStudentId) {
      return res.status(403).json({
        success: false,
        message: 'Students can only view their own room allocation',
      });
    }

    const result = await allocationService.getStudentAllocation(targetStudentId);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/allocations/security/lookup
 * Read-only lookup (name, rollNo, room, hostel, floor)
 */
router.get('/security/lookup', protect, authorize('admin', 'warden'), async (req, res) => {
  try {
    const { search } = req.query;
    const results = await allocationService.searchAllocations({ search, status: 'active' });

    // Format clean read-only summary with non-sensitive fields
    const safeData = results.map((a) => ({
      allocation_id: a._id,
      student_name: a.student_id?.name || 'N/A',
      roll_number: a.student_id?.rollNo || 'N/A',
      hostel: a.room_id?.hostel_id?.code || 'N/A',
      floor: a.room_id?.floor_id?.label || 'N/A',
      room_number: a.room_id?.room_number || 'N/A',
      bed_number: a.bed_number || '-',
      allocated_on: a.allocated_on,
    }));

    res.json({ success: true, data: safeData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
