/**
 * GatePass Service
 * MongoDB is the single source of truth for all active Gate Passes.
 * Prevents duplicate QR generation, ensures persistence across logins, refreshes,
 * and midnight boundaries until student returns to campus.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
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
      const token = unreturnedLog.qr_token || createCompactToken();
      pass = await GatePass.findOneAndUpdate(
        { student_id: sId, status: 'OUTSIDE' },
        {
          $setOnInsert: {
            student_id: sId,
            pass_type: 'IN_OUT',
            qr_token: token,
            status: 'OUTSIDE',
            place: unreturnedLog.place || '',
            reason: unreturnedLog.reason || '',
            out_time: unreturnedLog.out_time || unreturnedLog.timestamp,
          },
        },
        { upsert: true, new: true }
      );
      if (!unreturnedLog.qr_token) {
        await InOutLog.updateOne({ _id: unreturnedLog._id }, { qr_token: token }).catch(() => {});
      }
    }

    const effectiveToken = pass.qr_token || unreturnedLog.qr_token || createCompactToken();
    if (!pass.qr_token) {
      await GatePass.updateOne({ _id: pass._id }, { qr_token: effectiveToken }).catch(() => {});
      pass.qr_token = effectiveToken;
    }

    const { qrDataUrl, qrPublicUrl } = await renderPassQR(effectiveToken, sId);
    await syncPassToCache(pass, userDoc);

    return {
      pass,
      qrDataUrl,
      qrPublicUrl,
      token: effectiveToken,
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
 * Create a BRAND NEW gate pass for a student (direction OUT).
 * Always generates a fresh unique token, cancels any previous PENDING pass,
 * and renders a completely distinct QR code.
 */
const createNewPass = async (studentId, { place = '', reason = '' } = {}, userDoc = null) => {
  const sId = studentId.toString();

  // Cancel any prior PENDING passes for this student
  const existingPending = await GatePass.find({
    student_id: sId,
    status: 'PENDING',
  });
  for (const p of existingPending) {
    p.status = 'CANCELLED';
    await p.save();
    await removePassFromCache(p).catch(() => {});
  }

  // Create brand new pass with high-entropy fresh token
  const token = createCompactToken();
  const pass = await GatePass.create({
    student_id: sId,
    pass_type: 'IN_OUT',
    qr_token: token,
    status: 'PENDING',
    place: place || '',
    reason: reason || '',
  });

  const { qrDataUrl, qrPublicUrl } = await renderPassQR(pass.qr_token, sId);
  await syncPassToCache(pass, userDoc);

  return {
    pass,
    qrDataUrl,
    qrPublicUrl,
    token: pass.qr_token,
    scanType: 'OUT',
    status: 'PENDING',
  };
};

/**
 * Get or create an active pass for student.
 * IF options.forceNew is true -> cancels prior pending and creates a fresh unique pass.
 * ELSE IF active pass exists -> return existing pass.
 * ELSE -> create a new pass in MongoDB and return it.
 */
const getOrCreateActivePass = async (studentId, { place = '', reason = '' } = {}, userDoc = null, options = {}) => {
  const sId = studentId.toString();

  // If forceNew is requested (e.g. user clicked a destination button to generate pass),
  // always create a brand new pass with a fresh unique QR code!
  if (options.forceNew) {
    const unreturnedLog = await InOutLog.findOne({
      student_id: sId,
      status: 'OUT',
      returned: false,
    }).sort({ timestamp: -1 }).lean();

    // If student is physically OUT, their active pass is for returning IN
    if (unreturnedLog) {
      return getActivePassForStudent(sId, userDoc);
    }

    return createNewPass(sId, { place, reason }, userDoc);
  }

  // 1. Check existing active pass first
  const existing = await getActivePassForStudent(sId, userDoc);
  if (existing) {
    if (place && existing.pass.status === 'PENDING') {
      await GatePass.updateOne({ _id: existing.pass._id }, { place });
      existing.pass.place = place;
    }
    return existing;
  }

  // 2. Create new pass atomically
  return createNewPass(sId, { place, reason }, userDoc);
};

/**
 * Transition pass from PENDING to OUTSIDE when student scans OUT
 */
const recordPassOut = async (tokenOrId, guardId, guardName) => {
  const query = { status: 'PENDING' };
  if (tokenOrId && mongoose.isValidObjectId(tokenOrId)) {
    query.$or = [{ _id: tokenOrId }, { qr_token: tokenOrId }];
  } else {
    query.qr_token = tokenOrId;
  }

  const pass = await GatePass.findOneAndUpdate(
    query,
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
const recordPassIn = async (tokenOrId, guardId, guardName) => {
  const now = new Date();
  const query = { status: { $in: ['OUTSIDE', 'PENDING'] } };
  if (tokenOrId && mongoose.isValidObjectId(tokenOrId)) {
    query.$or = [{ _id: tokenOrId }, { qr_token: tokenOrId }];
  } else {
    query.qr_token = tokenOrId;
  }

  const pass = await GatePass.findOneAndUpdate(
    query,
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
  createNewPass,
  getActivePassForStudent,
  getOrCreateActivePass,
  recordPassOut,
  recordPassIn,
  syncPassToCache,
  removePassFromCache,
};
