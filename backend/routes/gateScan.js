/**
 * Unified Gate Scanner Routes
 * - GET  /api/gatescan/pending-qrs - Combined pending list (daily requests + home visit QR)
 * - POST /api/gatescan/scan        - Scan token and dispatch by payload.type
 */
const express = require('express');
const router = express.Router();

const { protect, authorize } = require('../middleware/auth');
const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const {
  validateQR,
  normalizeScannedToken,
  getHomeVisitExpiresInSeconds,
  registerActiveQR,
  removeActiveQR,
} = require('../services/qrService');
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
  // 1. Ultra fast-path: Compact Daily In/Out Token (starts with IO-)
  if (/^IO-/i.test(token)) {
    const pendingCompact = await getPendingInOutRequestByToken(token);
    if (pendingCompact) {
      return {
        payload: { type: 'inout_request', student_id: String(pendingCompact.studentId) },
        pendingRequest: pendingCompact,
      };
    }
  }

  // 2. Ultra fast-path: Cryptographic Signed JWT (starts with eyJ)
  if (token.startsWith('eyJ')) {
    const { valid, payload, error } = validateQR(token);
    if (valid && (payload?.type === 'inout_request' || payload?.type === 'inout' || payload?.type === 'home_visit')) {
      return { payload };
    }
    if (error) {
      return { error };
    }
  }

  // 3. Ultra fast-path: Compact Home Visit Token (starts with HV-)
  if (/^HV-/i.test(token)) {
    const homeVisit = await findHomeVisitByScanToken(token);
    if (homeVisit) {
      return homeVisitPayloadFromRecord(homeVisit);
    }

    const usedHomeVisit = await HomeVisitLog.findOne({
      qr_token: token,
      qr_used_in: true,
    }).lean();
    if (usedHomeVisit) {
      return { error: 'QR code already fully used' };
    }

    const pendingHome = await HomeVisitLog.findOne({
      qr_token: token,
      overall_status: { $in: ['pending', 'parent_approved'] },
    }).lean();
    if (pendingHome) {
      return { error: 'Home visit not approved yet — hostel staff must approve first' };
    }

    return { error: 'Home visit pass not found or expired — student should open View My Status for a fresh QR' };
  }

  // 4. Fallback for untyped or legacy formats
  const homeVisit = await findHomeVisitByScanToken(token);
  if (homeVisit) {
    return homeVisitPayloadFromRecord(homeVisit);
  }

  const { valid, payload, error } = validateQR(token);
  if (valid && (payload?.type === 'inout_request' || payload?.type === 'inout')) {
    return { payload };
  }
  if (valid && payload?.type === 'home_visit') {
    return { payload };
  }

  const pendingCompact = await getPendingInOutRequestByToken(token);
  if (pendingCompact) {
    return {
      payload: { type: 'inout_request', student_id: String(pendingCompact.studentId) },
      pendingRequest: pendingCompact,
    };
  }

  return { error: error || 'Invalid or expired QR code' };
};

const tokensMatch = (a, b) => String(a || '').trim() === String(b || '').trim();

