/**
 * In/Out Request Service
 * Keeps daily IN/OUT gate requests that are visible to security.
 * The initial request expires after a short TTL if it is never scanned.
 * Once the OUT scan is completed, the same QR remains pending for the IN return.
 */

const { getRedis } = require('./redisClient');
const crypto = require('crypto');
const GatePass = require('../models/GatePass');
const InOutLog = require('../models/InOutLog');
const User = require('../models/User');
const { renderQRValue } = require('./qrService');

const { INOUT_REQUEST_EXPIRY_SECONDS } = require('../config/campus');
const INOUT_REQUEST_EXPIRY = INOUT_REQUEST_EXPIRY_SECONDS;
const INOUT_REQUEST_INDEX = 'pending_inout_request_students';
const pendingRequestKey = (studentId) => `pending_inout_request:${studentId}`;
const pendingRequestTokenKey = (token) => `pending_inout_request_token:${token}`;
const fallbackPendingRequests = new Map();

const buildEntry = ({
  studentId,
  studentName,
  hostel,
  rollNumber,
  studentPhone,
  parentPhone,
  studentPhoto = '',
  place,
  reason,
  scanType,
  createdAt,
  expiresAt,
  token,
  qrDataUrl,
  qrPublicUrl,
  qrFilename,
}) => ({
  requestId: studentId,
  requestType: 'inout_request',
  studentId,
  studentName,
  hostel,
  rollNumber,
  studentPhone: studentPhone || '',
  parentPhone: parentPhone || '',
  studentPhoto: studentPhoto || '',
  place,
  reason,
  scanType,
  createdAt,
  expiresAt,
  token,
  qrDataUrl,
  qrPublicUrl,
  qrFilename,
});

const persistEntry = async (entry, ttlSeconds = null) => {
  const redis = await getRedis();

  if (redis) {
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(pendingRequestKey(entry.studentId), JSON.stringify(entry), { EX: ttlSeconds });
      await redis.set(pendingRequestTokenKey(entry.token), entry.studentId, { EX: ttlSeconds });
    } else {
      await redis.set(pendingRequestKey(entry.studentId), JSON.stringify(entry));
      await redis.set(pendingRequestTokenKey(entry.token), entry.studentId);
    }
    await redis.sAdd(INOUT_REQUEST_INDEX, entry.studentId);
    return entry;
  }

  fallbackPendingRequests.set(entry.studentId, entry);
  return entry;
};

const createCompactToken = () => `IO-${crypto.randomBytes(6).toString('base64url')}`;

const createPendingInOutRequest = async ({
  studentId,
  studentName,
  hostel,
  rollNumber,
  studentPhone,
  parentPhone,
  studentPhoto = '',
  place = '',
  reason = '',
  scanType,
}) => {
  const createdAt = new Date().toISOString();
  // Persistent request — no short 15-minute TTL so passes survive across hours/days
  const expiresAt = null;
  const compactToken = createCompactToken();
  const { token, qrDataUrl, qrPublicUrl, qrFilename } = await renderQRValue(
    compactToken,
    `inout_request_${studentId}_${Date.now()}`,
    { errorCorrectionLevel: 'H', width: 512, margin: 4 }
  );

  const entry = buildEntry({
    studentId,
    studentName,
    hostel,
    rollNumber,
    studentPhone,
    parentPhone,
    studentPhoto,
    place,
    reason,
    scanType,
    createdAt,
    expiresAt,
    token,
    qrDataUrl,
    qrPublicUrl,
    qrFilename,
  });

  return persistEntry(entry);
};

const movePendingRequestToReturn = async (entry) => {
  const movedEntry = buildEntry({
    ...entry,
    scanType: 'IN',
    createdAt: new Date().toISOString(),
    expiresAt: null,
  });

  return persistEntry(movedEntry);
};

const removePendingInOutRequest = async (studentId) => {
  const existingEntry = await getPendingInOutRequest(studentId);
  const redis = await getRedis();

  if (redis) {
    await redis.del(pendingRequestKey(studentId));
    if (existingEntry?.token) await redis.del(pendingRequestTokenKey(existingEntry.token));
    await redis.sRem(INOUT_REQUEST_INDEX, studentId);
    return;
  }

  fallbackPendingRequests.delete(studentId);
};

