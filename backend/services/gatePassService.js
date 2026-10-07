/**
 * GatePass Service
 * MongoDB is the single source of truth for all active Gate Passes.
 * Prevents duplicate QR generation, ensures persistence across logins, refreshes,
 * and midnight boundaries until student returns to campus.
 */

const crypto = require('crypto');
const GatePass = require('../models/GatePass');
const InOutLog = require('../models/InOutLog');
const User = require('../models/User');
const { renderQRValue } = require('./qrService');
const { getRedis } = require('./redisClient');

const createCompactToken = () => `IO-${crypto.randomBytes(8).toString('base64url')}`;

/**
 * Render QR data URL and public URL for a given pass token
 */
const renderPassQR = async (token, studentId) => {
  return renderQRValue(token, `inout_pass_${studentId}_${Date.now()}`, {
    errorCorrectionLevel: 'H',
    width: 512,
    margin: 4,
  });
};

/**
 * Sync active pass to Redis so guard scanner ultra-fast path finds it instantly
 */
const syncPassToCache = async (pass, userDoc = null) => {
  try {
    const redis = await getRedis();
    if (!redis) return;

    const studentId = pass.student_id.toString();
    const token = pass.qr_token;
    const scanType = pass.status === 'OUTSIDE' ? 'IN' : 'OUT';

    const user = userDoc || (await User.findById(pass.student_id).lean());

    const cachePayload = {
      requestId: studentId,
      requestType: 'inout_request',
      studentId,
      studentName: user?.name || '',
      hostel: user?.hostel || 'N/A',
      rollNumber: user?.rollNo || 'N/A',
      studentPhone: user?.phone || '',
      parentPhone: user?.parentPhone || '',
      studentPhoto: user?.studentPhoto || user?.picture || '',
      place: pass.place || '',
      reason: pass.reason || '',
      scanType,
      createdAt: pass.createdAt ? pass.createdAt.toISOString() : new Date().toISOString(),
      expiresAt: null, // Persistent! No short expiry
      token,
      passId: pass._id.toString(),
    };

    // Store under pending_inout_request keys without short TTL
    await redis.set(`pending_inout_request:${studentId}`, JSON.stringify(cachePayload));
    await redis.set(`pending_inout_request_token:${token}`, studentId);
    await redis.sAdd('pending_inout_request_students', studentId);
  } catch (err) {
    // Non-blocking caching error
    console.warn('[GatePassService] Redis sync warning:', err.message);
  }
};

/**
 * Remove pass from Redis once COMPLETED
 */
const removePassFromCache = async (pass) => {
  try {
    const redis = await getRedis();
    if (!redis) return;

    const studentId = pass.student_id.toString();
    const token = pass.qr_token;

    await redis.del(`pending_inout_request:${studentId}`);
    if (token) await redis.del(`pending_inout_request_token:${token}`);
    await redis.sRem('pending_inout_request_students', studentId);
  } catch (err) {
    console.warn('[GatePassService] Redis cache clear warning:', err.message);
  }
};

/**
 * Get active gate pass for a student (PENDING or OUTSIDE)
 * If student has an unreturned InOutLog in MongoDB, synchronizes with GatePass.
 */
