/**
 * Unified Gate Scanner Routes
 * - GET  /api/gatescan/pending-qrs - Combined pending list (daily requests + home visit QR)
 * - POST /api/gatescan/scan        - Scan token and dispatch by payload.type
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const {
  verifyDynamicPassToken,
  consumeDynamicTokenAtomic,
  cacheScanIdempotentResult,
} = require('../services/dynamicQrService');

const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const GatePass = require('../models/GatePass');
const {
  validateQR,
  normalizeScannedToken,
  getHomeVisitExpiresInSeconds,
  registerActiveQR,
  removeActiveQR,
} = require('../services/qrService');
const {
  recordPassOut,
  recordPassIn,
} = require('../services/gatePassService');
const {
  listPendingInOutRequests,
  getPendingInOutRequest,
  getPendingInOutRequestByToken,
  movePendingRequestToReturn,
  removePendingInOutRequest,
} = require('../services/inOutRequestService');
const { withScanLock } = require('../services/scanLockService');
const { invalidateLogsCache } = require('../services/logsCache');
const { broadcastScanResult } = require('../services/socketService');
const {
  listPendingHomeVisitPasses,
  syncHomeVisitActiveQR,
  findHomeVisitByScanToken,
} = require('../services/homeVisitQrService');
const { PENDING_QR_LIST_LIMIT } = require('../config/campus');

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// 30 seconds minimum cooldown between consecutive scans (e.g. OUT -> IN)
const SCAN_PHASE_GUARD_MS = parseInt(process.env.SCAN_PHASE_GUARD_MS || '30000', 10);

const parseListLimit = (raw) => {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return PENDING_QR_LIST_LIMIT;
  return Math.min(n, PENDING_QR_LIST_LIMIT);
};

const getPhaseGuardSecondsLeft = (value) => {
  if (!value) return 0;
  const scannedAt = new Date(value).getTime();
  if (!Number.isFinite(scannedAt)) return 0;

  const elapsed = Date.now() - scannedAt;
  if (elapsed < 0 || elapsed >= SCAN_PHASE_GUARD_MS) return 0;
  return Math.max(1, Math.ceil((SCAN_PHASE_GUARD_MS - elapsed) / 1000));
};

router.use(protect, authorize('warden', 'security'));

router.get('/pending-qrs', async (req, res) => {
  const limit = parseListLimit(req.query.limit);

  const [requests, homePasses] = await Promise.all([
    listPendingInOutRequests(limit),
    listPendingHomeVisitPasses(limit),
  ]);

  const seen = new Set();
  const merged = [];
  for (const item of [...homePasses, ...requests]) {
    const key = item.token || `${item.requestType}:${item.studentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  merged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const capped = merged.slice(0, limit);

  const dailyOut = capped.filter((i) => i.requestType === 'inout_request' && i.scanType === 'OUT').length;
  const dailyIn = capped.filter((i) => i.requestType === 'inout_request' && i.scanType === 'IN').length;
  const homeAwaiting = capped.filter(
    (i) => i.qrType === 'home_visit' && (['AWAITING WARDEN', 'AWAITING HOSTEL STAFF'].includes(i.scanType) || !i.token)
  ).length;
  const homeOut = capped.filter((i) => i.qrType === 'home_visit' && i.scanType === 'HOME OUT').length;
  const homeIn = capped.filter((i) => i.qrType === 'home_visit' && i.scanType === 'HOME IN').length;

  res.json({
    success: true,
    count: capped.length,
    limit,
    summary: {
      dailyOut,
      dailyIn,
      homeAwaiting,
      homeOut,
      homeIn,
      homeActive: homeAwaiting + homeOut + homeIn,
      total: capped.length,
    },
    qrs: capped,
  });
});

const homeVisitPayloadFromRecord = (visit) => ({
  payload: {
    type: 'home_visit',
    student_id: visit.student_id.toString(),
    visit_id: visit._id.toString(),
  },
});

/** Resolve compact HV-*, IO-*, JWT, or DB token into a scan payload */
const resolveScanPayload = async (token) => {
  // 1. Dynamic short-lived token (primary security path)
  const dynamicCheck = verifyDynamicPassToken(token);
  if (!dynamicCheck.valid) {
    return { error: dynamicCheck.error, code: dynamicCheck.code };
  }

  const { payload } = dynamicCheck;
  if (payload.type === 'dynamic_gate_pass') {
    return {
      payload: {
        type: payload.pass_kind === 'home_visit' ? 'home_visit' : 'inout_request',
        student_id: String(payload.sub || payload.student_id),
        pass_kind: payload.pass_kind,
        pass_id: payload.pass_id,
        visit_id: payload.pass_id,
        master_token: payload.master_token,
        scan_type: payload.scan_type,
        jti: payload.jti,
      },
      dynamicPayload: payload,
    };
  }

  // 2. Fallback for test/legacy signed JWTs
  return {
    payload: {
      ...payload,
      jti: payload.jti || crypto.randomUUID(),
    },
  };
};

