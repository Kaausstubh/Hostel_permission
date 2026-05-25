/**
 * Home visit gate passes — MongoDB is source of truth for pending panel + scans.
 * QR payload is a short HV-* token (easy to scan from phone screens), not a long JWT.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const HomeVisitLog = require('../models/HomeVisitLog');
const {
  registerActiveQR,
  getHomeVisitExpiresInSeconds,
  renderQRValue,
} = require('./qrService');

const todayStr = () => new Date().toISOString().split('T')[0];

const isLegacyHomeJwtToken = (token) =>
  typeof token === 'string' && /^eyJ[A-Za-z0-9_-]+\./.test(token);

const createHomeVisitCompactToken = () =>
  `HV-${crypto.randomBytes(8).toString('base64url')}`;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resolve approved home visit from scanned text (HV-*, legacy JWT, DB token). */
const findHomeVisitByScanToken = async (token) => {
  const trimmed = String(token || '').trim();
  if (!trimmed) return null;

  const approvedFilter = {
    overall_status: 'approved',
    qr_used_in: false,
  };

  if (/^HV-/i.test(trimmed)) {
    const compact = `HV-${trimmed.slice(3)}`;
    let visit = await HomeVisitLog.findOne({ ...approvedFilter, qr_token: compact }).lean();
    if (!visit) {
      visit = await HomeVisitLog.findOne({
        ...approvedFilter,
        qr_token: new RegExp(`^${escapeRegex(compact)}$`, 'i'),
      }).lean();
    }
    if (visit) return visit;

    if (compact.length >= 10) {
      visit = await HomeVisitLog.findOne({
        ...approvedFilter,
        qr_token: new RegExp(`^${escapeRegex(compact.slice(0, 10))}`, 'i'),
      }).lean();
      if (visit) return visit;
    }
  }

  let visit = await HomeVisitLog.findOne({ ...approvedFilter, qr_token: trimmed }).lean();
  if (!visit) {
    visit = await HomeVisitLog.findOne({
      ...approvedFilter,
      qr_token: new RegExp(`^${escapeRegex(trimmed)}$`, 'i'),
    }).lean();
  }
  if (visit) return visit;

  try {
    const decoded = jwt.decode(trimmed);
    if (decoded?.type === 'home_visit' && decoded.visit_id) {
      visit = await HomeVisitLog.findOne({
        _id: decoded.visit_id,
        ...approvedFilter,
      }).lean();
      if (visit) return visit;
    }
  } catch {
    // ignore
  }

  return null;
};

const buildPassMeta = (visit, token, extra = {}) => {
  const student = visit.student_id;
  const studentId = student?._id?.toString() || String(visit.student_id);
  return {
    token: token || null,
    qrType: 'home_visit',
    requestType: 'home_visit',
    studentId,
    studentName: student?.name || visit.name || 'Student',
    rollNumber: student?.rollNo || visit.rollNo || 'N/A',
    hostel: student?.hostel || 'N/A',
    studentPhone: student?.phone || visit.phone || '',
    parentPhone: student?.parentPhone || visit.parent_phone || '',
    scanType: extra.scanType || (visit.qr_used_out ? 'HOME IN' : 'HOME OUT'),
    createdAt: visit.updatedAt || visit.createdAt,
    leaveDate: visit.leave_date,
    returnDate: visit.return_date,
    scannable: extra.scannable !== false && Boolean(token),
    statusNote: extra.statusNote || '',
    overallStatus: visit.overall_status,
    ...extra,
  };
};

/** Keep Redis/memory active list in sync with an approved visit */
const syncHomeVisitActiveQR = async (visit, token) => {
  if (!token || visit.overall_status !== 'approved' || visit.qr_used_in) return;
  const ttl = getHomeVisitExpiresInSeconds(visit.return_date);
  const meta = buildPassMeta(visit, token);
  await registerActiveQR(token, meta, ttl);
};

/**
 * Issue or refresh a scannable home-visit QR (short HV-* string in the image).
 * Migrates legacy JWT qr_token to compact automatically.
 */
