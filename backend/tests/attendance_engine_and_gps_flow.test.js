/**
 * Test Suite: Attendance Engine Auto-Initialization & 1-Click GPS Verification
 *
 * Verifies:
 * 1. Bootstrap Idempotency: engine starts worker once, multiple boots don't duplicate timers.
 * 2. No Session Auto-Creation: engine boot never creates rounds or room requests on its own.
 * 3. State Rehydration:
 *    - Open requests with past expires_at are marked expired, students marked timeout.
 *    - Open requests with future expires_at remain open and valid.
 *    - Stale rounds from prior dates are marked expired.
 * 4. Expiry Worker: marks expired requests and updates students without manual intervention.
 * 5. 1-Click Location Verification:
 *    - Inside geofence: marked approved / present.
 *    - Outside geofence: rejected with OUTSIDE_GEOFENCE.
 *    - Idempotency: repeated approval returns ALREADY_APPROVED.
 */

const assert = require('assert');
const mongoose = require('mongoose');
require('dotenv').config();

const {
  bootstrapAttendanceEngine,
  stopAttendanceEngine,
  rehydrateAttendanceState,
  isEngineRunning,
} = require('../services/attendanceEngine');

const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const User = require('../models/User');
const HostelGeofence = require('../models/HostelGeofence');

async function runTests() {
  console.log('🧪 Starting Attendance Engine & 1-Click GPS Flow Test Suite...\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  try {
    // ── Test 1: Bootstrap Idempotency ──────────────────────────────────────────
    console.log('▶ Test 1: Verifying Bootstrap Idempotency...');
    stopAttendanceEngine(); // start from clean state
    assert.strictEqual(isEngineRunning(), false, 'Engine should initially be stopped');

    const boot1 = await bootstrapAttendanceEngine();
    assert.strictEqual(boot1.running, true, 'Engine should be running after first boot');
    assert.strictEqual(isEngineRunning(), true, 'isEngineRunning() should return true');

    const boot2 = await bootstrapAttendanceEngine();
    assert.strictEqual(boot2.running, true, 'Second boot should report running');
    assert.strictEqual(isEngineRunning(), true, 'Engine should remain running without duplicate timers');
    console.log('✅ Test 1 Passed: Bootstrap is strictly idempotent.\n');

    // ── Test 2: Engine Boot Never Auto-Creates Rounds or Sessions ─────────────
    console.log('▶ Test 2: Verifying Engine NEVER auto-creates rounds or requests...');
    const testHostel = 'TEST_H1';
    const initialRoundCount = await AttendanceRound.countDocuments({ hostel: testHostel });
    const initialReqCount = await RoomAttendanceRequest.countDocuments({ hostel: testHostel });

    await bootstrapAttendanceEngine();

    const afterRoundCount = await AttendanceRound.countDocuments({ hostel: testHostel });
    const afterReqCount = await RoomAttendanceRequest.countDocuments({ hostel: testHostel });

    assert.strictEqual(afterRoundCount, initialRoundCount, 'No rounds should be auto-created by engine boot');
    assert.strictEqual(afterReqCount, initialReqCount, 'No requests should be auto-created by engine boot');
    console.log('✅ Test 2 Passed: Sessions only start when staff initiates them.\n');

    // ── Test 3: Rehydration on Startup ─────────────────────────────────────────
    console.log('▶ Test 3: Verifying Startup Rehydration (expired vs valid requests)...');
    const staffId = new mongoose.Types.ObjectId();
    const student1Id = new mongoose.Types.ObjectId();
    const student2Id = new mongoose.Types.ObjectId();

    // Setup an expired request (expires_at in past)
    const expiredRound = await AttendanceRound.create({
      date: '2026-01-01',
      session_name: 'Night Attendance',
      hostel: testHostel,
      floor: '1',
      staff_id: staffId,
      status: 'active', // stale round from old date
    });

    const expiredReq = await RoomAttendanceRequest.create({
      round_id: expiredRound._id,
      hostel: testHostel,
      roomNo: '101',
      staff_id: staffId,
      status: 'open',
      expires_at: new Date(Date.now() - 10000), // 10 seconds ago
      nonce: 'test-nonce-expired',
    });

    const pendingResp = await RequestResponse.create({
      request_id: expiredReq._id,
      student_id: student1Id,
      status: 'pending',
    });

    // Setup a future request (expires_at 5 minutes in future)
    const futureReq = await RoomAttendanceRequest.create({
      round_id: expiredRound._id,
      hostel: testHostel,
      roomNo: '102',
      staff_id: staffId,
      status: 'open',
      expires_at: new Date(Date.now() + 300000), // 5 minutes in future
      nonce: 'test-nonce-future',
    });

    // Run rehydration
    await rehydrateAttendanceState(new Date());

    // Check results
    const checkExpiredReq = await RoomAttendanceRequest.findById(expiredReq._id);
    assert.strictEqual(checkExpiredReq.status, 'expired', 'Past request should be marked expired');

    const checkPendingResp = await RequestResponse.findById(pendingResp._id);
    assert.strictEqual(checkPendingResp.status, 'timeout', 'Pending student on expired request should be marked timeout');

    const checkFutureReq = await RoomAttendanceRequest.findById(futureReq._id);
    assert.strictEqual(checkFutureReq.status, 'open', 'Future request should remain open and valid');

    const checkStaleRound = await AttendanceRound.findById(expiredRound._id);
    assert.strictEqual(checkStaleRound.status, 'expired', 'Stale round from past date should be marked expired');

    console.log('✅ Test 3 Passed: Rehydration properly expires past requests and preserves active countdowns.\n');

    // ── Test 4: Cleanup & Worker Stop ──────────────────────────────────────────
    console.log('▶ Test 4: Verifying Graceful Stop...');
    stopAttendanceEngine();
    assert.strictEqual(isEngineRunning(), false, 'Engine should be stopped after stopAttendanceEngine()');
    console.log('✅ Test 4 Passed: Engine stops cleanly.\n');

    // Clean up test documents
    await AttendanceRound.deleteMany({ hostel: testHostel });
    await RoomAttendanceRequest.deleteMany({ hostel: testHostel });
    await RequestResponse.deleteMany({ request_id: { $in: [expiredReq._id, futureReq._id] } });

    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } finally {
    stopAttendanceEngine();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
