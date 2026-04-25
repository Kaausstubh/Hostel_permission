/**
 * In/Out Request Service
 * Keeps daily IN/OUT gate requests that are visible to security.
 * The initial request expires after a short TTL if it is never scanned.
 * Once the OUT scan is completed, the same QR remains pending for the IN return.
 */

const { getRedis } = require('./redisClient');
const crypto = require('crypto');
const { renderQRValue } = require('./qrService');

const INOUT_REQUEST_EXPIRY = parseInt(process.env.INOUT_REQUEST_EXPIRY_SECONDS || '600', 10);
const INOUT_REQUEST_INDEX = 'pending_inout_request_students';
const pendingRequestKey = (studentId) => `pending_inout_request:${studentId}`;
const pendingRequestTokenKey = (token) => `pending_inout_request_token:${token}`;
const fallbackPendingRequests = new Map();

const buildEntry = ({
  studentId,
  studentName,
  hostel,
  rollNumber,
  place,
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
  place,
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
  place = '',
  scanType,
}) => {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (INOUT_REQUEST_EXPIRY * 1000)).toISOString();
  const compactToken = createCompactToken();
  const { token, qrDataUrl, qrPublicUrl, qrFilename } = await renderQRValue(
    compactToken,
    `inout_request_${studentId}_${Date.now()}`,
    { errorCorrectionLevel: 'M', width: 420, margin: 1 }
  );

  const entry = buildEntry({
    studentId,
    studentName,
    hostel,
    rollNumber,
    place,
    scanType,
    createdAt,
    expiresAt,
    token,
    qrDataUrl,
    qrPublicUrl,
    qrFilename,
  });

  return persistEntry(entry, INOUT_REQUEST_EXPIRY);
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
  if (!entry) return null;
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
    fallbackPendingRequests.delete(studentId);
    return null;
  }
  return entry;
};

const getPendingInOutRequestByToken = async (token) => {
  const redis = await getRedis();

  if (redis) {
    const studentId = await redis.get(pendingRequestTokenKey(token));
    if (!studentId) return null;
    return getPendingInOutRequest(studentId);
  }

  for (const entry of fallbackPendingRequests.values()) {
    if (entry.token === token) {
      if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
        fallbackPendingRequests.delete(entry.studentId);
        return null;
      }
      return entry;
    }
  }

  return null;
};

const listPendingInOutRequests = async () => {
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

    return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  const results = [];
  for (const [studentId, entry] of fallbackPendingRequests.entries()) {
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() <= Date.now()) {
      fallbackPendingRequests.delete(studentId);
      continue;
    }
    results.push(entry);
  }

  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