const issueHomeVisitGatePass = async (visit) => {
  if (visit.overall_status !== 'approved' || visit.qr_used_in) {
    throw new Error('Visit not approved or pass already closed');
  }

  let token = visit.qr_token;
  if (!token || isLegacyHomeJwtToken(token)) {
    token = createHomeVisitCompactToken();
  }

  const visitId = visit._id.toString();
  const { qrDataUrl, qrPublicUrl, qrFilename } = await renderQRValue(token, `hv_${visitId}`, {
    errorCorrectionLevel: 'L',
    width: 360,
    margin: 2,
  });

  await HomeVisitLog.updateOne({ _id: visit._id }, { qr_token: token });
  const withToken = { ...visit, qr_token: token };
  await syncHomeVisitActiveQR(withToken, token);

  return { token, qrDataUrl, qrPublicUrl, qrFilename };
};

/** Create QR if warden approved but token missing (legacy / failed generation) */
const ensureHomeVisitQrToken = async (visit) => {
  if (visit.overall_status !== 'approved' || visit.qr_used_in) return null;

  if (visit.qr_token && !isLegacyHomeJwtToken(visit.qr_token)) {
    await syncHomeVisitActiveQR(visit, visit.qr_token);
    return visit.qr_token;
  }

  const { token } = await issueHomeVisitGatePass(visit);
  return token;
};

/**
 * All home visits security should see: awaiting warden + scannable approved passes.
 */
const listPendingHomeVisitPasses = async (limit = 500) => {
  const today = todayStr();
  const cap = Math.min(Math.max(limit, 1), 500);
  const items = [];

  const awaiting = await HomeVisitLog.find({
    overall_status: { $in: ['pending', 'parent_approved'] },
    qr_used_in: false,
  })
    .populate('student_id', 'name rollNo hostel phone parentPhone')
    .sort({ createdAt: -1 })
    .limit(cap)
    .lean();

  for (const visit of awaiting) {
    if (visit.return_date < today) continue;

    const statusNote = visit.overall_status === 'parent_approved'
      ? 'Parent OK — warden must approve to enable QR scan'
      : visit.parent_call_confirmed
        ? 'Call confirmed — warden must approve'
        : 'Waiting for warden (call parent & approve)';

    items.push(
      buildPassMeta(visit, null, {
        scanType: 'AWAITING WARDEN',
        scannable: false,
        statusNote,
      })
    );
  }

  const approved = await HomeVisitLog.find({
    overall_status: 'approved',
    qr_used_in: false,
  })
    .populate('student_id', 'name rollNo hostel phone parentPhone')
    .sort({ updatedAt: -1 })
    .limit(cap)
    .lean();

  for (const visit of approved) {
    if (!visit.qr_used_out && visit.return_date < today) continue;

    let token = visit.qr_token;
    if (!token || isLegacyHomeJwtToken(token)) {
      try {
        const issued = await issueHomeVisitGatePass(visit);
        token = issued.token;
      } catch (err) {
        console.error('issueHomeVisitGatePass failed:', visit._id, err.message);
        items.push(
          buildPassMeta(visit, null, {
            scanType: 'QR ERROR',
            scannable: false,
            statusNote: 'Approved but QR failed — student refreshes status or warden re-approves',
          })
        );
        continue;
      }
    } else {
      await syncHomeVisitActiveQR(visit, token);
    }
    if (!token) continue;

    items.push(buildPassMeta(visit, token, { scannable: true }));
    if (items.length >= cap) break;
  }

  return items.slice(0, cap);
};

/** On startup / maintenance: replace long JWT qr_token values with short HV-* passes */
const migrateAllLegacyHomeVisitQrs = async () => {
  const visits = await HomeVisitLog.find({
    overall_status: 'approved',
    qr_used_in: false,
    $or: [
      { qr_token: { $regex: /^eyJ/ } },
      { qr_token: null },
      { qr_token: '' },
    ],
  })
    .populate('student_id', 'name rollNo hostel')
    .lean();

  let migrated = 0;
  for (const visit of visits) {
    try {
      await issueHomeVisitGatePass(visit);
      migrated += 1;
    } catch (err) {
      console.warn('Home visit QR migration skipped:', visit._id, err.message);
    }
  }
  if (migrated > 0) {
    console.log(`✅ Home visit QR: migrated ${migrated} pass(es) to compact HV-* format`);
  }
  return migrated;
};

module.exports = {
  syncHomeVisitActiveQR,
  ensureHomeVisitQrToken,
  issueHomeVisitGatePass,
  listPendingHomeVisitPasses,
  migrateAllLegacyHomeVisitQrs,
  findHomeVisitByScanToken,
  buildPassMeta,
  isLegacyHomeJwtToken,
};