const getActivePassForStudent = async (studentId, userDoc = null) => {
  const sId = studentId.toString();

  // 1. Check if student is physically OUT in InOutLog (unreturned, any date)
  const unreturnedLog = await InOutLog.findOne({
    student_id: sId,
    status: 'OUT',
    returned: false,
  })
    .sort({ timestamp: -1 })
    .lean();

  if (unreturnedLog) {
    // Ensure GatePass in MongoDB matches this unreturned OUT log
    let pass = await GatePass.findOne({
      student_id: sId,
      status: 'OUTSIDE',
    });

    if (!pass) {
      // Upsert/align GatePass with unreturned log's qr_token
      pass = await GatePass.findOneAndUpdate(
        { qr_token: unreturnedLog.qr_token },
        {
          $setOnInsert: {
            student_id: sId,
            pass_type: 'IN_OUT',
            qr_token: unreturnedLog.qr_token,
            status: 'OUTSIDE',
            place: unreturnedLog.place || '',
            reason: unreturnedLog.reason || '',
            out_time: unreturnedLog.out_time || unreturnedLog.timestamp,
          },
        },
        { upsert: true, new: true }
      );
    }

    const { qrDataUrl, qrPublicUrl } = await renderPassQR(pass.qr_token, sId);
    await syncPassToCache(pass, userDoc);

    return {
      pass,
      qrDataUrl,
      qrPublicUrl,
      token: pass.qr_token,
      scanType: 'IN',
      status: 'OUTSIDE',
    };
  }

  // 2. Student is inside; check if they have a PENDING pass
  const pendingPass = await GatePass.findOne({
    student_id: sId,
    status: 'PENDING',
  }).sort({ createdAt: -1 });

  if (pendingPass) {
    const { qrDataUrl, qrPublicUrl } = await renderPassQR(pendingPass.qr_token, sId);
    await syncPassToCache(pendingPass, userDoc);

    return {
      pass: pendingPass,
      qrDataUrl,
      qrPublicUrl,
      token: pendingPass.qr_token,
      scanType: 'OUT',
      status: 'PENDING',
    };
  }

  return null;
};

/**
 * Get or create an active pass for student.
 * IF active pass exists -> return existing pass and exact same QR.
 * ELSE -> create a new pass in MongoDB and return it.
 * Multiple simultaneous calls will return the EXACT SAME pass.
 */
const getOrCreateActivePass = async (studentId, { place = '', reason = '' } = {}, userDoc = null) => {
  const sId = studentId.toString();

  // 1. Check existing active pass first
  const existing = await getActivePassForStudent(sId, userDoc);
  if (existing) {
    // If destination place was provided and pass is still pending without a place, update it
    if (place && existing.pass.status === 'PENDING' && !existing.pass.place) {
      await GatePass.updateOne({ _id: existing.pass._id }, { place });
      existing.pass.place = place;
    }
    return existing;
  }

  // 2. Create new pass atomically
  const token = createCompactToken();

  let pass;
  try {
    pass = await GatePass.create({
      student_id: sId,
      pass_type: 'IN_OUT',
      qr_token: token,
      status: 'PENDING',
      place: place || '',
      reason: reason || '',
    });
  } catch (err) {
    // Handle concurrent creation collision gracefully
    pass = await GatePass.findOne({
      student_id: sId,
      status: { $in: ['PENDING', 'OUTSIDE'] },
    }).sort({ createdAt: -1 });

    if (!pass) throw err;
  }

  const { qrDataUrl, qrPublicUrl } = await renderPassQR(pass.qr_token, sId);
  await syncPassToCache(pass, userDoc);

  return {
    pass,
    qrDataUrl,
    qrPublicUrl,
    token: pass.qr_token,
    scanType: pass.status === 'OUTSIDE' ? 'IN' : 'OUT',
    status: pass.status,
  };
};

/**
 * Transition pass from PENDING to OUTSIDE when student scans OUT
 */
const recordPassOut = async (token, guardId, guardName) => {
  const pass = await GatePass.findOneAndUpdate(
    { qr_token: token, status: 'PENDING' },
    {
      $set: {
        status: 'OUTSIDE',
        out_time: new Date(),
        scanned_by_out: guardId,
        scanned_by_name: guardName,
      },
    },
    { new: true }
  );

  if (pass) {
    await syncPassToCache(pass);
  }
  return pass;
};

/**
 * Transition pass from OUTSIDE to COMPLETED when student scans IN
 */
const recordPassIn = async (token, guardId, guardName) => {
  const now = new Date();
  const pass = await GatePass.findOneAndUpdate(
    { qr_token: token, status: { $in: ['OUTSIDE', 'PENDING'] } },
    {
      $set: {
        status: 'COMPLETED',
        in_time: now,
        completed_at: now,
        scanned_by_in: guardId,
        scanned_by_name: guardName,
      },
    },
    { new: true }
  );

  if (pass) {
    await removePassFromCache(pass);
  }
  return pass;
};

module.exports = {
  createCompactToken,
  getActivePassForStudent,
  getOrCreateActivePass,
  recordPassOut,
  recordPassIn,
  syncPassToCache,
  removePassFromCache,
};
