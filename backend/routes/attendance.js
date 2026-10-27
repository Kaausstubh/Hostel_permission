/**
 * Attendance Routes
 * Manages device registration, geofences, rounds, room lists, student requests, and overrides.
 */

const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../middleware/auth');
const HostelGeofence = require('../models/HostelGeofence');
const StudentDevice = require('../models/StudentDevice');
const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceAttempt = require('../models/AttendanceAttempt');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');
const User = require('../models/User');
const RoomAllocation = require('../models/RoomAllocation');
const HomeVisitLog = require('../models/HomeVisitLog');
const InOutLog = require('../models/InOutLog');
const { finalizeExpiredAttempt } = require('../services/nightAttendanceService');

const {
  registerStudentDevice,
  approveStudentDevice,
} = require('../services/deviceService');
const {
  verifyHostelGeofence,
  normalizeHostelCode,
  getHostelGeofenceConfig,
} = require('../services/geofenceService');
const {
  parseFloorFromRoom,
  getHostelsAndFloors,
  startOrResumeRound,
  getRoundRoomsSummary,
  getRoomDetails,
  requestRoomAttendance,
  resendRoomRequest,
  requestAllRoomsInRound,
  requestEntireHostelAttendance,
  skipRoom,
  reopenRoom,
  completeRound,
} = require('../services/attendanceRoundService');

const logger = require('../utils/logger');

// ── Module Guard Middleware ──────────────────────────────────────────────────
const checkModuleEnabled = (req, res, next) => {
  if (process.env.ATTENDANCE_MODULE_ENABLED === 'false') {
    return res.status(403).json({
      success: false,
      message: 'Attendance module is currently disabled by administrator',
      code: 'MODULE_DISABLED',
    });
  }
  next();
};

router.use(checkModuleEnabled);

// ── Status Endpoint ──────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    success: true,
    enabled: process.env.ATTENDANCE_MODULE_ENABLED !== 'false',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Staff: Screen 1 — Hostels, Floors, Start/Resume Round ────────────────────
router.get('/hostels', protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const hostels = await getHostelsAndFloors(req.user);
    res.json({ success: true, hostels });
  } catch (err) {
    logger.error('[Attendance] Error fetching hostels', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch hostels' });
  }
});

router.get(['/hostels/:hostel/floors', '/hostel/:hostel/floors', '/hostels/:hostel/floor', '/hostel/:hostel/floor'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const allHostels = await getHostelsAndFloors(req.user);
    const target = allHostels.find((h) => h.hostel.toUpperCase() === req.params.hostel.toUpperCase());
    if (!target) {
      return res.status(404).json({ success: false, message: `Hostel ${req.params.hostel} not found` });
    }
    res.json({
      success: true,
      hostel: req.params.hostel.toUpperCase(),
      floors: target?.floors || ['All Floors', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching floors', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch floors' });
  }
});

router.post(['/rounds', '/round', '/rounds/start', '/round/start'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const hostel = req.body.hostel;
    const floor = req.body.floor || 'All Floors';
    const session_name = req.body.session_name;
    if (!hostel) {
      return res.status(400).json({ success: false, message: 'Hostel is required' });
    }

    const { round, resumed } = await startOrResumeRound({
      hostel,
      floor,
      session_name: session_name || 'Night Attendance',
      staffUser: req.user,
    });

    res.status(200).json({
      success: true,
      message: resumed ? 'Resumed existing active round' : 'Started new round',
      resumed,
      round,
    });
  } catch (err) {
    logger.error('[Attendance] Error starting/resuming round', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Staff: Screen 2 — Room List for Floor & Actions ──────────────────────────
router.get(['/rounds/:id', '/round/:id'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') {
      return res.status(400).json({ success: false, message: 'Valid round ID is required' });
    }
    const round = await AttendanceRound.findById(req.params.id)
      .populate('staff_id', 'name email role')
      .lean();
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });
    res.json({ success: true, round });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get(['/rounds/:id/rooms', '/round/:id/rooms'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') {
      return res.status(400).json({ success: false, message: 'Valid round ID is required' });
    }
    const data = await getRoundRoomsSummary(req.params.id);
    res.json({ success: true, ...data });
  } catch (err) {
    logger.error('[Attendance] Error fetching round rooms', { error: err.message });
    const isNotFound = err.message && err.message.toLowerCase().includes('not found');
    res.status(isNotFound ? 404 : 400).json({ success: false, message: err.message });
  }
});

const resolveRoomParam = async (param) => {
  if (!param) return param;
  if (/^[0-9a-fA-F]{24}$/.test(param)) {
    const HostelRoom = require('../models/HostelRoom');
    const r = await HostelRoom.findById(param).lean();
    if (r?.room_number) return r.room_number;
  }
  return param;
};

