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
const {
  listPendingHomeVisitPasses,
  syncHomeVisitActiveQR,
  findHomeVisitByScanToken,
} = require('../services/homeVisitQrService');
const { PENDING_QR_LIST_LIMIT } = require('../config/campus');

const todayStr = () => new Date().toISOString().split('T')[0];
const SCAN_PHASE_GUARD_MS = parseInt(process.env.SCAN_PHASE_GUARD_MS || '8000', 10);

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
    (i) => i.qrType === 'home_visit' && (i.scanType === 'AWAITING WARDEN' || !i.token)
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
  const homeVisit = await findHomeVisitByScanToken(token);
  if (homeVisit) {
    return homeVisitPayloadFromRecord(homeVisit);
  }

  const usedHomeVisit = await HomeVisitLog.findOne({
    $or: [{ qr_token: token }, { qr_token: new RegExp(`^${String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
    qr_used_in: true,
  }).lean();
  if (usedHomeVisit) {
    return { error: 'QR code already fully used' };
  }

  const pendingHome = await HomeVisitLog.findOne({
    $or: [{ qr_token: token }, { qr_token: new RegExp(`^${String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
    overall_status: { $in: ['pending', 'parent_approved'] },
  }).lean();
  if (pendingHome) {
    return { error: 'Home visit not approved yet — warden must approve first' };
  }

  if (/^HV-/i.test(token) || /^eyJ/i.test(token)) {
    return { error: 'Home visit pass not found or expired — student should open View My Status for a fresh QR' };
  }

  const { valid, payload, error } = validateQR(token);
  if (valid && payload?.type === 'inout_request') {
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

const handleInOutScan = async (token, payload, req, scanStart) => {
  // Parallelize both pending lookups — they hit different indices
  const [byId, byToken] = await Promise.all([
    getPendingInOutRequest(payload.student_id),
    getPendingInOutRequestByToken(token),
  ]);
  const pendingRequest = byId || byToken;

  if (!pendingRequest || !tokensMatch(pendingRequest.token, token)) {
    return { status: 400, body: { success: false, message: 'Request not found or expired' } };
  }

  // Fetch student in parallel with the pending request resolution already done
  const student = await User.findById(payload.student_id).lean();
  if (!student) {
    return { status: 404, body: { success: false, message: 'Student not found' } };
  }

  const activeLog = await InOutLog.findOne({
    student_id: payload.student_id,
    date: todayStr(),
    returned: false,
  })
    .sort({ createdAt: -1 })
    .lean();

  const now = new Date();
  const scanType = pendingRequest.scanType;

  if (scanType === 'OUT') {
    if (activeLog) {
      return { status: 400, body: { success: false, message: 'Student is already marked OUT' } };
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
        place: pendingRequest.place || '',
        qr_token: token,
        status: 'OUT',
        out_time: now,
        in_time: null,
        timestamp: now,
        date: todayStr(),
        returned: false,
        scannedBy: req.user._id,
      });
    } catch (err) {
      if (err?.code === 11000) {
    return {
      status: 200,
      body: {
        success: true,
        message: 'Student already marked as OUT',
        kind: 'inout_request',
        student: {
          name: student.name,
          rollNumber: student.rollNo,
          hostel: student.hostel,
          studentPhone: student.phone || null,
          parentPhone: student.parentPhone || null,
        },
        log: { status: 'OUT', timestamp: now },
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
        student: {
          name: student.name,
          rollNumber: student.rollNo,
          hostel: student.hostel,
          studentPhone: student.phone || null,
          parentPhone: student.parentPhone || null,
        },
        log: {
          status: 'OUT',
          timestamp: log.timestamp,
          out_time: log.out_time,
          in_time: log.in_time,
          returned: log.returned,
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
        message: `Exit just recorded — move the QR away and retry in ${scanTooSoonIn}s when the student actually returns`,
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
      student: {
        name: student.name,
        rollNumber: student.rollNo,
        hostel: student.hostel,
        studentPhone: student.phone || null,
        parentPhone: student.parentPhone || null,
      },
      log: {
        status: 'IN',
        timestamp: log.timestamp,
        out_time: log.out_time,
        in_time: log.in_time,
        returned: log.returned,
      },
      scanDuration: Date.now() - scanStart,
    },
  };
};

const handleHomeVisitScan = async (token, payload, scanStart) => {
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
          message: `HOME OUT just recorded — move the QR away and retry in ${scanTooSoonIn}s when the student returns`,
        },
      };
    }
  }

  const activeToken = existing.qr_token || token;

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
        student: {
          name: student?.name || visit.name,
          rollNumber: student?.rollNo || visit.rollNo,
          hostel: student?.hostel || 'N/A',
          studentPhone: student?.phone || null,
          parentPhone: student?.parentPhone || null,
        },
        log: { status: 'HOME OUT', timestamp: now },
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
        student: {
          name: student?.name || visit.name,
          rollNumber: student?.rollNo || visit.rollNo,
          hostel: student?.hostel || 'N/A',
          studentPhone: student?.phone || null,
          parentPhone: student?.parentPhone || null,
        },
        log: { status: 'HOME IN', timestamp: now },
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

      if (payload.type === 'inout_request') {
        return handleInOutScan(token, payload, req, scanStart);
      }

      if (payload.type === 'home_visit') {
        return handleHomeVisitScan(token, payload, scanStart);
      }

      return { status: 400, body: { success: false, message: 'Unsupported QR type' } };
    });

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