const getPendingInOutRequest = async (studentId) => {
  const redis = await getRedis();

  if (redis) {
    const raw = await redis.get(pendingRequestKey(studentId));
    if (!raw) {
      await redis.sRem(INOUT_REQUEST_INDEX, studentId);
      return null;
    }
    const entry = JSON.parse(raw);
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
      await redis.del(pendingRequestKey(studentId));
      await redis.sRem(INOUT_REQUEST_INDEX, studentId);
      return null;
    }
    return entry;
  }

  const entry = fallbackPendingRequests.get(studentId);
  if (entry) return entry;

  // MongoDB fallback: check active GatePass
  try {
    const gatePass = await GatePass.findOne({
      student_id: studentId,
      status: { $in: ['PENDING', 'OUTSIDE'] },
    }).sort({ createdAt: -1 });

    if (gatePass) {
      const user = await User.findById(studentId).lean();
      const { qrDataUrl, qrPublicUrl, qrFilename } = await renderQRValue(
        gatePass.qr_token,
        `inout_request_${studentId}_restored`,
        { errorCorrectionLevel: 'H', width: 512, margin: 4 }
      );
      const restored = buildEntry({
        studentId,
        studentName: user?.name || '',
        hostel: user?.hostel || 'N/A',
        rollNumber: user?.rollNo || 'N/A',
        studentPhone: user?.phone || '',
        parentPhone: user?.parentPhone || '',
        studentPhoto: user?.studentPhoto || user?.picture || '',
        place: gatePass.place || '',
        reason: gatePass.reason || '',
        scanType: gatePass.status === 'OUTSIDE' ? 'IN' : 'OUT',
        createdAt: gatePass.createdAt ? gatePass.createdAt.toISOString() : new Date().toISOString(),
        expiresAt: null,
        token: gatePass.qr_token,
        qrDataUrl,
        qrPublicUrl,
        qrFilename,
      });
      await persistEntry(restored);
      return restored;
    }
  } catch (err) {
    console.warn('[inOutRequestService] MongoDB fallback warning:', err.message);
  }

  return null;
};

const getPendingInOutRequestByToken = async (token) => {
  const redis = await getRedis();

  if (redis) {
    const studentId = await redis.get(pendingRequestTokenKey(token));
    if (studentId) {
      const req = await getPendingInOutRequest(studentId);
      if (req) return req;
    }
  }

  for (const entry of fallbackPendingRequests.values()) {
    if (entry.token === token) {
      return entry;
    }
  }

  // MongoDB fallback by token
  try {
    const gatePass = await GatePass.findOne({ qr_token: token }).lean();
    if (gatePass && ['PENDING', 'OUTSIDE'].includes(gatePass.status)) {
      return getPendingInOutRequest(gatePass.student_id.toString());
    }
  } catch (err) {
    console.warn('[inOutRequestService] Token MongoDB fallback warning:', err.message);
  }

  return null;
};

const listPendingInOutRequests = async (limit = null) => {
  const redis = await getRedis();

  if (redis) {
    const studentIds = await redis.sMembers(INOUT_REQUEST_INDEX);
    if (!studentIds.length) return [];

    const pipeline = redis.multi();
    studentIds.forEach((studentId) => pipeline.get(pendingRequestKey(studentId)));
    const values = await pipeline.exec();

    const results = [];
    for (let i = 0; i < studentIds.length; i += 1) {
      const studentId = studentIds[i];
      const raw = values[i];

      if (!raw) {
        await redis.sRem(INOUT_REQUEST_INDEX, studentId);
        continue;
      }

      try {
        const entry = JSON.parse(raw);
        if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
          await redis.del(pendingRequestKey(studentId));
          await redis.sRem(INOUT_REQUEST_INDEX, studentId);
          continue;
        }
        results.push(entry);
      } catch {
        await redis.del(pendingRequestKey(studentId));
        await redis.sRem(INOUT_REQUEST_INDEX, studentId);
      }
    }

    const sorted = results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  const results = [];
  for (const [studentId, entry] of fallbackPendingRequests.entries()) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
      fallbackPendingRequests.delete(studentId);
      continue;
    }
    results.push(entry);
  }

  const sorted = results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
};

module.exports = {
  INOUT_REQUEST_EXPIRY,
  createPendingInOutRequest,
  getPendingInOutRequest,
  getPendingInOutRequestByToken,
  listPendingInOutRequests,
  movePendingRequestToReturn,
  removePendingInOutRequest,
};