const handleInOutScan = async (token, payload, req, scanStart, preloadedPendingRequest = null) => {
  // Use preloaded pending request if already resolved to avoid redundant lookups
  let pendingRequest = preloadedPendingRequest;
  if (!pendingRequest) {
    const [byId, byToken] = await Promise.all([
      getPendingInOutRequest(payload.student_id),
      getPendingInOutRequestByToken(token),
    ]);
    pendingRequest = byId || byToken;
  }

  if (!pendingRequest || !tokensMatch(pendingRequest.token, token)) {
    return { status: 400, body: { success: false, message: 'Request not found or expired' } };
  }

  // Fetch student and active log concurrently in a single parallel roundtrip
  const [student, activeLog] = await Promise.all([
    User.findById(payload.student_id)
      .select('name rollNo email phone parentPhone hostel studentPhoto picture')
      .lean(),
    InOutLog.findOne({
      student_id: payload.student_id,
      date: todayStr(),
      returned: false,
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  if (!student) {
    return { status: 404, body: { success: false, message: 'Student not found' } };
  }

  const guardName = req.user?.name || req.user?.rollNo || req.user?.email || 'Security Guard';
  const effectiveStudentPhoto = student.studentPhoto || (student.picture && !student.picture.includes('googleusercontent.com') ? student.picture : null) || student.picture || '';

  const now = new Date();
  const scanType = pendingRequest.scanType;

  if (scanType === 'OUT') {
    if (activeLog) {
      const scanTooSoon = getPhaseGuardSecondsLeft(activeLog?.out_time || activeLog?.timestamp);
      return {
        status: 409,
        body: {
          success: false,
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
    return {
      status: 200,
      body: {
        success: true,
        message: 'Student already marked as OUT',
        kind: 'inout_request',
        guardInCharge: guardName,
        scannedByName: guardName,
        student: {
          name: student.name,
          rollNumber: student.rollNo,
          hostel: student.hostel,
          studentPhone: student.phone || null,
          parentPhone: student.parentPhone || null,
          picture: effectiveStudentPhoto || null,
        },
        log: { status: 'OUT', timestamp: now, place: pendingRequest.place || '', reason: pendingRequest.reason || '' },
        scanDuration: Date.now() - scanStart,
      },
    };
      }
      throw err;
    }

    await movePendingRequestToReturn(pendingRequest);

    return {
      status: 200,
      body: {
        success: true,
        message: 'Student marked as OUT',
        kind: 'inout_request',
        guardInCharge: guardName,
        scannedByName: guardName,
        student: {
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
      },
    };
  }

  const scanTooSoonIn = getPhaseGuardSecondsLeft(activeLog?.out_time || activeLog?.timestamp);
  if (scanTooSoonIn) {
    return {
      status: 409,
      body: {
        success: false,
        message: `Exit was just recorded. 30s cooldown active — wait ${scanTooSoonIn}s before scanning back IN.`,
        cooldownSecondsLeft: scanTooSoonIn,
      },
    };
  }

  const log = await InOutLog.findOneAndUpdate(
    {
      student_id: payload.student_id,
      date: todayStr(),
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
      const studentDoc = student;
    return {
      status: 200,
      body: {
        success: true,
        message: 'Student already marked as IN',
        kind: 'inout_request',
        guardInCharge: guardName,
        scannedByName: guardName,
        student: {
          name: studentDoc.name,
          rollNumber: studentDoc.rollNo,
          hostel: studentDoc.hostel,
          studentPhone: studentDoc.phone || null,
          parentPhone: studentDoc.parentPhone || null,
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
      },
    };
    }

    return { status: 400, body: { success: false, message: 'No active OUT record found for this student' } };
  }

  await removePendingInOutRequest(payload.student_id);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Student marked as IN',
      kind: 'inout_request',
      guardInCharge: guardName,
      scannedByName: guardName,
      student: {
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
    },
  };
};

const handleHomeVisitScan = async (token, payload, req, scanStart) => {
  const visitId = payload.visit_id;
  const now = new Date();

  const existing = await HomeVisitLog.findById(visitId).populate('student_id');
  if (!existing || existing.overall_status !== 'approved') {
    return { status: 400, body: { success: false, message: 'Visit not found or not approved' } };
  }
  if (existing.qr_used_in) {
    return { status: 400, body: { success: false, message: 'QR code already fully used' } };
  }

  if (existing.qr_used_out && !existing.qr_used_in) {
    const scanTooSoonIn = getPhaseGuardSecondsLeft(existing.actual_out_time || existing.actual_out);
    if (scanTooSoonIn) {
      return {
        status: 409,
        body: {
          success: false,
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
      _id: visitId,
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

    return {
      status: 200,
      body: {
        success: true,
        message: 'Marked as HOME OUT',
        kind: 'home_visit',
        guardInCharge: guardName,
        scannedByName: guardName,
        student: {
          name: student?.name || visit.name,
          rollNumber: student?.rollNo || visit.rollNo,
          hostel: student?.hostel || 'N/A',
          studentPhone: student?.phone || null,
          parentPhone: student?.parentPhone || null,
          picture: student?.studentPhoto || (student?.picture && !student.picture.includes('googleusercontent.com') ? student.picture : null) || visit.student_photo || student?.picture || null,
        },
        log: { status: 'HOME OUT', timestamp: now, place: visit.place || '', reason: visit.reason || '' },
        scanDuration: Date.now() - scanStart,
      },
    };
  }

  visit = await HomeVisitLog.findOneAndUpdate(
    {
      _id: visitId,
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

    return {
      status: 200,
      body: {
        success: true,
        message: 'Marked as HOME IN',
        kind: 'home_visit',
        guardInCharge: guardName,
        scannedByName: guardName,
        student: {
          name: student?.name || visit.name,
          rollNumber: student?.rollNo || visit.rollNo,
          hostel: student?.hostel || 'N/A',
          studentPhone: student?.phone || null,
          parentPhone: student?.parentPhone || null,
          picture: student?.studentPhoto || (student?.picture && !student.picture.includes('googleusercontent.com') ? student.picture : null) || visit.student_photo || student?.picture || null,
        },
        log: { status: 'HOME IN', timestamp: now, place: visit.place || '', reason: visit.reason || '' },
        scanDuration: Date.now() - scanStart,
      },
    };
  }

  if (existing.qr_used_out && !existing.qr_used_in) {
    return {
      status: 400,
      body: { success: false, message: 'Could not record HOME IN — try again' },
    };
  }

  return {
    status: 400,
    body: { success: false, message: 'Scan HOME OUT first before HOME IN' },
  };
};

router.post('/scan', async (req, res) => {
  const scanStart = Date.now();
  try {
    const rawToken = req.body.token;
    if (!rawToken) return res.status(400).json({ success: false, message: 'Token required' });

    const token = normalizeScannedToken(rawToken);
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    const result = await withScanLock(token, async () => {
      const resolved = await resolveScanPayload(token);
      if (resolved.error) {
        return { status: 400, body: { success: false, message: resolved.error } };
      }

      const { payload } = resolved;

      if (payload.type === 'inout_request' || payload.type === 'inout') {
        return handleInOutScan(token, payload, req, scanStart, resolved.pendingRequest);
      }

      if (payload.type === 'home_visit') {
        return handleHomeVisitScan(token, payload, req, scanStart);
      }

      return { status: 400, body: { success: false, message: 'Unsupported QR type' } };
    });

    if (result.status === 200 || result.body?.success) {
      invalidateLogsCache().catch(() => {});
      try {
        broadcastScanResult(result.body, result.body?.student?.hostel);
      } catch (err) {}
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error('Unified scan error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