// ── Live Round Status ────────────────────────────────────────────────────────
router.get(['/rounds/:id/live', '/round/:id/live'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    if (!req.params.id || req.params.id === 'undefined') {
      return res.status(400).json({ success: false, message: 'Valid round ID is required' });
    }
    const round = await AttendanceRound.findById(req.params.id)
      .populate('staff_id', 'name email role')
      .lean();
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });

    const summary = await getRoundRoomsSummary(req.params.id);
    const activeRequests = await RoomAttendanceRequest.find({
      round_id: round._id,
      status: 'open',
    }).lean();

    res.json({
      success: true,
      round,
      summary,
      activeRequests,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching live round info', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post(['/rounds/:id/rooms/:roomNo/request', '/round/:id/rooms/:roomNo/request', '/rounds/:id/rooms/:roomId/request', '/round/:id/rooms/:roomId/request'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const targetRoom = await resolveRoomParam(req.params.roomNo || req.params.roomId);
    const result = await requestRoomAttendance({
      roundId: req.params.id,
      roomNo: targetRoom,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Attendance requested for room', ...result });
  } catch (err) {
    logger.error('[Attendance] Error requesting room attendance', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(['/requests/:id/resend', '/request/:id/resend', '/rounds/:roundId/rooms/:roomNo/resend', '/round/:roundId/rooms/:roomNo/resend'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    let requestId = req.params.id;
    if (!requestId && req.params.roundId && req.params.roomNo) {
      const existingReq = await RoomAttendanceRequest.findOne({
        round_id: req.params.roundId,
        roomNo: req.params.roomNo,
      }).sort({ createdAt: -1 });
      if (!existingReq) {
        return res.status(404).json({ success: false, message: 'No active attendance request found for this room' });
      }
      requestId = existingReq._id;
    }

    const result = await resendRoomRequest({
      requestId,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Attendance request resent', ...result });
  } catch (err) {
    logger.error('[Attendance] Error resending request', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── 1-Click Request All Routes ───────────────────────────────────────────────
router.post(['/rounds/:id/request-all', '/round/:id/request-all'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const result = await requestAllRoomsInRound({
      roundId: req.params.id,
      staffUser: req.user,
    });
    res.json({
      success: true,
      message: `Requested attendance for ${result.requestedRoomsCount} rooms (${result.totalStudentsNotified} students)`,
      ...result,
    });
  } catch (err) {
    logger.error('[Attendance] Error requesting all rooms in round', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(['/rounds/quick-request-all', '/round/quick-request-all'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const hostel = req.body.hostel;
    const floor = req.body.floor || 'All Floors';
    const session_name = req.body.session_name;
    if (!hostel) {
      return res.status(400).json({ success: false, message: 'Hostel is required' });
    }

    const { round, resumed } = await startOrResumeRound({
      hostel,
      floor,
      sessionName: session_name || 'Night Attendance',
      staffUser: req.user,
    });

    const result = await requestAllRoomsInRound({
      roundId: round._id,
      staffUser: req.user,
    });

    res.json({
      success: true,
      round,
      resumed,
      message: `Round started & attendance requested for all ${result.requestedRoomsCount} rooms on ${floor.toLowerCase().includes('all') ? 'All Floors' : `Floor ${floor}`} (${result.totalStudentsNotified} students)`,
      ...result,
    });
  } catch (err) {
    logger.error('[Attendance] Error in quick-request-all round', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(['/hostels/:hostel/request-all', '/hostel/:hostel/request-all'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const { session_name } = req.body;
    const result = await requestEntireHostelAttendance({
      hostel: req.params.hostel,
      sessionName: session_name || 'Night Attendance',
      staffUser: req.user,
    });
    res.json({
      success: true,
      message: `1-Click request broadcasted across entire hostel ${result.hostel}: ${result.totalRoomsRequested} rooms, ${result.totalStudentsNotified} students notified`,
      ...result,
    });
  } catch (err) {
    logger.error('[Attendance] Error in entire hostel request-all', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(['/rounds/:id/rooms/:roomNo/skip', '/round/:id/rooms/:roomNo/skip', '/rounds/:id/rooms/:roomId/skip', '/round/:id/rooms/:roomId/skip'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A mandatory skip reason is required',
        code: 'REASON_REQUIRED',
      });
    }

    const targetRoom = await resolveRoomParam(req.params.roomNo || req.params.roomId);
    const request = await skipRoom({
      roundId: req.params.id,
      roomNo: targetRoom,
      reason,
      staffUser: req.user,
    });

    res.json({ success: true, message: 'Room marked as skipped', request });
  } catch (err) {
    logger.error('[Attendance] Error skipping room', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post(['/rounds/:id/rooms/:roomNo/reopen', '/round/:id/rooms/:roomNo/reopen', '/rounds/:id/rooms/:roomId/reopen', '/round/:id/rooms/:roomId/reopen'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const targetRoom = await resolveRoomParam(req.params.roomNo || req.params.roomId);
    const request = await reopenRoom({
      roundId: req.params.id,
      roomNo: targetRoom,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Room reopened', request });
  } catch (err) {
    logger.error('[Attendance] Error reopening room', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Staff: Screen 3 — Room Details & Manual Overrides ────────────────────────
router.get(['/rounds/:id/rooms/:roomNo', '/round/:id/rooms/:roomNo', '/rounds/:id/rooms/:roomId', '/round/:id/rooms/:roomId'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const targetRoom = await resolveRoomParam(req.params.roomNo || req.params.roomId);
    const details = await getRoomDetails(req.params.id, targetRoom);
    res.json({ success: true, ...details });
  } catch (err) {
    logger.error('[Attendance] Error fetching room details', { error: err.message });
    const isNotFound = err.message && err.message.toLowerCase().includes('not found');
    res.status(isNotFound ? 404 : 400).json({ success: false, message: err.message });
  }
});

router.post(['/requests/:id/override', '/request/:id/override'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const studentId = req.body.studentId || req.body.student_id;
    const { status, remark } = req.body;

    if (!studentId || !status) {
      return res.status(400).json({ success: false, message: 'studentId and status are required' });
    }

    if (!remark || !remark.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A remark is MANDATORY for every manual attendance mark',
        code: 'REMARK_REQUIRED',
      });
    }

    const request = await RoomAttendanceRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Attendance request not found' });

    let resp = await RequestResponse.findOne({
      request_id: request._id,
      student_id: studentId,
    });

    const oldStatus = resp?.status || 'none';

    if (!resp) {
      resp = await RequestResponse.create({
        request_id: request._id,
        student_id: studentId,
        status,
        remark: remark.trim(),
        approved_at: new Date(),
      });
    } else {
      resp.status = status;
      resp.remark = remark.trim();
      resp.approved_at = new Date();
      await resp.save();
    }

    await AttendanceAuditLog.create({
      actor_id: req.user._id,
      actor_role: req.user.role,
      actor_name: req.user.name,
      action: 'MANUAL_OVERRIDE',
      entity: 'RequestResponse',
      entity_id: resp._id.toString(),
      old_value: { status: oldStatus },
      new_value: { status, remark: remark.trim(), roomNo: request.roomNo },
      reason: remark.trim(),
    });

    const { getIO } = require('../services/socketService');
    const io = getIO();
    if (io) {
      const updatePayload = {
        roundId: request.round_id,
        roomNo: request.roomNo,
        studentId,
        status,
        remark: remark.trim(),
        manual: true,
        timestamp: new Date().toISOString(),
      };
      io.of('/dashboard').emit('room_attendance_updated', updatePayload);
      io.emit('room_attendance_updated', updatePayload);
    }

    res.json({ success: true, message: 'Manual mark recorded', response: resp });
  } catch (err) {
    logger.error('[Attendance] Error overriding attendance', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Complete & Lock Round ────────────────────────────────────────────────────
router.post(['/rounds/:id/complete', '/round/:id/complete'], protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const result = await completeRound({
      roundId: req.params.id,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Round completed and locked successfully', ...result });
  } catch (err) {
    logger.error('[Attendance] Error completing round', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// Admin-only Reopen of a locked round
router.post('/rounds/:id/admin-reopen', protect, authorize('admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Reason is required to reopen locked round' });
    }

    const round = await AttendanceRound.findById(req.params.id);
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });

    round.status = 'active';
    round.completed_at = null;
    await round.save();

    await AttendanceAuditLog.create({
      actor_id: req.user._id,
      actor_role: req.user.role,
      actor_name: req.user.name,
      action: 'ROUND_REOPENED',
      entity: 'AttendanceRound',
      entity_id: round._id.toString(),
      old_value: { status: 'completed' },
      new_value: { status: 'active' },
      reason: reason.trim(),
    });

    res.json({ success: true, message: 'Round reopened by administrator', round });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Student: Device Registration & Status ────────────────────────────────────
router.get('/devices/status', protect, authorize('student'), async (req, res) => {
  try {
    const device = await StudentDevice.findOne({
      student_id: req.user._id,
      active: true,
    }).lean();

    res.json({
      success: true,
      registered: Boolean(device),
      approved: Boolean(device?.approved_by),
      device: device
        ? {
            id: device._id,
            device_id: device.device_id,
            device_model: device.device_model,
            registered_at: device.registered_at,
            approved_at: device.approved_at,
          }
        : null,
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching device status', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch device status' });
  }
});

router.post('/devices/register', protect, authorize('student'), async (req, res) => {
  try {
    const { deviceId, credentialId, publicKey, algorithm, deviceModel, consentGiven } = req.body;

    if (!consentGiven) {
      return res.status(400).json({
        success: false,
        message: 'Consent must be granted to register biometric platform authenticator',
        code: 'CONSENT_REQUIRED',
      });
    }

    const device = await registerStudentDevice({
      studentId: req.user._id,
      deviceId,
      credentialId,
      publicKey,
      algorithm,
      deviceModel,
      consentGiven,
      actorUser: req.user,
    });

    res.status(201).json({
      success: true,
      message: 'Device enrolled successfully',
      device: {
        id: device._id,
        device_id: device.device_id,
        approved: Boolean(device.approved_by),
      },
    });
  } catch (err) {
    logger.error('[Attendance] Device registration failed', { error: err.message, studentId: req.user._id });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Staff/Admin: Pending Devices & Approval ──────────────────────────────────
router.get('/devices/pending', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const pendingDevices = await StudentDevice.find({
      active: true,
      approved_by: null,
    })
      .populate('student_id', 'name rollNo hostel roomNo email phone studentPhoto picture')
      .sort({ registered_at: -1 })
      .lean();

    res.json({ success: true, count: pendingDevices.length, devices: pendingDevices });
  } catch (err) {
    logger.error('[Attendance] Error fetching pending devices', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch pending devices' });
  }
});

router.post('/devices/:id/approve', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const device = await approveStudentDevice(req.params.id, req.user);
    res.json({ success: true, message: 'Device registration approved', device });
  } catch (err) {
    logger.error('[Attendance] Error approving device', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Geofence Endpoints ───────────────────────────────────────────────────────
router.get('/geofences', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const geofences = await HostelGeofence.find().sort({ hostel: 1 }).lean();
    res.json({ success: true, geofences });
  } catch (err) {
    logger.error('[Attendance] Error fetching geofences', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch geofences' });
  }
});

router.put('/geofences/:hostel', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { hostel } = req.params;
    const {
      center,
      radius_m,
      buffer_m,
      accuracy_threshold_m,
      auto_attendance,
      active,
      name,
      polygon,
    } = req.body;

    const normHostel = normalizeHostelCode(hostel);
    const updateData = {
      hostel: normHostel,
      updated_by: req.user._id,
    };

    if (name) updateData.name = name;
    if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
      updateData.center = { lat: Number(center.lat), lng: Number(center.lng) };
    }
    if (typeof radius_m === 'number') updateData.radius_m = Number(radius_m);
    if (typeof buffer_m === 'number') updateData.buffer_m = Number(buffer_m);
    if (typeof accuracy_threshold_m === 'number') {
      updateData.accuracy_threshold_m = Number(accuracy_threshold_m);
    }
    if (typeof auto_attendance === 'boolean') updateData.auto_attendance = auto_attendance;
    if (typeof active === 'boolean') updateData.active = active;
    if (Array.isArray(polygon) && polygon.length >= 3) updateData.polygon = polygon;

    const updated = await HostelGeofence.findOneAndUpdate(
      { hostel: normHostel },
      { $set: updateData },
      { new: true, upsert: true }
    );

    await AttendanceAuditLog.create({
      actor_id: req.user._id,
      actor_role: req.user.role,
      actor_name: req.user.name,
      action: 'GEOFENCE_UPDATED',
      entity: 'HostelGeofence',
      entity_id: updated._id.toString(),
      old_value: null,
      new_value: {
        hostel: updated.hostel,
        center: updated.center,
        radius_m: updated.radius_m,
        accuracy_threshold_m: updated.accuracy_threshold_m,
        auto_attendance: updated.auto_attendance,
      },
      reason: req.body.reason || 'Geofence boundary calibrated by administrator',
    });

    res.json({ success: true, message: 'Geofence updated', geofence: updated });
  } catch (err) {
    logger.error('[Attendance] Error saving geofence', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/geofences/verify', protect, async (req, res) => {
  try {
    const { hostel, lat, lng, accuracy } = req.body;
    const result = await verifyHostelGeofence(hostel || req.user.hostel || 'BH1', {
      lat: Number(lat),
      lng: Number(lng),
      accuracy: Number(accuracy) || 10,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Helper: Extract valid timestamp from record (verification_timestamp, createdAt, updatedAt, or ObjectId)
function getRecordTimestamp(r) {
  if (!r) return null;
  if (r.verification_timestamp && !isNaN(new Date(r.verification_timestamp).getTime())) {
    return r.verification_timestamp;
  }
  if (r.createdAt && !isNaN(new Date(r.createdAt).getTime())) {
    return r.createdAt;
  }
  if (r.updatedAt && !isNaN(new Date(r.updatedAt).getTime())) {
    return r.updatedAt;
  }
  if (r._id) {
    try {
      const hex = String(r._id).substring(0, 8);
      const sec = parseInt(hex, 16);
      if (!isNaN(sec) && sec > 0) {
        return new Date(sec * 1000);
      }
    } catch {}
  }
  return null;
}

// Helper: Format record timestamp to Indian Standard Time (IST) 12-hour clock with seconds
function formatRecordTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

// Helper: Format record date to e.g. "13 October 2026"
function formatRecordDate(ts, fallbackDate) {
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
  }
  if (fallbackDate) {
    const parts = String(fallbackDate).split('-');
    if (parts.length === 3) {
      const d = new Date(`${fallbackDate}T00:00:00Z`);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-IN', {
          timeZone: 'UTC',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }
    }
  }
  return fallbackDate || null;
}

// ── Student: Today's Attendance Session Status & Record ───────────────────────
router.get('/today', protect, authorize('student'), async (req, res) => {
  try {
    const now = new Date();
    // Today's date in IST (UTC + 5.5h)
    const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const assignedHostel = normalizeHostelCode(req.user.hostel);
    const session = 'Night Attendance';

    if (!req.user.hostel) {
      return res.json({
        success: true,
        hostel: 'Unassigned',
        hostelName: 'Unassigned',
        date: todayDate,
        formattedDate: formatRecordDate(now, todayDate),
        status: 'PENDING',
        displayStatus: 'Pending Verification',
        time: null,
        method: null,
        verification: 'Unassigned',
        confirmedByServer: true,
        attemptsCount: 0,
        attemptsRemaining: 0,
        message: 'No hostel assigned to your student profile. Please contact administration.',
      });
    }

    const geofenceConfig = await getHostelGeofenceConfig(assignedHostel);

    // 0. Check approved leave for today
    const activeLeave = await HomeVisitLog.findOne({
      student_id: req.user._id,
      overall_status: 'approved',
      leave_date: { $lte: todayDate },
      return_date: { $gte: todayDate },
      qr_used_in: { $ne: true },
    }).lean();

    if (activeLeave) {
      const leaveRec = await AttendanceRecord.findOneAndUpdate(
        { student_id: req.user._id, date: todayDate, session },
        {
          $setOnInsert: {
            student_id: req.user._id,
            date: todayDate,
            session,
            session_name: session,
            hostel: assignedHostel,
            floor: req.user.floor || '',
            roomNo: req.user.roomNo || 'Assigned',
            status: 'on_leave',
            method: 'staff_marked',
            remark: 'On approved home visit leave',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return res.json({
        success: true,
        hasActiveSession: false,
        isMarked: true,
        recordId: leaveRec._id,
        hostel: leaveRec.hostel || assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: formatRecordDate(now, todayDate),
        time: formatRecordTime(leaveRec.createdAt || now),
        status: 'ON_LEAVE',
        displayStatus: 'On Approved Leave',
        method: 'Approved Leave',
        verification: 'Exempt (Approved Home Visit)',
        remark: 'On approved home visit leave',
        confirmedByServer: true,
        attemptsCount: 0,
        attemptsRemaining: 0,
        markedAt: leaveRec.createdAt || now,
      });
    }

    // 1. Check AttendanceRecord (the finalized ledger)
    const record = await AttendanceRecord.findOne({
      student_id: req.user._id,
      date: todayDate,
      session,
    }).populate('verified_by', 'name role').lean();

    if (record) {
      const isPresent = record.status === 'present';
      const isAbsent = record.status === 'absent';

      let hasActiveRoundRequest = false;
      if (isAbsent) {
        const studentResp = await RequestResponse.findOne({
          student_id: req.user._id,
          status: { $in: ['pending', 'flagged'] },
        }).populate('request_id');

        if (
          studentResp &&
          studentResp.request_id &&
          studentResp.request_id.status === 'open' &&
          new Date(studentResp.request_id.expires_at) > now
        ) {
          hasActiveRoundRequest = true;
        } else if (record.remark === 'Awaiting student geofence verification') {
          const roomReq = await RoomAttendanceRequest.findOne({
            hostel: assignedHostel,
            roomNo: (req.user.roomNo || '').trim().toUpperCase(),
            status: 'open',
            expires_at: { $gt: now },
          });
          if (roomReq) {
            hasActiveRoundRequest = true;
          }
        }
      }

      if (!hasActiveRoundRequest) {
        const displayStatus = isPresent ? 'PRESENT' : isAbsent ? 'ABSENT' : record.status.toUpperCase();
        const displayMethod = record.method === 'self_approved' ? 'Automatic' : 'Manual';
        const exactTime = formatRecordTime(record.verification_timestamp || record.createdAt || record.updatedAt);
        const exactDate = formatRecordDate(record.verification_timestamp || record.createdAt || record.updatedAt, record.date);

        return res.json({
          success: true,
          hasActiveSession: false,
          isMarked: true,
          recordId: record._id,
          hostel: record.hostel || assignedHostel,
          hostelName: geofenceConfig.name,
          date: record.date,
          formattedDate: exactDate,
          time: exactTime,
          status: displayStatus,
          displayStatus,
          method: displayMethod,
          verification: isPresent ? 'Successful' : (record.remark || 'Outside Geofence / Unconfirmed'),
          remark: record.remark,
          confirmedByServer: true,
          attemptsCount: record.attempt_count || 1,
          maxAttempts: 3,
          attemptsRemaining: 0,
          remainingSeconds: 0,
          locationStatus: isPresent ? 'INSIDE HOSTEL' : (record.status === 'on_leave' ? 'NOT CHECKED' : 'OUTSIDE HOSTEL'),
          componentVisible: false,
          isFinalized: true,
          markedAt: record.verification_timestamp || record.createdAt || record.updatedAt,
        });
      }
    }

    // A student opening the dashboard must never create or reset a night
    // attendance window.  Only a staff-created round initializes these docs.
    let attemptDoc = await AttendanceAttempt.findOne({
      student_id: req.user._id,
      date: todayDate,
      session,
    });

    if (!attemptDoc?.round_id) {
      return res.json({
        success: true,
        hasActiveSession: false,
        isMarked: false,
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: formatRecordDate(now, todayDate),
        status: 'NO_ACTIVE_SESSION',
        displayStatus: 'No Active Attendance',
        attemptsCount: 0,
        maxAttempts: 3,
        attemptsRemaining: 3,
        remainingSeconds: 0,
        locationStatus: 'NOT CHECKED',
        componentVisible: false,
        isFinalized: false,
        message: 'Night attendance has not been started by hostel staff.',
      });
    }

    const expiresAt = new Date(attemptDoc?.expires_at || (now.getTime() + 2 * 60 * 60 * 1000));
    const isExpired = now.getTime() > expiresAt.getTime();

    if (isExpired) {
      const finalized = await finalizeExpiredAttempt(attemptDoc._id, now);
      const finalizedRecord = finalized?.record || await AttendanceRecord.findOne({
        student_id: req.user._id,
        date: todayDate,
        session,
      }).lean();
      if (finalizedRecord) {
        return res.json({
          success: true,
          hasActiveSession: false,
          isMarked: true,
          status: finalizedRecord.status === 'present' ? 'PRESENT' : 'ABSENT',
          displayStatus: finalizedRecord.status === 'present' ? 'PRESENT' : 'ABSENT',
          hostel: finalizedRecord.hostel || assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(finalizedRecord.verification_timestamp || now, todayDate),
          time: formatRecordTime(finalizedRecord.verification_timestamp || now),
          attemptsCount: attemptDoc.attemptsCount,
          maxAttempts: 3,
          attemptsRemaining: 0,
          remainingSeconds: 0,
          expiresAt: expiresAt.toISOString(),
          locationStatus: finalizedRecord.status === 'present' ? 'INSIDE HOSTEL' : 'LOCATION UNAVAILABLE',
          componentVisible: false,
          isFinalized: true,
          message: finalizedRecord.remark,
        });
      }
    }

    // A previous request may still be evaluating the same GPS fix. It owns a
    // short lease, so a second click cannot consume another attempt. A stale
    // lease is safely recovered after a server interruption.
    if (attemptDoc?.status === 'verifying') {
      const lockAgeMs = now.getTime() - new Date(attemptDoc.verification_started_at || attemptDoc.updatedAt || now).getTime();
      if (lockAgeMs < 30 * 1000) {
        return res.status(200).json({
          success: true,
          hasActiveSession: true,
          isMarked: false,
          status: 'PENDING',
          code: 'VERIFICATION_IN_PROGRESS',
          attemptsCount: attemptDoc.attemptsCount,
          maxAttempts: 3,
          attemptsRemaining: Math.max(0, 3 - attemptDoc.attemptsCount),
          expiresAt: attemptDoc.expires_at?.toISOString(),
          verificationSessionId: attemptDoc._id.toString(),
          remainingSeconds: Math.max(0, Math.floor((new Date(attemptDoc.expires_at).getTime() - now.getTime()) / 1000)),
          locationStatus: 'VERIFYING',
          message: 'Location verification is already in progress.',
        });
      }
      attemptDoc = await AttendanceAttempt.findOneAndUpdate(
        { _id: attemptDoc._id, status: 'verifying' },
        { $set: { status: 'pending', verification_started_at: null } },
        { new: true }
      );
    }

    const activeRound = await AttendanceRound.findOne({
      _id: attemptDoc.round_id,
      status: 'active',
      window_end: { $gt: now },
    }).lean();

    if (!activeRound) {
      return res.json({
        success: true,
        hasActiveSession: false,
        isMarked: false,
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: formatRecordDate(now, todayDate),
        status: 'NO_ACTIVE_SESSION',
        displayStatus: 'No Active Attendance',
        attemptsCount: attemptDoc.attemptsCount,
        maxAttempts: 3,
        attemptsRemaining: Math.max(0, 3 - attemptDoc.attemptsCount),
        remainingSeconds: 0,
        locationStatus: attemptDoc.locationStatus || 'NOT CHECKED',
        componentVisible: false,
        isFinalized: false,
        message: 'This attendance round is no longer active.',
      });
    }

    // If 2-hour window expired or max 3 attempts exhausted while still pending -> Finalize as ABSENT
    if (attemptDoc && attemptDoc.status === 'pending' && (isExpired || attemptDoc.attemptsCount >= 3)) {
      const reason = isExpired
        ? 'Attendance verification window expired (2 hours exceeded)'
        : 'All 3 location verification checks exhausted';

      const absentRec = await AttendanceRecord.findOneAndUpdate(
        { student_id: req.user._id, date: todayDate, session },
        {
          $set: {
            student_id: req.user._id,
            date: todayDate,
            session,
            session_name: session,
            hostel: assignedHostel,
            floor: req.user.floor || '',
            roomNo: req.user.roomNo || 'Assigned',
            status: 'absent',
            method: 'self_approved',
            verified_by: req.user._id,
            attempt_count: attemptDoc.attemptsCount || 3,
            verification_timestamp: now,
            remark: `Marked ABSENT: ${reason}`,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      attemptDoc.status = 'absent';
      attemptDoc.finalizedAt = now;
      await attemptDoc.save().catch(() => {});

      return res.json({
        success: true,
        hasActiveSession: false,
        isMarked: true,
        recordId: absentRec._id,
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: formatRecordDate(now, todayDate),
        time: formatRecordTime(now),
        status: 'ABSENT',
        displayStatus: 'ABSENT',
        method: 'Automatic',
        verification: 'Verification Expired / Exhausted',
        remark: absentRec.remark,
        confirmedByServer: true,
        attemptsCount: attemptDoc.attemptsCount || 3,
        maxAttempts: 3,
        attemptsRemaining: 0,
        remainingSeconds: 0,
        expiresAt: expiresAt.toISOString(),
        locationStatus: attemptDoc.locationStatus || 'LOCATION UNAVAILABLE',
        componentVisible: false,
        isFinalized: true,
        message: `Attendance finalized as ABSENT (${reason}).`,
      });
    }

    if (attemptDoc && attemptDoc.status !== 'pending') {
      const isPresent = attemptDoc.status === 'present';
      return res.json({
        success: true,
        isMarked: true,
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: formatRecordDate(attemptDoc.finalizedAt || now, todayDate),
        time: formatRecordTime(attemptDoc.finalizedAt || now),
        status: isPresent ? 'PRESENT' : 'ABSENT',
        displayStatus: isPresent ? 'PRESENT' : 'ABSENT',
        method: 'Automatic',
        verification: isPresent ? 'Successful' : 'Outside Geofence / Unconfirmed',
        confirmedByServer: true,
        attemptsCount: attemptDoc.attemptsCount,
        maxAttempts: 3,
        attemptsRemaining: 0,
        remainingSeconds: 0,
        expiresAt: expiresAt.toISOString(),
        locationStatus: attemptDoc.locationStatus || (isPresent ? 'INSIDE HOSTEL' : 'OUTSIDE HOSTEL'),
        componentVisible: false,
        isFinalized: true,
        message: `Attendance is finalized as ${isPresent ? 'PRESENT' : 'ABSENT'}.`,
      });
    }

    const attemptsCount = attemptDoc ? attemptDoc.attemptsCount : 0;
    const attemptsRemaining = Math.max(0, 3 - attemptsCount);
    const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

    return res.json({
      success: true,
      hasActiveSession: true,
      isMarked: false,
      hostel: assignedHostel,
      hostelName: geofenceConfig.name,
      date: todayDate,
      formattedDate: formatRecordDate(now, todayDate),
      status: 'PENDING',
      displayStatus: 'Pending Verification',
      time: null,
      method: null,
      verification: attemptsCount > 0
        ? `Attempt ${attemptsCount} failed. Location checks remaining: ${attemptsRemaining}/3.`
        : 'Pending Verification',
      autoAttendanceEnabled: geofenceConfig.auto_attendance !== false,
      permittedRadiusMeters: geofenceConfig.radius_m,
      accuracyThresholdMeters: geofenceConfig.accuracy_threshold_m,
      confirmedByServer: true,
      attemptsCount,
      maxAttempts: 3,
      attemptsRemaining,
      remainingSeconds,
      sessionStart: attemptDoc?.session_start ? new Date(attemptDoc.session_start).toISOString() : now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      verificationSessionId: attemptDoc?._id?.toString(),
      locationStatus: attemptDoc?.locationStatus || 'NOT CHECKED',
      componentVisible: true,
      isFinalized: false,
      message: attemptsCount > 0
        ? `Attempt ${attemptsCount} failed. Location checks remaining: ${attemptsRemaining}/3.`
        : 'Attendance verification session is active. Please verify your location inside hostel.',
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching today attendance', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch today attendance' });
  }
});

// Helper to synchronize with active room round if open
async function syncActiveRoomRound(student, hostel, status, remark, lat, lng, accuracy) {
  try {
    const studentRoomNo = (student.roomNo || '').trim().toUpperCase();
    if (!studentRoomNo) return;

    const activeRoomReq = await RoomAttendanceRequest.findOne({
      hostel,
      roomNo: studentRoomNo,
      status: 'open',
    }).sort({ createdAt: -1 });

    if (!activeRoomReq) return;

    const isPresent = status === 'present' || status === 'approved';
    await RequestResponse.findOneAndUpdate(
      { request_id: activeRoomReq._id, student_id: student._id },
      {
        $set: {
          status: isPresent ? 'approved' : 'absent',
          approved_at: new Date(),
          inside_geofence: isPresent,
          remark,
          gps_lat: lat,
          gps_lng: lng,
          gps_accuracy: accuracy,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const { getIO } = require('../services/socketService');
    const io = getIO();
    if (io) {
      io.of('/dashboard').emit('room_attendance_updated', {
        roundId: activeRoomReq.round_id,
        roomNo: activeRoomReq.roomNo,
        studentId: student._id,
        studentName: student.name,
        status: isPresent ? 'approved' : 'absent',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    logger.warn('[Attendance] Error syncing active room round: ' + err.message);
  }
}

// Helper to emit live socket notification to staff dashboard
function emitSocketAttendance(student, hostel, status, timestamp) {
  try {
    const { getIO } = require('../services/socketService');
    const io = getIO();
    if (io) {
      io.of('/dashboard').emit('student_attendance_marked', {
        studentId: student._id,
        studentName: student.name,
        hostel,
        roomNo: student.roomNo,
        status,
        method: 'Automatic (GPS Geofence)',
        timestamp: new Date(timestamp).toISOString(),
      });
    }
  } catch (err) {
    logger.warn('[Attendance] Error emitting socket attendance: ' + err.message);
  }
}

// ── Student: GPS Geofence Attendance Verification ────────────────────────────
async function handleStudentAutoVerify(req, res) {
  try {
    const student = req.user;
    const now = new Date();
    const session = 'Night Attendance';
    const todayDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    if (!student.hostel) {
      return res.status(400).json({ success: false, code: 'NO_HOSTEL_ASSIGNED', message: 'No hostel is assigned to your profile.' });
    }

    const assignedHostel = normalizeHostelCode(student.hostel);
    if (req.body.hostel && normalizeHostelCode(req.body.hostel) !== assignedHostel) {
      return res.status(403).json({ success: false, code: 'CROSS_HOSTEL_FORBIDDEN', message: 'Verification is restricted to your assigned hostel.' });
    }

    const geofenceConfig = await getHostelGeofenceConfig(assignedHostel);
    const existingRecord = await AttendanceRecord.findOne({ student_id: student._id, date: todayDate, session }).lean();
    if (existingRecord) {
      const isPresent = existingRecord.status === 'present';
      return res.json({
        success: true,
        hasActiveSession: false,
        alreadyMarked: true,
        isMarked: true,
        status: isPresent ? 'PRESENT' : existingRecord.status === 'on_leave' ? 'ON_LEAVE' : 'ABSENT',
        code: 'ALREADY_FINALIZED',
        hostel: existingRecord.hostel || assignedHostel,
        hostelName: geofenceConfig.name,
        date: existingRecord.date,
        formattedDate: formatRecordDate(existingRecord.verification_timestamp || existingRecord.createdAt, existingRecord.date),
        time: formatRecordTime(existingRecord.verification_timestamp || existingRecord.createdAt),
        attemptsCount: existingRecord.attempt_count || 0,
        maxAttempts: 3,
        attemptsRemaining: 0,
        remainingSeconds: 0,
        locationStatus: isPresent ? 'INSIDE HOSTEL' : 'OUTSIDE HOSTEL',
        message: `Attendance is already finalized as ${isPresent ? 'PRESENT' : 'ABSENT'}.`,
      });
    }

    let attemptDoc = await AttendanceAttempt.findOne({ student_id: student._id, date: todayDate, session });
    if (!attemptDoc?.round_id) {
      return res.status(409).json({ success: false, code: 'NO_ACTIVE_SESSION', message: 'Night attendance has not been started by hostel staff.' });
    }

    if (req.body.verificationSessionId && String(req.body.verificationSessionId) !== String(attemptDoc._id)) {
      return res.status(409).json({ success: false, code: 'SESSION_MISMATCH', message: 'This attendance session is no longer active. Refresh and try again.' });
    }

    if (new Date(attemptDoc.expires_at).getTime() <= now.getTime()) {
      const finalized = await finalizeExpiredAttempt(attemptDoc._id, now);
      const record = finalized?.record || await AttendanceRecord.findOne({ student_id: student._id, date: todayDate, session }).lean();
      return res.status(409).json({
        success: Boolean(record),
        hasActiveSession: false,
        isMarked: Boolean(record),
        status: record?.status === 'present' ? 'PRESENT' : 'ABSENT',
        code: 'SESSION_EXPIRED',
        attemptsCount: attemptDoc.attemptsCount,
        maxAttempts: 3,
        attemptsRemaining: 0,
        remainingSeconds: 0,
        locationStatus: record?.status === 'present' ? 'INSIDE HOSTEL' : 'LOCATION UNAVAILABLE',
        message: record?.remark || 'The two-hour attendance window has expired.',
      });
    }

    const activeRound = await AttendanceRound.findOne({
      _id: attemptDoc.round_id,
      status: 'active',
      window_end: { $gt: now },
    }).lean();
    if (!activeRound) {
      return res.status(409).json({ success: false, code: 'NO_ACTIVE_SESSION', message: 'This night-attendance round is no longer active.' });
    }

    const responseForPending = (doc, extra = {}) => ({
      success: true,
      hasActiveSession: true,
      isMarked: false,
      status: 'PENDING',
      displayStatus: 'Pending Verification',
      hostel: assignedHostel,
      hostelName: geofenceConfig.name,
      date: todayDate,
      formattedDate: formatRecordDate(now, todayDate),
      attemptsCount: doc.attemptsCount,
      maxAttempts: 3,
      attemptsRemaining: Math.max(0, 3 - doc.attemptsCount),
      remainingSeconds: Math.max(0, Math.floor((new Date(doc.expires_at).getTime() - now.getTime()) / 1000)),
      expiresAt: new Date(doc.expires_at).toISOString(),
      verificationSessionId: String(doc._id),
      ...extra,
    });

    const responseForFinal = (record, doc) => {
      const isPresent = record.status === 'present';
      return {
        success: true,
        hasActiveSession: false,
        isMarked: true,
        status: isPresent ? 'PRESENT' : 'ABSENT',
        code: 'ALREADY_FINALIZED',
        hostel: record.hostel || assignedHostel,
        hostelName: geofenceConfig.name,
        date: record.date || todayDate,
        formattedDate: formatRecordDate(record.verification_timestamp || record.createdAt || now, record.date || todayDate),
        time: formatRecordTime(record.verification_timestamp || record.createdAt || now),
        attemptsCount: doc?.attemptsCount ?? record.attempt_count ?? 0,
        attemptsUsed: doc?.attemptsCount ?? record.attempt_count ?? 0,
        maxAttempts: 3,
        attemptsRemaining: 0,
        remainingSeconds: 0,
        locationStatus: isPresent ? 'INSIDE HOSTEL' : 'OUTSIDE HOSTEL',
        message: record.remark || `Attendance is finalized as ${isPresent ? 'PRESENT' : 'ABSENT'}.`,
      };
    };

    if (attemptDoc.status === 'verifying') {
      const lockAge = now.getTime() - new Date(attemptDoc.verification_started_at || attemptDoc.updatedAt).getTime();
      if (lockAge < 30_000) {
        return res.json(responseForPending(attemptDoc, { code: 'VERIFICATION_IN_PROGRESS', locationStatus: 'VERIFYING', message: 'Location verification is already in progress.' }));
      }
      attemptDoc = await AttendanceAttempt.findOneAndUpdate(
        { _id: attemptDoc._id, status: 'verifying' },
        { $set: { status: 'pending', verification_started_at: null } },
        { new: true }
      );
    }

    if (attemptDoc.status !== 'pending') {
      const record = await AttendanceRecord.findOne({ student_id: student._id, date: todayDate, session }).lean();
      return res.json(responseForFinal(record || {
        status: attemptDoc.status === 'present' ? 'present' : 'absent', date: todayDate, hostel: assignedHostel, attempt_count: attemptDoc.attemptsCount,
      }, attemptDoc));
    }

    const isFetchFailure = Boolean(req.body.fetchFailed || req.body.fetchError || req.body.gpsError);
    const { lat, lng, accuracy, timestamp } = req.body;
    const numLat = Number(lat);
    const numLng = Number(lng);
    const numAccuracy = Number(accuracy);
    let technicalError = null;
    let technicalCode = null;

    if (isFetchFailure) {
      technicalError = req.body.reason || 'GPS location retrieval failed on this device.';
      technicalCode = req.body.code || req.body.errorCode || 'GPS_FETCH_FAILED';
    } else if (
      typeof lat === 'undefined' || typeof lng === 'undefined' || typeof accuracy === 'undefined' ||
      !Number.isFinite(numLat) || !Number.isFinite(numLng) || !Number.isFinite(numAccuracy) ||
      numAccuracy < 0 || numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180
    ) {
      technicalError = 'Invalid GPS coordinates or accuracy received from the device.';
      technicalCode = 'INVALID_COORDINATES';
    } else if (!Number.isFinite(Number(timestamp)) || Math.abs(now.getTime() - Number(timestamp)) > 120_000) {
      technicalError = 'GPS reading is stale or missing a valid timestamp. Please acquire a fresh location.';
      technicalCode = 'STALE_COORDINATES';
    } else if (numAccuracy > (geofenceConfig.accuracy_threshold_m ?? 25)) {
      technicalError = `Location accuracy (±${Math.round(numAccuracy)}m) is insufficient. Move near a window or open area and retry.`;
      technicalCode = 'LOW_GPS_ACCURACY';
    }

    if (technicalError) {
      const updated = await AttendanceAttempt.findOneAndUpdate(
        { _id: attemptDoc._id, status: 'pending', expires_at: { $gt: now } },
        {
          $set: { locationStatus: 'LOCATION UNAVAILABLE' },
          $push: {
            attempts: {
              attemptNumber: attemptDoc.attemptsCount,
              timestamp: now,
              // The raw browser fix is used only for this validation. Retain
              // the accuracy and outcome for auditability, not a location
              // history of students who could not be verified.
              lat: null,
              lng: null,
              accuracy: Number.isFinite(numAccuracy) ? numAccuracy : null,
              distanceMeters: null,
              radiusMeters: geofenceConfig.radius_m,
              success: false,
              reason: technicalError,
              errorCode: technicalCode,
              counted: false,
            },
          },
        },
        { new: true }
      );
      if (!updated) {
        const fresh = await AttendanceAttempt.findById(attemptDoc._id).lean();
        return res.json(responseForPending(fresh || attemptDoc, { code: 'VERIFICATION_IN_PROGRESS', locationStatus: 'VERIFYING', message: 'Location verification is already in progress.' }));
      }
      return res.json(responseForPending(updated, { locationStatus: 'LOCATION UNAVAILABLE', message: technicalError }));
    }

    // Only a complete, current and accurate GPS fix claims a location check.
    const claimed = await AttendanceAttempt.findOneAndUpdate(
      { _id: attemptDoc._id, status: 'pending', attemptsCount: { $lt: 3 }, expires_at: { $gt: now } },
      { $inc: { attemptsCount: 1 }, $set: { status: 'verifying', verification_started_at: now } },
      { new: true }
    );
    if (!claimed) {
      const fresh = await AttendanceAttempt.findById(attemptDoc._id).lean();
      if (fresh?.status === 'verifying') {
        return res.json(responseForPending(fresh, { code: 'VERIFICATION_IN_PROGRESS', locationStatus: 'VERIFYING', message: 'Location verification is already in progress.' }));
      }
      const record = await AttendanceRecord.findOne({ student_id: student._id, date: todayDate, session }).lean();
      return res.json(responseForFinal(record || {
        status: fresh?.status === 'present' ? 'present' : 'absent', date: todayDate, hostel: assignedHostel, attempt_count: fresh?.attemptsCount || 0,
      }, fresh));
    }

    const attemptNumber = claimed.attemptsCount;
    const geoResult = await verifyHostelGeofence(assignedHostel, { lat: numLat, lng: numLng, accuracy: numAccuracy });
    const validFixEvent = {
      attemptNumber,
      timestamp: now,
      // Keep the verification result and distance, but never persist a
      // student's precise raw coordinates after the geofence calculation.
      lat: null,
      lng: null,
      accuracy: numAccuracy,
      distanceMeters: geoResult.distanceToCenterMeters ?? null,
      radiusMeters: geoResult.radiusMeters || geofenceConfig.radius_m,
      success: geoResult.valid,
      reason: geoResult.message,
      errorCode: geoResult.valid ? null : 'OUTSIDE_GEOFENCE',
      counted: true,
    };

    if (geoResult.valid) {
      const remark = `Automatic geofence verification inside ${geofenceConfig.name} (${Math.round(geoResult.distanceToCenterMeters)}m from center, accuracy ±${Math.round(numAccuracy)}m)`;
      const record = await AttendanceRecord.findOneAndUpdate(
        { student_id: student._id, date: todayDate, session },
        {
          $setOnInsert: {
            student_id: student._id, date: todayDate, session, session_name: session,
            hostel: assignedHostel, floor: student.floor || '', roomNo: student.roomNo || 'Assigned',
            status: 'present', method: 'self_approved', verified_by: student._id,
            attempt_count: attemptNumber, verification_timestamp: now, remark, round_id: claimed.round_id,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      const finalStatus = record.status === 'present' ? 'present' : 'absent';
      await AttendanceAttempt.updateOne(
        { _id: claimed._id, status: 'verifying' },
        { $set: { status: finalStatus, finalizedAt: now, verification_started_at: null, locationStatus: finalStatus === 'present' ? 'INSIDE HOSTEL' : 'OUTSIDE HOSTEL' }, $push: { attempts: validFixEvent } }
      );
      if (finalStatus === 'present') {
        await syncActiveRoomRound(student, assignedHostel, 'approved', remark, numLat, numLng, numAccuracy);
        emitSocketAttendance(student, assignedHostel, 'present', now);
      }
      await AttendanceAuditLog.create({
        actor_id: student._id, actor_role: student.role, actor_name: student.name,
        action: 'AUTO_ATTENDANCE_MARKED', entity: 'AttendanceRecord', entity_id: record._id.toString(),
        old_value: null, new_value: { hostel: assignedHostel, status: finalStatus, attempt: attemptNumber }, reason: remark,
      }).catch((err) => logger.warn('[AuditLog] Warning: ' + err.message));
      return res.json(responseForFinal(record, { ...claimed.toObject(), status: finalStatus }));
    }

    const distance = Math.round(geoResult.distanceToCenterMeters || 0);
    const remark = `Outside ${geofenceConfig.name} boundary (${distance}m from center; permitted radius ${geoResult.radiusMeters}m)`;
    if (attemptNumber < 3) {
      const updated = await AttendanceAttempt.findOneAndUpdate(
        { _id: claimed._id, status: 'verifying' },
        { $set: { status: 'pending', verification_started_at: null, locationStatus: 'OUTSIDE HOSTEL' }, $push: { attempts: validFixEvent } },
        { new: true }
      );
      return res.json(responseForPending(updated || claimed, {
        locationStatus: 'OUTSIDE HOSTEL', distanceMeters: distance, permittedRadius: geoResult.radiusMeters,
        message: `${remark}. ${3 - attemptNumber} location check(s) remain.`,
      }));
    }

    const record = await AttendanceRecord.findOneAndUpdate(
      { student_id: student._id, date: todayDate, session },
      {
        $setOnInsert: {
          student_id: student._id, date: todayDate, session, session_name: session,
          hostel: assignedHostel, floor: student.floor || '', roomNo: student.roomNo || 'Assigned',
          status: 'absent', method: 'self_approved', verified_by: student._id,
          attempt_count: attemptNumber, verification_timestamp: now,
          remark: `Marked ABSENT: three valid location checks did not pass. Latest: ${remark}`,
          round_id: claimed.round_id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const finalStatus = record.status === 'present' ? 'present' : 'absent';
    await AttendanceAttempt.updateOne(
      { _id: claimed._id, status: 'verifying' },
      { $set: { status: finalStatus, finalizedAt: now, verification_started_at: null, locationStatus: 'OUTSIDE HOSTEL' }, $push: { attempts: validFixEvent } }
    );
    if (finalStatus === 'absent') {
      await syncActiveRoomRound(student, assignedHostel, 'absent', record.remark, numLat, numLng, numAccuracy);
      emitSocketAttendance(student, assignedHostel, 'absent', now);
    }
    return res.json(responseForFinal(record, { ...claimed.toObject(), status: finalStatus }));
  } catch (err) {
    logger.error('[Attendance] Error during auto-verification', { error: err.message });
    return res.status(500).json({ success: false, message: 'Server error during attendance verification' });
  }
}

router.post('/auto-verify', protect, authorize('student'), handleStudentAutoVerify);
router.post('/verify', protect, authorize('student'), handleStudentAutoVerify);
router.post('/geofence-verify', protect, authorize('student'), handleStudentAutoVerify);
router.post('/gps-failure', protect, authorize('student'), handleStudentAutoVerify);

// ── Student: Pending Attendance Request Check ────────────────────────────────
router.get('/pending', protect, authorize('student'), async (req, res) => {
  try {
    const now = new Date();
    const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    if (!req.user.hostel || !req.user.roomNo) {
      return res.json({
        success: true,
        hasPending: false,
        reason: 'NO_ROOM_ALLOCATED',
        todayStatus: {
          isMarked: false,
          status: 'unallocated',
          date: todayDate,
          formattedDate: formatRecordDate(now, todayDate),
          message: 'No room currently assigned. Please contact hostel administration.',
        },
      });
    }

    const cleanHostel = req.user.hostel.toUpperCase();
    const normHostel = normalizeHostelCode(req.user.hostel);
    const cleanRoomNo = req.user.roomNo.trim().toUpperCase();

    const todayRecord = await AttendanceRecord.findOne({
      student_id: req.user._id,
      date: todayDate,
    }).populate('verified_by', 'name role').lean();

    const formattedToday = todayRecord ? {
      id: todayRecord._id,
      status: todayRecord.status,
      date: todayRecord.date,
      formattedDate: formatRecordDate(todayRecord.createdAt || todayRecord.updatedAt, todayRecord.date),
      time: formatRecordTime(todayRecord.createdAt || todayRecord.updatedAt),
      markedAt: todayRecord.createdAt || todayRecord.updatedAt,
      session: todayRecord.session,
      roomNo: todayRecord.roomNo,
      method: todayRecord.method,
      remark: todayRecord.remark,
      verifiedBy: todayRecord.verified_by?.name || (todayRecord.method === 'self_approved' ? 'Self (GPS Geofence)' : 'Staff Verified'),
    } : null;

    const todayStatus = todayRecord ? {
      isMarked: true,
      status: todayRecord.status,
      date: todayRecord.date,
      formattedDate: formatRecordDate(todayRecord.createdAt || todayRecord.updatedAt, todayRecord.date),
      time: formatRecordTime(todayRecord.createdAt || todayRecord.updatedAt),
      markedAt: todayRecord.createdAt || todayRecord.updatedAt,
      roomNo: todayRecord.roomNo,
      method: todayRecord.method,
      remark: todayRecord.remark,
      verifiedBy: todayRecord.verified_by?.name || (todayRecord.method === 'self_approved' ? 'Self (GPS Geofence)' : 'Staff Verified'),
    } : {
      isMarked: false,
      status: 'unmarked',
      date: todayDate,
      formattedDate: formatRecordDate(now, todayDate),
      time: null,
      markedAt: null,
      roomNo: req.user.roomNo,
      message: 'Attendance for today has not been marked yet. Verification will activate when staff opens the night round.',
    };

    // 1. Check if student has an active RequestResponse created for this student
    const activeStudentResp = await RequestResponse.findOne({
      student_id: req.user._id,
      status: { $in: ['pending', 'flagged'] },
    }).populate('request_id');

    let request = null;
    if (
      activeStudentResp &&
      activeStudentResp.request_id &&
      activeStudentResp.request_id.status === 'open' &&
      new Date(activeStudentResp.request_id.expires_at) > now
    ) {
      request = await RoomAttendanceRequest.findById(activeStudentResp.request_id._id)
        .populate('round_id', 'date session_name hostel floor')
        .lean();
    }

    // 2. Fallback to room + hostel query
    if (!request) {
      const hostelRegex = new RegExp(`^${normHostel}`, 'i');
      request = await RoomAttendanceRequest.findOne({
        $or: [
          { hostel: normHostel },
          { hostel: cleanHostel },
          { hostel: hostelRegex },
        ],
        roomNo: cleanRoomNo,
        status: 'open',
        expires_at: { $gt: now },
      })
        .populate('round_id', 'date session_name hostel floor')
        .lean();
    }

    if (!request) {
      return res.json({
        success: true,
        hasPending: false,
        todayRecord: formattedToday,
        todayStatus,
      });
    }

    // Check student's response state for this request
    const existingResp = await RequestResponse.findOne({
      request_id: request._id,
      student_id: req.user._id,
    }).lean();

    const remainingSeconds = Math.max(
      0,
      Math.round((new Date(request.expires_at).getTime() - Date.now()) / 1000)
    );

    res.json({
      success: true,
      hasPending: true,
      todayRecord: formattedToday,
      todayStatus,
      request: {
        id: request._id,
        roomNo: request.roomNo,
        hostel: request.hostel,
        sessionName: request.round_id?.session_name || 'Night Attendance',
        expiresAt: request.expires_at,
        remainingSeconds,
        nonce: request.nonce,
        status: existingResp?.status || 'pending',
        alreadyApproved: existingResp?.status === 'approved' || existingResp?.status === 'manual_present',
        onLeave: existingResp?.status === 'on_leave',
      },
    });
  } catch (err) {
    logger.error('[Attendance] Error checking pending requests', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to check pending attendance requests' });
  }
});

// ── Student: Get Server Nonce / Challenge ────────────────────────────────────
router.get('/challenge/:requestId', protect, authorize('student'), async (req, res) => {
  try {
    const request = await RoomAttendanceRequest.findById(req.params.requestId).lean();
    if (!request) {
      return res.status(404).json({ success: false, code: 'REQUEST_NOT_FOUND', message: 'Request not found' });
    }

    if (new Date(request.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, code: 'REQUEST_EXPIRED', message: 'Attendance request has expired' });
    }

    res.json({
      success: true,
      requestId: request._id,
      nonce: request.nonce,
      challenge: request.nonce,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Student: Submit Location Geofence Attendance Approval ────────────────────
router.post(['/requests/:requestId/approve', '/requests/:id/approve'], protect, authorize('student'), async (req, res) => {
  try {
    const {
      nonce,
      deviceId,
      credentialId,
      signature,
      gps_lat,
      gps_lng,
      gps_accuracy,
      timestamp,
    } = req.body;

    const targetReqId = req.params.requestId || req.params.id;
    const request = await RoomAttendanceRequest.findById(targetReqId);

    // Check 1: Request exists and is open
    if (!request || request.status !== 'open') {
      return res.status(400).json({
        success: false,
        code: 'REQUEST_EXPIRED',
        message: 'Attendance request does not exist or is no longer open',
      });
    }

    // Check 2: Request has not expired
    if (new Date(request.expires_at).getTime() < Date.now()) {
      request.status = 'expired';
      await request.save();
      return res.status(400).json({
        success: false,
        code: 'REQUEST_EXPIRED',
        message: 'Attendance request has expired',
      });
    }

    // Check 3: Student belongs to that room (live roster verification using RoomAllocation as source of truth)
    let isStudentInRoom = false;
    let activeAlloc = null;

    try {
      activeAlloc = await RoomAllocation.findOne({
        student_id: req.user._id,
        status: 'active',
      }).populate({ path: 'room_id', populate: { path: 'hostel_id' } });

      if (activeAlloc && activeAlloc.room_id) {
        const allocHostel = (activeAlloc.room_id.hostel_id?.code || '').toUpperCase();
        const allocRoomNo = (activeAlloc.room_id.room_number || '').trim().toUpperCase();
        if (allocHostel === request.hostel && allocRoomNo === request.roomNo) {
          isStudentInRoom = true;
        }
      }
    } catch (allocErr) {
      logger.warn('[Attendance] Error checking live RoomAllocation', { error: allocErr.message });
    }

    // Check 2.5: Strict Assigned Hostel Validation (A BH1 student cannot approve at BH2, etc.)
    const studentHostelNorm = normalizeHostelCode(req.user.hostel);
    const requestHostelNorm = normalizeHostelCode(request.hostel);
    if (studentHostelNorm !== requestHostelNorm) {
      return res.status(403).json({
        success: false,
        code: 'CROSS_HOSTEL_FORBIDDEN',
        message: `You are assigned to ${req.user.hostel}. Attendance at ${request.hostel} is not permitted.`,
      });
    }

    if (!isStudentInRoom) {
      const studentHostel = req.user.hostel?.toUpperCase();
      const studentRoomNo = req.user.roomNo?.trim().toUpperCase();
      if (studentHostel === request.hostel && studentRoomNo === request.roomNo) {
        isStudentInRoom = true;
      }
    }

    if (!isStudentInRoom) {
      return res.status(403).json({
        success: false,
        code: 'NOT_IN_ROOM_ROSTER',
        message: 'You are not assigned to this room roster',
      });
    }

    // Check 4: Idempotency (if already approved, return ALREADY_APPROVED without side effects)
    let resp = await RequestResponse.findOne({
      request_id: request._id,
      student_id: req.user._id,
    });

    if (resp && (resp.status === 'approved' || resp.status === 'manual_present')) {
      return res.status(200).json({
        success: true,
        code: 'ALREADY_APPROVED',
        message: 'Attendance has already been approved for this round',
      });
    }

    // Check 5: GPS Geofence Verification (strict building radius)
    const hasCoords = typeof gps_lat === 'number' && typeof gps_lng === 'number' && !isNaN(gps_lat) && !isNaN(gps_lng);
    let geoResult = null;
    if (hasCoords) {
      geoResult = await verifyHostelGeofence(request.hostel || req.user.hostel, {
        lat: Number(gps_lat),
        lng: Number(gps_lng),
        accuracy: Number(gps_accuracy || 10),
      });
    }

    const isInsideGeofence = Boolean(hasCoords && geoResult && geoResult.valid === true);
    const now = new Date();
    const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const { getIO } = require('../services/socketService');
    const io = getIO();

    if (isInsideGeofence) {
      // ── INSIDE GEOFENCE: MARK PRESENT (APPROVED) ──
      const remarkText = geoResult?.message || `Detected inside hostel building (Accuracy ±${Math.round(gps_accuracy || 10)}m)`;

      if (!resp) {
        resp = await RequestResponse.create({
          request_id: request._id,
          student_id: req.user._id,
          allocation_id: activeAlloc?._id || undefined,
          status: 'approved',
          approved_at: now,
          gps_lat: Number(gps_lat),
          gps_lng: Number(gps_lng),
          gps_accuracy: Number(gps_accuracy || 10),
          inside_geofence: true,
          flags: [],
          remark: remarkText,
        });
      } else {
        resp.status = 'approved';
        if (activeAlloc?._id) resp.allocation_id = activeAlloc._id;
        resp.approved_at = now;
        resp.gps_lat = Number(gps_lat);
        resp.gps_lng = Number(gps_lng);
        resp.gps_accuracy = Number(gps_accuracy || 10);
        resp.inside_geofence = true;
        resp.flags = [];
        resp.remark = remarkText;
        await resp.save();
      }

      await AttendanceRecord.findOneAndUpdate(
        { student_id: req.user._id, date: todayDate, session: 'Night Attendance' },
        {
          $set: {
            student_id: req.user._id,
            date: todayDate,
            session: 'Night Attendance',
            hostel: request.hostel,
            floor: parseFloorFromRoom(request.roomNo),
            roomNo: request.roomNo,
            status: 'present',
            method: 'self_approved',
            verified_by: req.user._id,
            remark: remarkText,
            verification_timestamp: now,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).catch((err) => logger.warn('[AttendanceRecord] Record upsert warning: ' + err.message));

      if (io) {
        io.of('/dashboard').emit('room_attendance_updated', {
          roundId: request.round_id,
          roomNo: request.roomNo,
          studentId: req.user._id,
          studentName: req.user.name,
          status: 'approved',
          timestamp: now.toISOString(),
        });
      }

      logger.info('[Attendance] Student verified inside building -> PRESENT', {
        studentId: req.user._id,
        roomNo: request.roomNo,
        hostel: request.hostel,
        distToCenterMeters: geoResult?.distanceToCenterMeters,
      });

      return res.json({
        success: true,
        status: 'present',
        code: 'PRESENT',
        message: geoResult?.message || 'Verified inside hostel building! Attendance marked PRESENT.',
        accuracy: Math.round(gps_accuracy || 10),
        distanceMeters: geoResult?.distanceToCenterMeters || 0,
        approvedAt: now.toISOString(),
        markedAt: now.toISOString(),
        date: todayDate,
        formattedDate: formatRecordDate(now, todayDate),
        time: formatRecordTime(now),
      });
    } else {
      // ── REJECT: LOCATION INACCURATE OR OUTSIDE GEOFENCE ──
      if (!hasCoords) {
        return res.status(400).json({
          success: false,
          code: 'NO_LOCATION',
          message: 'GPS location not available. Please grant location permissions and try again.',
        });
      }

      if (geoResult?.reason === 'LOW_GPS_ACCURACY') {
        return res.status(400).json({
          success: false,
          code: 'LOW_GPS_ACCURACY',
          accuracy: Number(gps_accuracy),
          message: geoResult.message || 'Your location accuracy is insufficient. Please enable High Accuracy / Precise Location and try again.',
        });
      }

      const distanceAway = Math.round(geoResult?.distanceToCenterMeters || 0);
      return res.status(400).json({
        success: false,
        code: 'OUTSIDE_GEOFENCE',
        distanceMeters: distanceAway,
        permittedRadius: geoResult?.radiusMeters || 22,
        message: geoResult?.message || `You are outside your assigned hostel's permitted attendance area (${distanceAway}m away).`,
      });
    }
  } catch (err) {
    logger.error('[Attendance] Error during student approval', { error: err.message });
    res.status(500).json({ success: false, message: 'Server error during attendance verification' });
  }
});

// ── Student: Personal Attendance History ─────────────────────────────────────
router.get('/history', protect, authorize('student'), async (req, res) => {
  try {
    const student = req.user;
    const assignedHostel = normalizeHostelCode(student.hostel) || 'BH2';
    const now = new Date();
    const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const session = 'Night Attendance';

    // 1. Fetch rounds conducted for student's hostel for today's live status.
    const rounds = await AttendanceRound.find({
      hostel: assignedHostel,
    }).select('date session_name status completed_at').lean();

    // 2. Fetch approved home visits.
    const leaves = await HomeVisitLog.find({
      student_id: student._id,
      overall_status: 'approved',
    }).lean();

    // 3. Query finalized student records. History reads must never manufacture
    // absence rows; finalization paths are the only writers to the ledger.
    const rawRecords = await AttendanceRecord.find({ student_id: student._id })
      .populate('verified_by', 'name role')
      .sort({ date: -1, verification_timestamp: -1, updatedAt: -1, createdAt: -1 })
      .limit(120)
      .lean();

    // Older deployments may contain a fallback "during round" row alongside
    // the authoritative room-request/finalization row. Return one outcome per
    // date and session, preferring the row tied to an actual round or request.
    const recordsBySession = new Map();
    for (const record of rawRecords) {
      const key = `${record.date}:${String(record.session || session).trim().toLowerCase()}`;
      const current = recordsBySession.get(key);
      const isFallback = (entry) =>
        entry?.remark === 'Unverified / Absent during round' && !entry.round_id && !entry.request_id;

      if (!current || (isFallback(current) && !isFallback(record))) {
        recordsBySession.set(key, record);
      }
    }
    const records = Array.from(recordsBySession.values()).slice(0, 60);

    // 4. Compute today's status summary
    const todayRec = records.find((r) => r.date === todayDate);
    const todayLeave = leaves.find(
      (l) => l.leave_date <= todayDate && l.return_date >= todayDate && !l.qr_used_in
    );
    const activeRoundToday = rounds.find((r) => r.date === todayDate && r.status === 'active');

    let todayStatusVal = 'not_marked';
    let todayDisplayStatus = 'Not Marked Yet';
    if (todayRec) {
      todayStatusVal = todayRec.status;
      todayDisplayStatus =
        todayRec.status === 'present'
          ? 'Present'
          : todayRec.status === 'absent'
          ? 'Absent'
          : 'On Approved Leave';
    } else if (todayLeave) {
      todayStatusVal = 'on_leave';
      todayDisplayStatus = 'On Approved Leave';
    } else if (activeRoundToday) {
      todayStatusVal = 'pending';
      todayDisplayStatus = 'Verification Pending';
    }

    const todaySummary = {
      isMarked: Boolean(todayRec || todayLeave),
      status: todayStatusVal,
      displayStatus: todayDisplayStatus,
      time: todayRec
        ? formatRecordTime(getRecordTimestamp(todayRec))
        : null,
      date: todayDate,
      formattedDate: formatRecordDate(now, todayDate),
      session,
      hostel: assignedHostel,
      roomNo: student.roomNo || 'Assigned',
      method: todayRec?.method || (todayLeave ? 'Approved Leave' : null),
      remark: todayRec?.remark || (todayLeave ? 'On approved home visit leave' : ''),
      hasActiveRound: Boolean(activeRoundToday),
      canVerify: Boolean(activeRoundToday && !todayRec && !todayLeave),
    };

    res.json({
      success: true,
      count: records.length,
      today: todaySummary,
      records: records.map((r) => {
        const ts = getRecordTimestamp(r);
        return {
          id: r._id,
          date: r.date,
          formattedDate: formatRecordDate(ts, r.date),
          time: formatRecordTime(ts),
          markedAt: ts,
          session: r.session,
          hostel: r.hostel,
          roomNo: r.roomNo,
          status: r.status,
          method: r.method,
          remark: r.remark,
          verifiedBy: r.verified_by?.name || (r.method === 'self_approved' ? 'Self (GPS Geofence)' : 'Staff Verified'),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching student history', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to load attendance history' });
  }
});

// ── Security & Staff: Read-Only Daily Attendance Summary ────────────────────
router.get('/summary', protect, authorize('warden', 'security', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const { date, hostel } = req.query;
    const todayStr = date || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    const studentFilter = { role: 'student', isActive: true };
    const recordFilter = { date: todayStr };
    const roundFilter = { date: todayStr };

    if (hostel && hostel.toUpperCase() !== 'ALL') {
      const cleanHostel = hostel.toUpperCase();
      if (cleanHostel === 'GH1' || cleanHostel === 'GH') {
        studentFilter.hostel = { $in: ['GH1', 'GH'] };
        recordFilter.hostel = { $in: ['GH1', 'GH'] };
        roundFilter.hostel = { $in: ['GH1', 'GH'] };
      } else {
        studentFilter.hostel = cleanHostel;
        recordFilter.hostel = cleanHostel;
        roundFilter.hostel = cleanHostel;
      }
    }

    const totalStudents = await User.countDocuments(studentFilter);
    const records = await AttendanceRecord.find(recordFilter).lean();

    let presentCount = 0;
    let absentCount = 0;
    let onLeaveCount = 0;
    let manualCount = 0;

    for (const r of records) {
      if (r.status === 'present') {
        presentCount++;
        if (r.method === 'staff_marked') manualCount++;
      } else if (r.status === 'on_leave') {
        onLeaveCount++;
      } else if (r.status === 'absent') {
        absentCount++;
      }
    }

    const rounds = await AttendanceRound.find(roundFilter)
      .select('_id hostel floor session_name status completed_at')
      .lean();
    const roundIds = rounds.map((r) => r._id);
    const roundRequests = await RoomAttendanceRequest.find({ round_id: { $in: roundIds } })
      .select('_id roomNo hostel')
      .lean();
    const reqIds = roundRequests.map((rq) => rq._id);
    const reqMap = new Map(roundRequests.map((rq) => [rq._id.toString(), rq]));

    const flaggedResponses = await RequestResponse.find({
      request_id: { $in: reqIds },
      $or: [{ status: 'flagged' }, { 'flags.0': { $exists: true } }],
    })
      .populate('student_id', 'name rollNo roomNo hostel phone email')
      .lean();

    const formattedFlags = flaggedResponses.map((f) => {
      const rq = reqMap.get(f.request_id?.toString()) || {};
      return {
        id: f._id,
        student: f.student_id,
        hostel: rq.hostel || f.student_id?.hostel,
        roomNo: rq.roomNo || f.student_id?.roomNo,
        status: f.status,
        flags: f.flags || [],
        gps_accuracy: f.gps_accuracy,
        inside_geofence: f.inside_geofence,
        approved_at: f.approved_at,
        remark: f.remark,
      };
    });

    const recordedTotal = presentCount + absentCount + onLeaveCount;
    const unresolvedCount = Math.max(0, totalStudents - recordedTotal);

    res.json({
      success: true,
      date: todayStr,
      hostel: hostel ? hostel.toUpperCase() : 'ALL',
      totalStudents,
      present: presentCount,
      absent: absentCount,
      onLeave: onLeaveCount,
      manualMarked: manualCount,
      unresolved: unresolvedCount,
      flaggedCount: formattedFlags.length,
      rounds: rounds.map((rd) => ({
        id: rd._id,
        hostel: rd.hostel,
        floor: rd.floor,
        session: rd.session_name,
        status: rd.status,
        completedAt: rd.completed_at,
      })),
      anomalies: formattedFlags,
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching summary', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch attendance summary' });
  }
});

// ── Staff/Admin: Attendance Reports & CSV Export ─────────────────────────────
router.get('/reports', protect, authorize('warden', 'admin', 'hostel_staff', 'staff'), async (req, res) => {
  try {
    const { startDate, endDate, hostel, floor, status, student: studentSearch, format: reqFormat } = req.query;

    const getISTDate = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const effectiveStartDate = startDate || getISTDate();
    const effectiveEndDate = endDate || effectiveStartDate;

    // 1. Gather all active students matching requested hostel scope
    const studentFilter = { role: 'student', isActive: true };
    if (hostel && hostel.toUpperCase() !== 'ALL') {
      const hUpper = hostel.toUpperCase();
      if (hUpper === 'GH1' || hUpper === 'GH') {
        studentFilter.hostel = { $in: ['GH1', 'GH'] };
      } else {
        studentFilter.hostel = hUpper;
      }
    }

    const allStudents = await User.find(studentFilter)
      .select('_id name rollNo email phone hostel roomNo')
      .lean();

    // 2. Resolve room allocations to guarantee accurate room numbers & floors
    const allocations = await RoomAllocation.find({ status: 'active' })
      .populate('room_id', 'room_number')
      .lean();
    const allocRoomMap = new Map();
    for (const a of allocations) {
      if (a.student_id && a.room_id?.room_number) {
        allocRoomMap.set(a.student_id.toString(), a.room_id.room_number);
      }
    }

    // 3. Build list of dates to cover (at most 180 days)
    const dateList = [];
    const cur = new Date(effectiveStartDate);
    const end = new Date(effectiveEndDate);
    let safetyCounter = 0;
    while (cur <= end && safetyCounter < 180) {
      dateList.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
      safetyCounter++;
    }
    if (dateList.length === 0) dateList.push(effectiveStartDate);

    // 4. Reports are read-only. Final records are created by GPS verification,
    // staff actions, or the expiry job — never as a side effect of viewing a
    // report. Live pending rows are appended below from AttendanceAttempt.

    // 5. Query finalized AttendanceRecords with user filters
    const query = {};
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      query.date = { $gte: startDate };
    } else if (endDate) {
      query.date = { $lte: endDate };
    }

    if (hostel && hostel.toUpperCase() !== 'ALL') {
      const hUpper = hostel.toUpperCase();
      if (hUpper === 'GH1' || hUpper === 'GH') {
        query.hostel = { $in: ['GH1', 'GH'] };
      } else {
        query.hostel = hUpper;
      }
    }

    // Keep All Floors working correctly - if floor is ALL, do not constrain query.floor
    if (floor && floor.toUpperCase() !== 'ALL') {
      const cleanFloor = String(floor).trim();
      const escaped = cleanFloor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.floor = { $regex: escaped, $options: 'i' };
    }

    if (status && status.toLowerCase() !== 'all') {
      query.status = status.toLowerCase();
    }

    // Support student filtering by name or roll number
    if (studentSearch && String(studentSearch).trim()) {
      const sTrim = String(studentSearch).trim();
      const sRegex = new RegExp(sTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const matchedStudents = await User.find({
        role: 'student',
        $or: [{ name: sRegex }, { rollNo: sRegex }, { email: sRegex }],
      }).select('_id').lean();
      const sIds = matchedStudents.map((s) => s._id);
      query.student_id = { $in: sIds };
    }

    let records = await AttendanceRecord.find(query)
      .populate('student_id', 'name rollNo email phone hostel roomNo')
      .populate('verified_by', 'name role')
      .sort({ date: -1, hostel: 1, floor: 1, roomNo: 1 })
      .lean();

    // Add transient PENDING rows from the same authoritative attempt records.
    // They are intentionally not ledger rows: AttendanceRecord only stores a
    // finalized outcome and must not be polluted by status-report reads.
    const now = new Date();
    const liveRounds = await AttendanceRound.find({
      date: { $in: dateList },
      status: 'active',
      window_end: { $gt: now },
    }).select('_id').lean();
    const liveRoundIds = liveRounds.map((round) => round._id);
    const reportAttempts = await AttendanceAttempt.find({
      date: { $in: dateList },
      student_id: { $in: allStudents.map((student) => student._id) },
    }).lean();
    const attemptByStudentDate = new Map(
      reportAttempts.map((attempt) => [`${attempt.student_id}:${attempt.date}`, attempt])
    );
    const liveRoundIdSet = new Set(liveRoundIds.map((id) => String(id)));
    const pendingAttempts = reportAttempts.filter(
      (attempt) => liveRoundIdSet.has(String(attempt.round_id)) && ['pending', 'verifying'].includes(attempt.status)
    );
    const allFinalized = await AttendanceRecord.find({
      student_id: { $in: allStudents.map((student) => student._id) },
      date: { $in: dateList },
      session: 'Night Attendance',
    }).select('student_id date').lean();
    const finalizedKeys = new Set(allFinalized.map((record) => `${record.student_id}:${record.date}`));
    const studentById = new Map(allStudents.map((student) => [String(student._id), student]));
    const pendingRows = [];

    if (!status || status.toLowerCase() === 'all' || status.toLowerCase() === 'pending') {
      for (const attempt of pendingAttempts) {
        const student = studentById.get(String(attempt.student_id));
        const key = `${attempt.student_id}:${attempt.date}`;
        if (!student || finalizedKeys.has(key)) continue;

        const resolvedRoom = student.roomNo || allocRoomMap.get(String(student._id)) || 'Assigned';
        const resolvedFloor = parseFloorFromRoom(resolvedRoom);
        if (floor && floor.toUpperCase() !== 'ALL' && !resolvedFloor.toLowerCase().includes(String(floor).toLowerCase())) continue;
        if (studentSearch && String(studentSearch).trim()) {
          const needle = String(studentSearch).trim().toLowerCase();
          if (![student.name, student.rollNo, student.email].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))) continue;
        }

        const latest = attempt.attempts?.[attempt.attempts.length - 1];
        pendingRows.push({
          _id: `pending-${attempt._id}`,
          date: attempt.date,
          session: attempt.session || 'Night Attendance',
          hostel: attempt.hostel,
          floor: resolvedFloor,
          roomNo: resolvedRoom,
          student_id: student,
          status: 'pending',
          method: 'automatic_pending',
          remark: latest?.reason || 'Awaiting GPS verification.',
          verification_timestamp: null,
          createdAt: attempt.createdAt,
          _attendanceAttempt: attempt,
        });
      }
    }
    records = [...records, ...pendingRows];

    // 6. Link each attendance record to underlying Gate Scan Logs (InOutLog)
    const targetStudentIds = records.map((r) => r.student_id?._id || r.student_id).filter(Boolean);
    const targetDates = Array.from(new Set(records.map((r) => r.date).filter(Boolean)));

    const gateLogs = await InOutLog.find({
      student_id: { $in: targetStudentIds },
      date: { $in: targetDates },
    })
      .sort({ timestamp: -1 })
      .lean();

    const gateLogMap = new Map();
    for (const gl of gateLogs) {
      const gKey = `${gl.student_id.toString()}:${gl.date}`;
      if (!gateLogMap.has(gKey)) {
        gateLogMap.set(gKey, gl);
      }
    }

    const mappedRecords = records.map((r) => {
      let verifiedByText = '—';
      if (r.status === 'present') {
        verifiedByText = r.verified_by?.name || (r.method === 'self_approved' ? 'Self-Approved' : 'Staff Override');
      } else if (r.status === 'on_leave') {
        verifiedByText = 'Hostel Office';
      }

      const st = r.student_id || {
        name: 'Student',
        rollNo: '—',
        hostel: r.hostel,
        roomNo: r.roomNo,
      };

      const gKey = `${(st._id || r.student_id || '').toString()}:${r.date}`;
      const matchedGate = gateLogMap.get(gKey);

      let gateEventText = '—';
      let gateEventObj = null;

      if (matchedGate) {
        const timeStr = matchedGate.in_time
          ? new Date(matchedGate.in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
          : matchedGate.out_time
          ? new Date(matchedGate.out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
          : (matchedGate.timestamp ? new Date(matchedGate.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '');

        const scanType = matchedGate.status === 'IN' || matchedGate.returned ? 'IN' : 'OUT';
        gateEventText = `${scanType}${timeStr ? ` at ${timeStr}` : ''}${matchedGate.place ? ` (${matchedGate.place})` : ''}`;
        gateEventObj = {
          id: matchedGate._id,
          scanType,
          status: matchedGate.status,
          time: timeStr,
          timestamp: matchedGate.timestamp,
          place: matchedGate.place || '',
          reason: matchedGate.reason || '',
          returned: Boolean(matchedGate.returned),
        };
      }

      const ts = getRecordTimestamp(r);
      const exactVerificationTime = formatRecordTime(ts);
      const attempt = r._attendanceAttempt || attemptByStudentDate.get(`${st._id || r.student_id}:${r.date}`);
      const latestAttempt = attempt?.attempts?.[attempt.attempts.length - 1] || null;

      return {
        id: r._id,
        date: r.date,
        session: r.session || 'Night Attendance',
        hostel: r.hostel,
        floor: r.floor,
        roomNo: r.roomNo,
        student: st,
        status: r.status,
        method: r.method,
        verifiedBy: verifiedByText,
        remark: r.remark,
        verificationTimestamp: ts,
        verificationTime: r.status === 'pending' ? null : exactVerificationTime,
        sessionStart: attempt?.session_start || null,
        expiresAt: attempt?.expires_at || null,
        attemptsUsed: attempt?.attemptsCount ?? r.attempt_count ?? 0,
        latestVerificationResult: latestAttempt?.reason || (r.status === 'pending' ? 'Not yet attempted' : r.remark || '—'),
        finalizationReason: r.status === 'pending' ? null : r.remark || null,
        gateEvent: gateEventText,
        gateEventDetails: gateEventObj,
        createdAt: r.createdAt,
      };
    });

    if (reqFormat === 'csv') {
      const csvHeader = [
        'Date',
        'Session',
        'Hostel',
        'Floor',
        'Room',
        'Roll No',
        'Student Name',
        'Status',
        'Method',
        'Verification Time',
        'Session Start',
        'Session Expires',
        'Checks Used',
        'Latest Verification Result',
        'Finalization Reason',
        'Gate Event',
        'Verified By',
        'Remark',
        'Recorded At',
      ].join(',');

      const csvRows = mappedRecords.map((r) => {
        const student = r.student || {};
        const safe = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
        return [
          safe(r.date),
          safe(r.session),
          safe(r.hostel),
          safe(r.floor),
          safe(r.roomNo),
          safe(student.rollNo),
          safe(student.name),
          safe(r.status ? r.status.toUpperCase() : 'ABSENT'),
          safe(r.method === 'self_approved' ? 'GPS Geofence' : (r.status === 'absent' ? 'Unverified' : (r.status === 'on_leave' ? 'Approved Leave' : 'Staff Override'))),
          safe(r.verificationTime || ''),
          safe(r.sessionStart ? new Date(r.sessionStart).toISOString() : ''),
          safe(r.expiresAt ? new Date(r.expiresAt).toISOString() : ''),
          safe(r.attemptsUsed ?? 0),
          safe(r.latestVerificationResult || ''),
          safe(r.finalizationReason || ''),
          safe(r.gateEvent || '—'),
          safe(r.verifiedBy),
          safe(r.remark || ''),
          safe(r.createdAt ? new Date(r.createdAt).toISOString() : ''),
        ].join(',');
      });

      const csvData = [csvHeader, ...csvRows].join('\n');
      const filename = `attendance_report_${startDate || 'all'}_${endDate || 'all'}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvData);
    }

    res.json({
      success: true,
      count: mappedRecords.length,
      records: mappedRecords,
    });
  } catch (err) {
    logger.error('[Attendance] Error generating report', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to generate attendance report' });
  }
});

module.exports = router;
