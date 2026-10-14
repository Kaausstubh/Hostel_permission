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
router.get('/hostels', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const hostels = await getHostelsAndFloors(req.user);
    res.json({ success: true, hostels });
  } catch (err) {
    logger.error('[Attendance] Error fetching hostels', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch hostels' });
  }
});

router.get('/hostels/:hostel/floors', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const allHostels = await getHostelsAndFloors(req.user);
    const target = allHostels.find((h) => h.hostel.toUpperCase() === req.params.hostel.toUpperCase());
    res.json({
      success: true,
      hostel: req.params.hostel.toUpperCase(),
      floors: target?.floors || ['1', '2', '3', '4'],
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching floors', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to fetch floors' });
  }
});

router.post('/rounds', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { hostel, floor, session_name } = req.body;
    if (!hostel || !floor) {
      return res.status(400).json({ success: false, message: 'Hostel and floor are required' });
    }

    const { round, resumed } = await startOrResumeRound({
      hostel,
      floor,
      session_name: 'Night Attendance',
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
router.get('/rounds/:id', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const round = await AttendanceRound.findById(req.params.id)
      .populate('staff_id', 'name email role')
      .lean();
    if (!round) return res.status(404).json({ success: false, message: 'Round not found' });
    res.json({ success: true, round });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/rounds/:id/rooms', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const data = await getRoundRoomsSummary(req.params.id);
    res.json({ success: true, ...data });
  } catch (err) {
    logger.error('[Attendance] Error fetching round rooms', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/rounds/:id/rooms/:roomNo/request', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const result = await requestRoomAttendance({
      roundId: req.params.id,
      roomNo: req.params.roomNo,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Attendance requested for room', ...result });
  } catch (err) {
    logger.error('[Attendance] Error requesting room attendance', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/requests/:id/resend', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const result = await resendRoomRequest({
      requestId: req.params.id,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Attendance request resent', ...result });
  } catch (err) {
    logger.error('[Attendance] Error resending request', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── 1-Click Request All Routes ───────────────────────────────────────────────
router.post('/rounds/:id/request-all', protect, authorize('warden', 'admin'), async (req, res) => {
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

router.post('/rounds/quick-request-all', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { hostel, floor, session_name } = req.body;
    if (!hostel || !floor) {
      return res.status(400).json({ success: false, message: 'Hostel and floor are required' });
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

router.post('/hostels/:hostel/request-all', protect, authorize('warden', 'admin'), async (req, res) => {
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

router.post('/rounds/:id/rooms/:roomNo/skip', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A mandatory skip reason is required',
        code: 'REASON_REQUIRED',
      });
    }

    const request = await skipRoom({
      roundId: req.params.id,
      roomNo: req.params.roomNo,
      reason,
      staffUser: req.user,
    });

    res.json({ success: true, message: 'Room marked as skipped', request });
  } catch (err) {
    logger.error('[Attendance] Error skipping room', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/rounds/:id/rooms/:roomNo/reopen', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const request = await reopenRoom({
      roundId: req.params.id,
      roomNo: req.params.roomNo,
      staffUser: req.user,
    });
    res.json({ success: true, message: 'Room reopened', request });
  } catch (err) {
    logger.error('[Attendance] Error reopening room', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── Staff: Screen 3 — Room Details & Manual Overrides ────────────────────────
router.get('/rounds/:id/rooms/:roomNo', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const details = await getRoomDetails(req.params.id, req.params.roomNo);
    res.json({ success: true, ...details });
  } catch (err) {
    logger.error('[Attendance] Error fetching room details', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/requests/:id/override', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { studentId, status, remark } = req.body;

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
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

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
router.post('/rounds/:id/complete', protect, authorize('warden', 'admin'), async (req, res) => {
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

    // 1. Check AttendanceRecord (the finalized ledger)
    const record = await AttendanceRecord.findOne({
      student_id: req.user._id,
      date: todayDate,
      session,
    }).populate('verified_by', 'name role').lean();

    if (record) {
      const isPresent = record.status === 'present';
      const isAbsent = record.status === 'absent';
      const displayStatus = isPresent ? 'PRESENT' : isAbsent ? 'ABSENT' : record.status.toUpperCase();
      const displayMethod = record.method === 'self_approved' ? 'Automatic' : 'Manual';
      const exactTime = formatRecordTime(record.verification_timestamp || record.createdAt || record.updatedAt);
      const exactDate = formatRecordDate(record.verification_timestamp || record.createdAt || record.updatedAt, record.date);

      return res.json({
        success: true,
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
        attemptsCount: record.attempt_count || 2,
        attemptsRemaining: 0,
        markedAt: record.verification_timestamp || record.createdAt || record.updatedAt,
      });
    }

    // 2. Not in AttendanceRecord -> check AttendanceAttempt for attempt count
    const attemptDoc = await AttendanceAttempt.findOne({
      student_id: req.user._id,
      date: todayDate,
      session,
    }).lean();

    const attemptsCount = attemptDoc ? attemptDoc.attemptsCount : 0;
    const attemptsRemaining = Math.max(0, 2 - attemptsCount);

    return res.json({
      success: true,
      isMarked: false,
      hostel: assignedHostel,
      hostelName: geofenceConfig.name,
      date: todayDate,
      formattedDate: formatRecordDate(now, todayDate),
      status: 'PENDING',
      displayStatus: 'Pending Verification',
      time: null,
      method: null,
      verification: attemptsCount > 0 ? 'Attempt 1 failed. 1 attempt remaining.' : 'Pending Verification',
      autoAttendanceEnabled: geofenceConfig.auto_attendance !== false,
      permittedRadiusMeters: geofenceConfig.radius_m,
      accuracyThresholdMeters: geofenceConfig.accuracy_threshold_m,
      confirmedByServer: true,
      attemptsCount,
      attemptsRemaining,
      message: attemptsCount > 0 ? 'Attempt 1 failed. 1 attempt remaining.' : 'Attendance has not yet been recorded for this session.',
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

// ── Student: One-Time / Two-Attempt Geofence Attendance Verification ───────────
async function handleStudentAutoVerify(req, res) {
  try {
    const student = req.user;
    if (!student.hostel) {
      return res.status(400).json({
        success: false,
        status: 'PENDING',
        code: 'NO_HOSTEL_ASSIGNED',
        message: 'No hostel assigned to your student profile. Please contact administration.',
      });
    }

    const assignedHostel = normalizeHostelCode(student.hostel);

    // Cross-Hostel Validation
    if (req.body.hostel) {
      const requestedHostel = normalizeHostelCode(req.body.hostel);
      if (requestedHostel !== assignedHostel) {
        return res.status(403).json({
          success: false,
          status: 'PENDING',
          code: 'CROSS_HOSTEL_FORBIDDEN',
          message: `You are assigned to ${student.hostel}. Attendance at ${req.body.hostel} is not permitted.`,
        });
      }
    }

    const geofenceConfig = await getHostelGeofenceConfig(assignedHostel);
    const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const now = new Date();
    const session = 'Night Attendance';

    // 1. Idempotency Check: Is attendance already finalized?
    const existingRecord = await AttendanceRecord.findOne({
      student_id: student._id,
      date: todayDate,
      session,
    }).lean();

    if (existingRecord) {
      const isPresent = existingRecord.status === 'present';
      const statusStr = isPresent ? 'PRESENT' : 'ABSENT';
      const exactTime = formatRecordTime(existingRecord.verification_timestamp || existingRecord.createdAt || existingRecord.updatedAt);
      const exactDate = formatRecordDate(existingRecord.verification_timestamp || existingRecord.createdAt || existingRecord.updatedAt, existingRecord.date);

      return res.status(200).json({
        success: true,
        alreadyMarked: true,
        isMarked: true,
        status: statusStr,
        code: 'ALREADY_FINALIZED',
        hostel: existingRecord.hostel || assignedHostel,
        hostelName: geofenceConfig.name,
        date: existingRecord.date,
        formattedDate: exactDate,
        time: exactTime,
        method: existingRecord.method === 'self_approved' ? 'Automatic' : 'Manual',
        verification: isPresent ? 'Successful' : (existingRecord.remark || 'Outside Geofence / Unconfirmed'),
        markedAt: existingRecord.verification_timestamp || existingRecord.createdAt || existingRecord.updatedAt,
        attemptsCount: existingRecord.attempt_count || 2,
        attemptsRemaining: 0,
        message: `Attendance is already finalized as ${statusStr}.`,
      });
    }

    // 2. Fetch or atomically initialize attempt document
    let attemptDoc = await AttendanceAttempt.findOne({
      student_id: student._id,
      date: todayDate,
      session,
    });

    if (!attemptDoc) {
      try {
        attemptDoc = await AttendanceAttempt.create({
          student_id: student._id,
          date: todayDate,
          session,
          hostel: assignedHostel,
          attemptsCount: 0,
          maxAttempts: 2,
          status: 'pending',
          attempts: [],
        });
      } catch (err) {
        attemptDoc = await AttendanceAttempt.findOne({
          student_id: student._id,
          date: todayDate,
          session,
        });
      }
    }

    // If attempt doc is already finalized or attempts exhausted
    if (attemptDoc && (attemptDoc.status !== 'pending' || attemptDoc.attemptsCount >= 2)) {
      let finalRecord = await AttendanceRecord.findOne({
        student_id: student._id,
        date: todayDate,
        session,
      });

      if (!finalRecord) {
        const fallbackStatus = attemptDoc.status === 'present' ? 'present' : 'absent';
        finalRecord = await AttendanceRecord.findOneAndUpdate(
          { student_id: student._id, date: todayDate, session },
          {
            $setOnInsert: {
              student_id: student._id,
              date: todayDate,
              session,
              hostel: assignedHostel,
              floor: student.floor || '',
              roomNo: student.roomNo || 'Assigned',
              status: fallbackStatus,
              method: 'self_approved',
              verified_by: student._id,
              attempt_count: 2,
              verification_timestamp: now,
              remark: `Marked ${fallbackStatus.toUpperCase()}: Verification finalized`,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      const isPresent = finalRecord.status === 'present';
      return res.status(200).json({
        success: true,
        alreadyMarked: true,
        isMarked: true,
        status: isPresent ? 'PRESENT' : 'ABSENT',
        code: 'ALREADY_FINALIZED',
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: formatRecordDate(finalRecord.verification_timestamp || finalRecord.createdAt || finalRecord.updatedAt, todayDate),
        time: formatRecordTime(finalRecord.verification_timestamp || finalRecord.createdAt || finalRecord.updatedAt),
        attemptsCount: attemptDoc.attemptsCount,
        attemptsRemaining: 0,
        message: `Attendance is already finalized as ${isPresent ? 'PRESENT' : 'ABSENT'}.`,
      });
    }

    // 3. Handle GPS fetch failure from client (permission denied, timeout, unavailable)
    const isFetchFailure = Boolean(req.body.fetchFailed || req.body.fetchError || req.body.gpsError);
    if (isFetchFailure) {
      attemptDoc.attemptsCount += 1;
      const attemptNum = attemptDoc.attemptsCount;
      const isFinalAttempt = attemptNum >= 2;
      const failureReason = req.body.reason || req.body.message || 'GPS location retrieval failed on device.';
      const failureCode = req.body.code || req.body.errorCode || 'GPS_FETCH_FAILED';

      attemptDoc.attempts.push({
        attemptNumber: attemptNum,
        timestamp: now,
        lat: null,
        lng: null,
        accuracy: null,
        distanceMeters: null,
        radiusMeters: geofenceConfig.radius_m,
        success: false,
        reason: failureReason,
        errorCode: failureCode,
      });

      if (!isFinalAttempt) {
        // Attempt 1 failed to fetch GPS. Allow attempt 2!
        attemptDoc.status = 'pending';
        await attemptDoc.save();

        return res.status(200).json({
          success: true,
          isMarked: false,
          status: 'PENDING',
          displayStatus: 'Pending Verification',
          attempt: 1,
          maxAttempts: 2,
          attemptsRemaining: 1,
          hostel: assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(now, todayDate),
          message: `${failureReason} (Attempt 1 of 2 failed. 1 attempt remaining).`,
        });
      } else {
        // Attempt 2 also failed to fetch GPS. Mark ABSENT!
        attemptDoc.status = 'absent';
        attemptDoc.finalizedAt = now;
        await attemptDoc.save();

        const absentRemark = `Marked ABSENT: GPS location fetch failed on 2 attempts (${failureReason})`;
        const absentRecord = await AttendanceRecord.findOneAndUpdate(
          { student_id: student._id, date: todayDate, session },
          {
            $set: {
              student_id: student._id,
              date: todayDate,
              session,
              hostel: assignedHostel,
              floor: student.floor || '',
              roomNo: student.roomNo || 'Assigned',
              status: 'absent',
              method: 'self_approved',
              verified_by: student._id,
              attempt_count: 2,
              verification_timestamp: now,
              remark: absentRemark,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await syncActiveRoomRound(student, assignedHostel, 'absent', absentRemark, null, null, null);
        emitSocketAttendance(student, assignedHostel, 'absent', absentRecord.createdAt || now);

        return res.status(200).json({
          success: true,
          isMarked: true,
          status: 'ABSENT',
          code: 'MARKED_ABSENT',
          attempt: 2,
          maxAttempts: 2,
          attemptsRemaining: 0,
          hostel: assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(absentRecord.createdAt || now, todayDate),
          time: formatRecordTime(absentRecord.createdAt || now),
          message: 'GPS location fetch failed on both attempts. Attendance finalized as ABSENT.',
        });
      }
    }

    // 4. Coordinates provided: Validate coordinate values
    const { lat, lng, accuracy, timestamp } = req.body;
    const numLat = Number(lat);
    const numLng = Number(lng);
    const numAccuracy = Number(accuracy);

    let coordinateError = null;
    let errorCode = null;

    if (
      typeof lat === 'undefined' ||
      typeof lng === 'undefined' ||
      isNaN(numLat) ||
      isNaN(numLng) ||
      !isFinite(numLat) ||
      !isFinite(numLng) ||
      numLat < -90 ||
      numLat > 90 ||
      numLng < -180 ||
      numLng > 180
    ) {
      coordinateError = 'Invalid GPS coordinates received from device.';
      errorCode = 'INVALID_COORDINATES';
    } else if (timestamp && typeof timestamp === 'number') {
      const ageSeconds = Math.abs(Date.now() - timestamp) / 1000;
      if (ageSeconds > 120) {
        coordinateError = 'GPS reading is stale. Please acquire a fresh location reading.';
        errorCode = 'STALE_COORDINATES';
      }
    }

    if (coordinateError) {
      // Treat invalid/stale coordinates as a failed fetch attempt
      attemptDoc.attemptsCount += 1;
      const attemptNum = attemptDoc.attemptsCount;
      const isFinalAttempt = attemptNum >= 2;

      attemptDoc.attempts.push({
        attemptNumber: attemptNum,
        timestamp: now,
        lat: isNaN(numLat) ? null : numLat,
        lng: isNaN(numLng) ? null : numLng,
        accuracy: isNaN(numAccuracy) ? null : numAccuracy,
        distanceMeters: null,
        radiusMeters: geofenceConfig.radius_m,
        success: false,
        reason: coordinateError,
        errorCode,
      });

      if (!isFinalAttempt) {
        attemptDoc.status = 'pending';
        await attemptDoc.save();
        return res.status(200).json({
          success: true,
          isMarked: false,
          status: 'PENDING',
          displayStatus: 'Pending Verification',
          attempt: 1,
          maxAttempts: 2,
          attemptsRemaining: 1,
          hostel: assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(now, todayDate),
          message: `${coordinateError} (Attempt 1 of 2 failed. 1 attempt remaining).`,
        });
      } else {
        attemptDoc.status = 'absent';
        attemptDoc.finalizedAt = now;
        await attemptDoc.save();

        const absentRemark = `Marked ABSENT: Verification failed after 2 attempts (${coordinateError})`;
        const absentRecord = await AttendanceRecord.findOneAndUpdate(
          { student_id: student._id, date: todayDate, session },
          {
            $set: {
              student_id: student._id,
              date: todayDate,
              session,
              hostel: assignedHostel,
              floor: student.floor || '',
              roomNo: student.roomNo || 'Assigned',
              status: 'absent',
              method: 'self_approved',
              verified_by: student._id,
              attempt_count: 2,
              verification_timestamp: now,
              remark: absentRemark,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await syncActiveRoomRound(student, assignedHostel, 'absent', absentRemark, null, null, null);
        emitSocketAttendance(student, assignedHostel, 'absent', absentRecord.createdAt || now);

        return res.status(200).json({
          success: true,
          isMarked: true,
          status: 'ABSENT',
          code: 'MARKED_ABSENT',
          attempt: 2,
          maxAttempts: 2,
          attemptsRemaining: 0,
          hostel: assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(absentRecord.createdAt || now, todayDate),
          time: formatRecordTime(absentRecord.createdAt || now),
          message: 'GPS verification failed on final attempt. Attendance recorded as ABSENT.',
        });
      }
    }

    // 5. Accuracy check
    const accuracyThreshold = geofenceConfig.accuracy_threshold_m ?? 25;
    if (typeof accuracy === 'number' && numAccuracy > accuracyThreshold) {
      attemptDoc.attemptsCount += 1;
      const attemptNum = attemptDoc.attemptsCount;
      const isFinalAttempt = attemptNum >= 2;
      const accReason = `Location accuracy (±${Math.round(numAccuracy)}m) exceeds threshold (±${accuracyThreshold}m).`;

      attemptDoc.attempts.push({
        attemptNumber: attemptNum,
        timestamp: now,
        lat: numLat,
        lng: numLng,
        accuracy: numAccuracy,
        distanceMeters: null,
        radiusMeters: geofenceConfig.radius_m,
        success: false,
        reason: accReason,
        errorCode: 'LOW_GPS_ACCURACY',
      });

      if (!isFinalAttempt) {
        attemptDoc.status = 'pending';
        await attemptDoc.save();
        return res.status(200).json({
          success: true,
          isMarked: false,
          status: 'PENDING',
          displayStatus: 'Pending Verification',
          attempt: 1,
          maxAttempts: 2,
          attemptsRemaining: 1,
          hostel: assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(now, todayDate),
          message: `${accReason} Move near a window or open area and try again. (1 attempt remaining).`,
        });
      } else {
        attemptDoc.status = 'absent';
        attemptDoc.finalizedAt = now;
        await attemptDoc.save();

        const absentRemark = `Marked ABSENT: Low GPS accuracy on both attempts (${accReason})`;
        const absentRecord = await AttendanceRecord.findOneAndUpdate(
          { student_id: student._id, date: todayDate, session },
          {
            $set: {
              student_id: student._id,
              date: todayDate,
              session,
              hostel: assignedHostel,
              floor: student.floor || '',
              roomNo: student.roomNo || 'Assigned',
              status: 'absent',
              method: 'self_approved',
              verified_by: student._id,
              attempt_count: 2,
              verification_timestamp: now,
              remark: absentRemark,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await syncActiveRoomRound(student, assignedHostel, 'absent', absentRemark, numLat, numLng, numAccuracy);
        emitSocketAttendance(student, assignedHostel, 'absent', absentRecord.createdAt || now);

        return res.status(200).json({
          success: true,
          isMarked: true,
          status: 'ABSENT',
          code: 'MARKED_ABSENT',
          attempt: 2,
          maxAttempts: 2,
          attemptsRemaining: 0,
          hostel: assignedHostel,
          hostelName: geofenceConfig.name,
          date: todayDate,
          formattedDate: formatRecordDate(absentRecord.createdAt || now, todayDate),
          time: formatRecordTime(absentRecord.createdAt || now),
          message: 'GPS accuracy failed on final attempt. Attendance recorded as ABSENT.',
        });
      }
    }

    // 6. Geofence evaluation using Haversine formula against assigned hostel
    const geoResult = await verifyHostelGeofence(assignedHostel, {
      lat: numLat,
      lng: numLng,
      accuracy: numAccuracy || 10,
    });

    attemptDoc.attemptsCount += 1;
    const attemptNum = attemptDoc.attemptsCount;

    if (geoResult.valid) {
      // INSIDE GEOFENCE -> Mark PRESENT immediately!
      attemptDoc.status = 'present';
      attemptDoc.finalizedAt = now;
      attemptDoc.attempts.push({
        attemptNumber: attemptNum,
        timestamp: now,
        lat: numLat,
        lng: numLng,
        accuracy: numAccuracy,
        distanceMeters: geoResult.distanceToCenterMeters,
        radiusMeters: geoResult.radiusMeters,
        success: true,
        reason: `Verified inside ${geofenceConfig.name}`,
        errorCode: null,
      });
      await attemptDoc.save();

      const remark = `Automatic geofence verification inside ${geofenceConfig.name} (${Math.round(geoResult.distanceToCenterMeters)}m from center, accuracy ±${Math.round(numAccuracy || 10)}m)`;

      const record = await AttendanceRecord.findOneAndUpdate(
        { student_id: student._id, date: todayDate, session },
        {
          $set: {
            student_id: student._id,
            date: todayDate,
            session,
            hostel: assignedHostel,
            floor: student.floor || '',
            roomNo: student.roomNo || 'Assigned',
            status: 'present',
            method: 'self_approved',
            verified_by: student._id,
            attempt_count: attemptNum,
            verification_timestamp: now,
            remark,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await syncActiveRoomRound(student, assignedHostel, 'approved', remark, numLat, numLng, numAccuracy);
      emitSocketAttendance(student, assignedHostel, 'present', record.createdAt || now);

      const exactTime = formatRecordTime(record.verification_timestamp || record.createdAt || record.updatedAt || now);
      const exactDate = formatRecordDate(record.verification_timestamp || record.createdAt || record.updatedAt || now, todayDate);

      // Audit log
      await AttendanceAuditLog.create({
        actor_id: student._id,
        actor_role: student.role,
        actor_name: student.name,
        action: 'AUTO_ATTENDANCE_MARKED',
        entity: 'AttendanceRecord',
        entity_id: record._id.toString(),
        old_value: null,
        new_value: {
          hostel: assignedHostel,
          status: 'present',
          method: 'self_approved',
          distanceMeters: geoResult.distanceToCenterMeters,
          accuracy: numAccuracy,
          attempt: attemptNum,
        },
        reason: remark,
      }).catch((err) => logger.warn('[AuditLog] Warning: ' + err.message));

      return res.status(200).json({
        success: true,
        isMarked: true,
        status: 'PRESENT',
        code: 'MARKED_PRESENT',
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: exactDate,
        time: exactTime,
        attempt: attemptNum,
        maxAttempts: 2,
        attemptsRemaining: 0,
        distanceMeters: Math.round(geoResult.distanceToCenterMeters),
        permittedRadius: geoResult.radiusMeters,
        method: 'Automatic',
        verification: 'Successful',
        message: `Verified inside ${geofenceConfig.name}! Attendance marked PRESENT.`,
      });
    } else {
      // OUTSIDE GEOFENCE -> Mark ABSENT immediately!
      const distAway = Math.round(geoResult.distanceToCenterMeters || 0);
      attemptDoc.status = 'absent';
      attemptDoc.finalizedAt = now;
      attemptDoc.attempts.push({
        attemptNumber: attemptNum,
        timestamp: now,
        lat: numLat,
        lng: numLng,
        accuracy: numAccuracy,
        distanceMeters: geoResult.distanceToCenterMeters,
        radiusMeters: geoResult.radiusMeters,
        success: false,
        reason: `Outside ${geofenceConfig.name} boundary (${distAway}m away, permitted radius: ${geoResult.radiusMeters}m)`,
        errorCode: 'OUTSIDE_GEOFENCE',
      });
      await attemptDoc.save();

      const absentRemark = `Marked ABSENT: Outside ${geofenceConfig.name} boundary (${distAway}m from center, permitted radius: ${geoResult.radiusMeters}m)`;

      const record = await AttendanceRecord.findOneAndUpdate(
        { student_id: student._id, date: todayDate, session },
        {
          $set: {
            student_id: student._id,
            date: todayDate,
            session,
            hostel: assignedHostel,
            floor: student.floor || '',
            roomNo: student.roomNo || 'Assigned',
            status: 'absent',
            method: 'self_approved',
            verified_by: student._id,
            attempt_count: attemptNum,
            verification_timestamp: now,
            remark: absentRemark,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await syncActiveRoomRound(student, assignedHostel, 'absent', absentRemark, numLat, numLng, numAccuracy);
      emitSocketAttendance(student, assignedHostel, 'absent', record.createdAt || now);

      const exactTime = formatRecordTime(record.verification_timestamp || record.createdAt || record.updatedAt || now);
      const exactDate = formatRecordDate(record.verification_timestamp || record.createdAt || record.updatedAt || now, todayDate);

      // Audit log
      await AttendanceAuditLog.create({
        actor_id: student._id,
        actor_role: student.role,
        actor_name: student.name,
        action: 'AUTO_ATTENDANCE_MARKED',
        entity: 'AttendanceRecord',
        entity_id: record._id.toString(),
        old_value: null,
        new_value: {
          hostel: assignedHostel,
          status: 'absent',
          method: 'self_approved',
          distanceMeters: distAway,
          accuracy: numAccuracy,
          attempt: attemptNum,
        },
        reason: absentRemark,
      }).catch((err) => logger.warn('[AuditLog] Warning: ' + err.message));

      return res.status(200).json({
        success: true,
        isMarked: true,
        status: 'ABSENT',
        code: 'MARKED_ABSENT',
        hostel: assignedHostel,
        hostelName: geofenceConfig.name,
        date: todayDate,
        formattedDate: exactDate,
        time: exactTime,
        attempt: attemptNum,
        maxAttempts: 2,
        attemptsRemaining: 0,
        distanceMeters: distAway,
        permittedRadius: geoResult.radiusMeters,
        method: 'Automatic',
        verification: 'Outside Hostel Boundary',
        message: `You are outside ${geofenceConfig.name} boundary (${distAway}m away, permitted radius: ${geoResult.radiusMeters}m). Attendance marked ABSENT.`,
      });
    }
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

// ── Student: Submit Biometric & Geofence Approval ─────────────────────────────
router.post('/requests/:requestId/approve', protect, authorize('student'), async (req, res) => {
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

    const request = await RoomAttendanceRequest.findById(req.params.requestId);

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
            floor: request.floor || '',
            roomNo: request.roomNo,
            status: 'present',
            method: 'self_approved',
            verified_by: req.user._id,
            remark: remarkText,
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
    const records = await AttendanceRecord.find({ student_id: req.user._id })
      .populate('verified_by', 'name role')
      .sort({ date: -1, createdAt: -1 })
      .limit(60)
      .lean();

    res.json({
      success: true,
      count: records.length,
      records: records.map((r) => ({
        id: r._id,
        date: r.date,
        formattedDate: formatRecordDate(r.createdAt || r.updatedAt, r.date),
        time: formatRecordTime(r.createdAt || r.updatedAt),
        markedAt: r.createdAt || r.updatedAt,
        session: r.session,
        hostel: r.hostel,
        roomNo: r.roomNo,
        status: r.status,
        method: r.method,
        remark: r.remark,
        verifiedBy: r.verified_by?.name || (r.method === 'self_approved' ? 'Self (GPS Geofence)' : 'Staff Verified'),
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    logger.error('[Attendance] Error fetching student history', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to load attendance history' });
  }
});

// ── Security & Staff: Read-Only Daily Attendance Summary ────────────────────
router.get('/summary', protect, authorize('warden', 'security', 'admin'), async (req, res) => {
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
router.get('/reports', protect, authorize('warden', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate, hostel, floor, status, format: reqFormat } = req.query;

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

    if (floor && floor.toUpperCase() !== 'ALL') {
      const cleanFloor = String(floor).trim();
      const escaped = cleanFloor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.floor = { $regex: escaped, $options: 'i' };
    }

    if (status && status.toLowerCase() !== 'all') {
      query.status = status.toLowerCase();
    }

    const records = await AttendanceRecord.find(query)
      .populate('student_id', 'name rollNo email phone hostel roomNo')
      .populate('verified_by', 'name role')
      .sort({ date: -1, hostel: 1, floor: 1, roomNo: 1 })
      .lean();

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
        'Verified By',
        'Remark',
        'Recorded At',
      ].join(',');

      const csvRows = records.map((r) => {
        const student = r.student_id || {};
        const safe = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
        return [
          safe(r.date),
          safe(r.session),
          safe(r.hostel),
          safe(r.floor),
          safe(r.roomNo),
          safe(student.rollNo),
          safe(student.name),
          safe(r.status),
          safe(r.method),
          safe(r.verified_by?.name || 'Self-Approved'),
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
      count: records.length,
      records: records.map((r) => ({
        id: r._id,
        date: r.date,
        session: r.session,
        hostel: r.hostel,
        floor: r.floor,
        roomNo: r.roomNo,
        student: r.student_id,
        status: r.status,
        method: r.method,
        verifiedBy: r.verified_by?.name || 'Self-Approved',
        remark: r.remark,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    logger.error('[Attendance] Error generating report', { error: err.message });
    res.status(500).json({ success: false, message: 'Failed to generate attendance report' });
  }
});

module.exports = router;