const tokensMatch = (a, b) => String(a || '').trim() === String(b || '').trim();

const handleInOutScan = async (token, payload, req, scanStart, preloadedPendingRequest = null) => {
  const DAILY_PASS_VALIDITY_MS = 15 * 60 * 1000;

  let pendingRequest = preloadedPendingRequest;
  if (!pendingRequest) {
    pendingRequest = await getPendingInOutRequest(payload.student_id);
    if (!pendingRequest) {
      const gatePass = await GatePass.findOne({
        student_id: payload.student_id,
        status: { $in: ['PENDING', 'OUTSIDE'] },
      }).sort({ createdAt: -1 }).lean();

      if (gatePass) {
        // Enforce 15-minute expiration window for daily OUT gate passes
        if (gatePass.status === 'PENDING') {
          const createdAtTime = new Date(gatePass.createdAt || Date.now()).getTime();
          const validUntilTime = gatePass.valid_until
            ? new Date(gatePass.valid_until).getTime()
            : createdAtTime + DAILY_PASS_VALIDITY_MS;
          if (Date.now() > validUntilTime) {
            await GatePass.updateOne({ _id: gatePass._id }, { status: 'EXPIRED' }).catch(() => {});
            return {
              status: 400,
              body: {
                success: false,
                code: 'EXPIRED',
                message: 'Daily gate pass expired (valid for 15 minutes). Student must generate a new QR code to go out.',
              },
            };
          }
        }

        pendingRequest = {
          requestId: payload.student_id,
          requestType: 'inout_request',
          studentId: payload.student_id,
          scanType: gatePass.status === 'OUTSIDE' ? 'IN' : 'OUT',
          place: gatePass.place || '',
          reason: gatePass.reason || '',
          token: gatePass.qr_token,
          passId: gatePass._id.toString(),
          validUntil: gatePass.valid_until,
          createdAt: gatePass.createdAt,
        };
      }
    }
  }

  // If student is returning IN but has no pending in Redis, check unreturned log
  if (!pendingRequest) {
    const unreturned = await InOutLog.findOne({
      student_id: payload.student_id,
      status: 'OUT',
      returned: false,
    }).sort({ createdAt: -1 }).lean();

    if (unreturned) {
      pendingRequest = {
        requestId: payload.student_id,
        requestType: 'inout_request',
        studentId: payload.student_id,
        scanType: 'IN',
        place: unreturned.place || '',
        reason: unreturned.reason || '',
        token: unreturned.qr_token,
      };
    }
  }

  if (!pendingRequest) {
    return {
      status: 400,
      body: {
        success: false,
        code: 'INVALID',
        message: 'No active gate pass found for this student. Student must generate a pass from dashboard.',
      },
    };
  }

  // Enforce 15-minute expiration if pending request was loaded from Redis
  if (pendingRequest.scanType === 'OUT') {
    const createdAtTime = new Date(pendingRequest.createdAt || Date.now()).getTime();
    const validUntilTime = pendingRequest.validUntil || pendingRequest.expiresAt
      ? new Date(pendingRequest.validUntil || pendingRequest.expiresAt).getTime()
      : createdAtTime + DAILY_PASS_VALIDITY_MS;

    if (Date.now() > validUntilTime) {
      if (pendingRequest.passId) {
        await GatePass.updateOne({ _id: pendingRequest.passId }, { status: 'EXPIRED' }).catch(() => {});
      }
      return {
        status: 400,
        body: {
          success: false,
          code: 'EXPIRED',
          message: 'Daily gate pass expired (valid for 15 minutes). Student must generate a new QR code to go out.',
        },
      };
    }
  }

  // Fetch student and active log concurrently (survives midnight & multi-day absence)
  const [student, activeLog] = await Promise.all([
    User.findById(payload.student_id)
      .select('name rollNo email phone parentPhone hostel studentPhoto picture isActive')
      .lean(),
    InOutLog.findOne({
      student_id: payload.student_id,
      status: 'OUT',
      returned: false,
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  if (!student) {
    return { status: 404, body: { success: false, code: 'INVALID', message: 'Student not found' } };
  }
  if (student.isActive === false) {
    return { status: 403, body: { success: false, code: 'REVOKED', message: 'Student account has been deactivated / revoked' } };
  }

  const guardName = req.user?.name || req.user?.rollNo || req.user?.email || 'Security Guard';
  const effectiveStudentPhoto = student.studentPhoto || student.picture || '';

  const now = new Date();
  const scanType = pendingRequest.scanType || payload.scan_type || (activeLog ? 'IN' : 'OUT');

  if (scanType === 'OUT') {
    if (activeLog) {
      const scanTooSoon = getPhaseGuardSecondsLeft(activeLog?.out_time || activeLog?.timestamp);
      return {
        status: 409,
        body: {
          success: false,
          code: 'ALREADY_OUT',
          message: scanTooSoon
            ? `Exit just recorded. 30s cooldown active — wait ${scanTooSoon}s before scanning back IN.`
            : 'Student is already marked OUT',
          cooldownSecondsLeft: scanTooSoon || 0,
        },
      };
    }

    let log;
    try {
      log = await InOutLog.create({
        student_id: payload.student_id,
        name: student.name || '',
        rollNo: student.rollNo || '',
        email: student.email || '',
        phone: student.phone || '',
        parentPhone: student.parentPhone || '',
        hostel: student.hostel || '',
        student_photo: effectiveStudentPhoto,
        place: pendingRequest.place || '',
        reason: pendingRequest.reason || '',
        qr_token: token,
        status: 'OUT',
        out_time: now,
        in_time: null,
        timestamp: now,
        date: todayStr(),
        returned: false,
        scannedBy: req.user._id,
        scanned_by_name: guardName,
      });
    } catch (err) {
      if (err?.code === 11000) {
        const dupResponse = {
          success: true,
          code: 'VALID',
          message: 'Student already marked as OUT',
          kind: 'inout_request',
          guardInCharge: guardName,
          scannedByName: guardName,
          student: {
            id: String(student._id || payload.student_id),
            name: student.name,
            rollNumber: student.rollNo,
            hostel: student.hostel,
            studentPhone: student.phone || null,
            parentPhone: student.parentPhone || null,
            picture: effectiveStudentPhoto || null,
          },
          log: { status: 'OUT', timestamp: now, place: pendingRequest.place || '', reason: pendingRequest.reason || '' },
          scanDuration: Date.now() - scanStart,
        };
        if (payload.jti) await cacheScanIdempotentResult(payload.jti, dupResponse);
        return { status: 200, body: dupResponse };
      }
      throw err;
    }

    await recordPassOut(payload.pass_id || payload.master_token || token, req.user._id, guardName).catch(() => {});
    await movePendingRequestToReturn(pendingRequest).catch(() => {});

    const responseBody = {
      success: true,
      code: 'VALID',
      message: 'Student marked as OUT',
      kind: 'inout_request',
      guardInCharge: guardName,
      scannedByName: guardName,
      student: {
        id: String(student._id || payload.student_id),
        name: student.name,
        rollNumber: student.rollNo,
        hostel: student.hostel,
        studentPhone: student.phone || null,
        parentPhone: student.parentPhone || null,
        picture: effectiveStudentPhoto || null,
      },
      log: {
        status: 'OUT',
        timestamp: log.timestamp,
        out_time: log.out_time,
        in_time: log.in_time,
        returned: log.returned,
        place: log.place || '',
        reason: log.reason || '',
      },
      scanDuration: Date.now() - scanStart,
    };

    if (payload.jti) await cacheScanIdempotentResult(payload.jti, responseBody);
    return { status: 200, body: responseBody };
  }

  // ── IN scan ──
  const scanTooSoonIn = getPhaseGuardSecondsLeft(activeLog?.out_time || activeLog?.timestamp);
  if (scanTooSoonIn) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'COOLDOWN',
        message: `Exit was just recorded. 30s cooldown active — wait ${scanTooSoonIn}s before scanning back IN.`,
        cooldownSecondsLeft: scanTooSoonIn,
      },
    };
  }

  const log = await InOutLog.findOneAndUpdate(
    {
      student_id: payload.student_id,
      status: 'OUT',
      returned: false,
    },
    {
      $set: {
        status: 'IN',
        in_time: now,
        timestamp: now,
        returned: true,
        scannedBy: req.user._id,
        scanned_by_name: guardName,
      },
    },
    { new: true, sort: { createdAt: -1 }, runValidators: true }
  );

  if (!log) {
    const alreadyIn = await InOutLog.findOne({
      student_id: payload.student_id,
      date: todayStr(),
      returned: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (alreadyIn) {
      const alreadyInResponse = {
        success: true,
        code: 'VALID',
        message: 'Student already marked as IN',
        kind: 'inout_request',
        guardInCharge: guardName,
        scannedByName: guardName,
        student: {
          id: String(student._id || payload.student_id),
          name: student.name,
          rollNumber: student.rollNo,
          hostel: student.hostel,
          studentPhone: student.phone || null,
          parentPhone: student.parentPhone || null,
          picture: effectiveStudentPhoto || null,
        },
        log: {
          status: 'IN',
          timestamp: alreadyIn.timestamp,
          out_time: alreadyIn.out_time,
          in_time: alreadyIn.in_time,
          returned: true,
          place: alreadyIn.place || '',
          reason: alreadyIn.reason || '',
        },
        scanDuration: Date.now() - scanStart,
      };
      if (payload.jti) await cacheScanIdempotentResult(payload.jti, alreadyInResponse);
      return { status: 200, body: alreadyInResponse };
    }

    return { status: 400, body: { success: false, code: 'INVALID', message: 'No active OUT record found for this student' } };
  }

  await recordPassIn(payload.pass_id || payload.master_token || token, req.user._id, guardName).catch(() => {});
  await removePendingInOutRequest(payload.student_id).catch(() => {});

  const responseBody = {
    success: true,
    code: 'VALID',
    message: 'Student marked as IN',
    kind: 'inout_request',
    guardInCharge: guardName,
    scannedByName: guardName,
    student: {
      id: String(student._id || payload.student_id),
      name: student.name,
      rollNumber: student.rollNo,
      hostel: student.hostel,
      studentPhone: student.phone || null,
      parentPhone: student.parentPhone || null,
      picture: effectiveStudentPhoto || null,
    },
    log: {
      status: 'IN',
      timestamp: log.timestamp,
      out_time: log.out_time,
      in_time: log.in_time,
      returned: log.returned,
      place: log.place || '',
      reason: log.reason || '',
    },
    scanDuration: Date.now() - scanStart,
  };

  if (payload.jti) await cacheScanIdempotentResult(payload.jti, responseBody);
  return { status: 200, body: responseBody };
};

const handleHomeVisitScan = async (token, payload, req, scanStart) => {
  const visitId = payload.visit_id || payload.pass_id;
  const now = new Date();

  let existing = null;
  if (visitId && mongoose.isValidObjectId(visitId)) {
    existing = await HomeVisitLog.findById(visitId).populate('student_id');
  }
  if (!existing && payload.student_id) {
    existing = await HomeVisitLog.findOne({
      student_id: payload.student_id,
      overall_status: 'approved',
      qr_used_in: false,
    }).populate('student_id');
  }

  if (!existing || existing.overall_status !== 'approved') {
    return { status: 400, body: { success: false, code: 'INVALID', message: 'Visit not found or not approved' } };
  }
  if (existing.qr_used_in) {
    return { status: 400, body: { success: false, code: 'ALREADY_USED', message: 'QR code already fully used' } };
  }

  if (existing.qr_used_out && !existing.qr_used_in) {
    const scanTooSoonIn = getPhaseGuardSecondsLeft(existing.actual_out_time || existing.actual_out);
    if (scanTooSoonIn) {
      return {
        status: 409,
        body: {
          success: false,
          code: 'COOLDOWN',
          message: `HOME OUT was just recorded. 30s cooldown active — wait ${scanTooSoonIn}s before scanning HOME IN.`,
          cooldownSecondsLeft: scanTooSoonIn,
        },
      };
    }
  }

  const activeToken = existing.qr_token || token;
  const guardName = req.user.name || req.user.rollNo || req.user.email || 'Security Guard';

  let visit = await HomeVisitLog.findOneAndUpdate(
    {
      _id: existing._id,
      overall_status: 'approved',
      qr_used_out: false,
    },
    {
      $set: {
        qr_used_out: true,
        actual_out_time: now,
        actual_out: now,
        scannedBy: req.user._id,
        scanned_by_out: req.user._id,
        scanned_by_name: guardName,
        student_photo: existing.student_id?.studentPhoto || (existing.student_id?.picture && !existing.student_id.picture.includes('googleusercontent.com') ? existing.student_id.picture : null) || existing.student_photo || existing.student_id?.picture || null,
      },
    },
    { new: true }
  ).populate('student_id');

  if (visit) {
    const student = visit.student_id;
    await syncHomeVisitActiveQR(visit, activeToken);
    await GatePass.updateOne(
      { qr_token: activeToken },
      { $set: { status: 'OUTSIDE', out_time: now, scanned_by_out: req.user._id, scanned_by_name: guardName } }
    ).catch(() => {});

    const responseBody = {
      success: true,
      code: 'VALID',
      message: 'Marked as HOME OUT',
      kind: 'home_visit',
      guardInCharge: guardName,
      scannedByName: guardName,
      student: {
        id: String(student?._id || existing.student_id?._id || existing.student_id || payload.student_id),
        name: student?.name || visit.name,
        rollNumber: student?.rollNo || visit.rollNo,
        hostel: student?.hostel || 'N/A',
        studentPhone: student?.phone || null,
        parentPhone: student?.parentPhone || null,
        picture: student?.studentPhoto || (student?.picture && !student.picture.includes('googleusercontent.com') ? student.picture : null) || visit.student_photo || student?.picture || null,
      },
      log: { status: 'HOME OUT', timestamp: now, place: visit.place || '', reason: visit.reason || '' },
      scanDuration: Date.now() - scanStart,
    };

    if (payload.jti) await cacheScanIdempotentResult(payload.jti, responseBody);
    return { status: 200, body: responseBody };
  }

  visit = await HomeVisitLog.findOneAndUpdate(
    {
      _id: existing._id,
      overall_status: 'approved',
      qr_used_out: true,
      qr_used_in: false,
    },
    {
      $set: {
        qr_used_in: true,
        actual_in_time: now,
        actual_in: now,
        overall_status: 'completed',
        scannedBy: req.user._id,
        scanned_by_in: req.user._id,
        scanned_by_name: guardName,
        student_photo: existing.student_id?.studentPhoto || (existing.student_id?.picture && !existing.student_id.picture.includes('googleusercontent.com') ? existing.student_id.picture : null) || existing.student_photo || existing.student_id?.picture || null,
      },
    },
    { new: true }
  ).populate('student_id');

  if (visit) {
    const student = visit.student_id;
    await removeActiveQR(activeToken);
    await GatePass.updateOne(
      { qr_token: activeToken },
      { $set: { status: 'COMPLETED', in_time: now, completed_at: now, scanned_by_in: req.user._id, scanned_by_name: guardName } }
    ).catch(() => {});

    const responseBody = {
      success: true,
      code: 'VALID',
      message: 'Marked as HOME IN',
      kind: 'home_visit',
      guardInCharge: guardName,
      scannedByName: guardName,
      student: {
        id: String(student?._id || existing.student_id?._id || existing.student_id || payload.student_id),
        name: student?.name || visit.name,
        rollNumber: student?.rollNo || visit.rollNo,
        hostel: student?.hostel || 'N/A',
        studentPhone: student?.phone || null,
        parentPhone: student?.parentPhone || null,
        picture: student?.studentPhoto || (student?.picture && !student.picture.includes('googleusercontent.com') ? student.picture : null) || visit.student_photo || student?.picture || null,
      },
      log: { status: 'HOME IN', timestamp: now, place: visit.place || '', reason: visit.reason || '' },
      scanDuration: Date.now() - scanStart,
    };

    if (payload.jti) await cacheScanIdempotentResult(payload.jti, responseBody);
    return { status: 200, body: responseBody };
  }

  if (existing.qr_used_out && !existing.qr_used_in) {
    return {
      status: 400,
      body: { success: false, code: 'INVALID', message: 'Could not record HOME IN — try again' },
    };
  }

  return {
    status: 400,
    body: { success: false, code: 'INVALID', message: 'Scan HOME OUT first before HOME IN' },
  };
};

router.post('/scan', async (req, res) => {
  const scanStart = Date.now();
  try {
    const rawToken = req.body.token;
    if (!rawToken) return res.status(400).json({ success: false, code: 'INVALID', message: 'Token required' });

    const token = normalizeScannedToken(rawToken);
    if (!token) return res.status(400).json({ success: false, code: 'INVALID', message: 'Token required' });

    const result = await withScanLock(token, async () => {
      const resolved = await resolveScanPayload(token);
      if (resolved.error) {
        return {
          status: 400,
          body: {
            success: false,
            code: resolved.code || 'INVALID',
            message: resolved.error,
          },
        };
      }

      const { payload } = resolved;

      // Anti-replay check via atomic single-use nonce (jti)
      if (payload.jti) {
        const consumeCheck = await consumeDynamicTokenAtomic(payload.jti, payload);
        if (consumeCheck.status === 'IDEMPOTENT_REPLAY') {
          return { status: 200, body: consumeCheck.cachedResult };
        }
        if (consumeCheck.status === 'ALREADY_USED') {
          return {
            status: 409,
            body: {
              success: false,
              code: 'ALREADY_USED',
              message: consumeCheck.error || 'QR code already scanned. Replay rejected.',
            },
          };
        }
      }

      // Verify student identity & account state
      const studentId = payload.sub || payload.student_id;
      const student = await User.findById(studentId).lean();
      if (!student) {
        return { status: 404, body: { success: false, code: 'INVALID', message: 'Student not found' } };
      }
      if (student.isActive === false) {
        return { status: 403, body: { success: false, code: 'REVOKED', message: 'Student account has been deactivated / revoked' } };
      }

      if (payload.type === 'inout_request' || payload.type === 'inout') {
        return handleInOutScan(token, payload, req, scanStart, resolved.pendingRequest);
      }

      if (payload.type === 'home_visit') {
        return handleHomeVisitScan(token, payload, req, scanStart);
      }

      return { status: 400, body: { success: false, code: 'INVALID', message: 'Unsupported QR type' } };
    });

    if (result.status === 200 || result.body?.success) {
      invalidateLogsCache().catch(() => {});
      try {
        const studentId = result.body?.student?.id || result.body?.student?._id;
        const hostel = result.body?.student?.hostel || 'ALL';
        broadcastScanResult(result.body, studentId, hostel);
      } catch (err) {}
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ success: false, code: 'ALREADY_USED', message: error.message });
    }
    if (error.statusCode === 503) {
      return res.status(503).json({ success: false, code: 'SERVICE_UNAVAILABLE', message: error.message });
    }
    console.error('Unified scan error:', error);
    res.status(500).json({ success: false, code: 'SERVER_ERROR', message: error.message });
  }
});

module.exports = router;
