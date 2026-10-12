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
const AttendanceAuditLog = require('../models/AttendanceAuditLog');
const User = require('../models/User');
const RoomAllocation = require('../models/RoomAllocation');

const {
  registerStudentDevice,
  approveStudentDevice,
} = require('../services/deviceService');
const {
  verifyHostelGeofence,
} = require('../services/geofenceService');
const {
  getHostelsAndFloors,
  startOrResumeRound,
  getRoundRoomsSummary,
  getRoomDetails,
  requestRoomAttendance,
  resendRoomRequest,
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
    const { polygon, buffer_m, accuracy_threshold_m, active, name } = req.body;

    if (!Array.isArray(polygon) || polygon.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Polygon must contain at least 3 vertices with {lat, lng}',
      });
    }

    const updated = await HostelGeofence.findOneAndUpdate(
      { hostel: hostel.toUpperCase() },
      {
        hostel: hostel.toUpperCase(),
        name: name || `${hostel.toUpperCase()} Hostel`,
        polygon,
        buffer_m: buffer_m ?? 25,
        accuracy_threshold_m: accuracy_threshold_m ?? 50,
        active: active !== undefined ? active : true,
        updated_by: req.user._id,
      },
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
      new_value: { hostel: updated.hostel, buffer_m: updated.buffer_m, vertices: polygon.length },
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

// ── Student: Pending Attendance Request Check ────────────────────────────────
router.get('/pending', protect, authorize('student'), async (req, res) => {
  try {
    if (!req.user.hostel || !req.user.roomNo) {
      return res.json({ success: true, hasPending: false, reason: 'NO_ROOM_ALLOCATED' });
    }

    const cleanHostel = req.user.hostel.toUpperCase();
    const cleanRoomNo = req.user.roomNo.trim().toUpperCase();
    const now = new Date();
    const todayDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    const todayRecord = await AttendanceRecord.findOne({
      student_id: req.user._id,
      date: todayDate,
    }).populate('verified_by', 'name role').lean();

    const request = await RoomAttendanceRequest.findOne({
      hostel: cleanHostel,
      roomNo: cleanRoomNo,
      status: 'open',
      expires_at: { $gt: now },
    })
      .populate('round_id', 'date session_name hostel floor')
      .lean();

    if (!request) {
      return res.json({
        success: true,
        hasPending: false,
        todayRecord: todayRecord ? {
          id: todayRecord._id,
          status: todayRecord.status,
          date: todayRecord.date,
          session: todayRecord.session,
          roomNo: todayRecord.roomNo,
          method: todayRecord.method,
          remark: todayRecord.remark,
          verifiedBy: todayRecord.verified_by?.name || 'Self (GPS Geofence)',
        } : null,
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
      todayRecord: todayRecord ? {
        id: todayRecord._id,
        status: todayRecord.status,
        date: todayRecord.date,
        session: todayRecord.session,
        roomNo: todayRecord.roomNo,
        method: todayRecord.method,
        remark: todayRecord.remark,
        verifiedBy: todayRecord.verified_by?.name || 'Self (GPS Geofence)',
      } : null,
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

    // Check 5: GPS Geofence Verification (no biometric/fingerprint required)
    const hasCoords = typeof gps_lat === 'number' && typeof gps_lng === 'number' && !isNaN(gps_lat) && !isNaN(gps_lng);
    let geoResult = null;
    if (hasCoords) {
      geoResult = await verifyHostelGeofence(request.hostel, {
        lat: Number(gps_lat),
        lng: Number(gps_lng),
        accuracy: Number(gps_accuracy || 10),
      });
    }

    const isInsideGeofence = Boolean(hasCoords && geoResult && geoResult.valid);
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const { getIO } = require('../services/socketService');
    const io = getIO();

    if (isInsideGeofence) {
      // ── INSIDE GEOFENCE: MARK PRESENT (APPROVED) ──
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
            remark: `Detected inside hostel geofence (Accuracy ±${Math.round(gps_accuracy || 10)}m)`,
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

      logger.info('[Attendance] Student verified inside geofence -> PRESENT', {
        studentId: req.user._id,
        roomNo: request.roomNo,
        hostel: request.hostel,
      });

      return res.json({
        success: true,
        status: 'present',
        code: 'PRESENT',
        message: 'Verified inside hostel geofence! Attendance marked PRESENT.',
        accuracy: Math.round(gps_accuracy || 10),
        approvedAt: now.toISOString(),
      });
    } else {
      // ── OUTSIDE GEOFENCE OR NO COORDS: MARK ABSENT ──
      const distanceAway = Math.round(geoResult?.distanceToEdgeMeters || 0);
      const reasonMsg = hasCoords
        ? `Device is outside hostel geofence boundary${distanceAway > 0 ? ` (${distanceAway}m away)` : ''}`
        : 'GPS location not available';

      if (!resp) {
        resp = await RequestResponse.create({
          request_id: request._id,
          student_id: req.user._id,
          allocation_id: activeAlloc?._id || undefined,
          status: 'absent',
          gps_lat: hasCoords ? Number(gps_lat) : null,
          gps_lng: hasCoords ? Number(gps_lng) : null,
          gps_accuracy: hasCoords ? Number(gps_accuracy) : null,
          inside_geofence: false,
          flags: [hasCoords ? 'OUTSIDE_GEOFENCE' : 'NO_LOCATION'],
          remark: reasonMsg,
        });
      } else {
        resp.status = 'absent';
        if (activeAlloc?._id) resp.allocation_id = activeAlloc._id;
        if (hasCoords) {
          resp.gps_lat = Number(gps_lat);
          resp.gps_lng = Number(gps_lng);
          resp.gps_accuracy = Number(gps_accuracy);
        }
        resp.inside_geofence = false;
        if (!resp.flags.includes(hasCoords ? 'OUTSIDE_GEOFENCE' : 'NO_LOCATION')) {
          resp.flags.push(hasCoords ? 'OUTSIDE_GEOFENCE' : 'NO_LOCATION');
        }
        resp.remark = reasonMsg;
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
            status: 'absent',
            method: 'self_approved',
            verified_by: req.user._id,
            remark: reasonMsg,
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
          status: 'absent',
          timestamp: now.toISOString(),
        });
      }

      logger.info('[Attendance] Student outside geofence / no coords -> ABSENT', {
        studentId: req.user._id,
        roomNo: request.roomNo,
        hostel: request.hostel,
        distanceAway,
      });

      return res.json({
        success: true,
        status: 'absent',
        code: hasCoords ? 'OUTSIDE_GEOFENCE' : 'NO_LOCATION',
        message: `${reasonMsg}. Attendance marked ABSENT.`,
        distanceMeters: distanceAway,
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
        session: r.session,
        hostel: r.hostel,
        roomNo: r.roomNo,
        status: r.status,
        method: r.method,
        remark: r.remark,
        verifiedBy: r.verified_by?.name || 'Automated Self-Approval',
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
      studentFilter.hostel = cleanHostel;
      recordFilter.hostel = cleanHostel;
      roundFilter.hostel = cleanHostel;
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
      query.hostel = hostel.toUpperCase();
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

