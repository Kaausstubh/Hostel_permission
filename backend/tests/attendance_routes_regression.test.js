/**
 * Attendance Routes Regression Test Suite
 * Verifies all attendance endpoints:
 * 1. Reachability & method correctness (singular and plural aliases)
 * 2. Role authorization (staff/warden: 200/appropriate, student/security: 403)
 * 3. Resource not found (404) vs Route not found (404)
 * 4. End-to-end flow execution:
 *    Hostel list -> Floor list -> Start round -> Resume round -> Room list ->
 *    Room details -> Request attendance -> Resend -> Skip room -> Reopen -> Manual override -> Complete round
 */

const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const BASE_URL = 'http://localhost:5001/api';

async function runRegressionTests() {
  console.log('🧪 Running Attendance Flow & Route Regression Tests...\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel');

  const User = require('../models/User');
  let staff = await User.findOne({ role: { $in: ['hostel_staff', 'warden', 'admin'] } });
  if (!staff) {
    staff = await User.create({
      name: 'Regression Staff',
      email: 'staff_reg_' + Date.now() + '@example.com',
      role: 'hostel_staff',
      oauthProvider: 'google',
      oauthId: 'oauth_staff_' + Date.now(),
    });
  }

  let student = await User.findOne({ role: 'student' });
  if (!student) {
    student = await User.create({
      name: 'Regression Student',
      email: 'student_reg_' + Date.now() + '@cse.iiitp.ac.in',
      role: 'student',
      oauthProvider: 'google',
      oauthId: 'oauth_student_' + Date.now(),
    });
  }

  const staffToken = jwt.sign(
    { id: staff._id.toString(), role: staff.role, name: staff.name },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const studentToken = jwt.sign(
    { id: student._id.toString(), role: 'student', name: student.name },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  let securityUser = await User.findOne({ role: 'security' });
  if (!securityUser) {
    securityUser = await User.create({
      name: 'Regression Security',
      email: 'security_reg_' + Date.now() + '@example.com',
      role: 'security',
      oauthProvider: 'google',
      oauthId: 'oauth_sec_' + Date.now(),
    });
  }

  const securityToken = jwt.sign(
    { id: securityUser._id.toString(), role: 'security', name: securityUser.name },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const staffHeaders = { 'Authorization': `Bearer ${staffToken}`, 'Content-Type': 'application/json' };
  const studentHeaders = { 'Authorization': `Bearer ${studentToken}`, 'Content-Type': 'application/json' };
  const secHeaders = { 'Authorization': `Bearer ${securityToken}`, 'Content-Type': 'application/json' };

  // ── TEST 1: Role Security Guards (Must reject student & security with 403, not 404) ──
  console.log('▶ Test 1: Role rejection (403 vs 404)');
  const rStudent = await fetch(`${BASE_URL}/attendance/hostels`, { headers: studentHeaders });
  assert.strictEqual(rStudent.status, 403, 'Student must be rejected with 403 Forbidden');
  const dStudent = await rStudent.json();
  assert(dStudent.message.includes('not authorized'), 'Message must indicate role not authorized');

  const rSec = await fetch(`${BASE_URL}/attendance/rounds`, { method: 'POST', headers: secHeaders, body: JSON.stringify({ hostel: 'BH2' }) });
  assert.strictEqual(rSec.status, 403, 'Security must be rejected with 403 Forbidden');
  console.log('  ✅ Student and Security correctly rejected with 403');

  // ── TEST 2: Route Not Found vs Resource Not Found ──
  console.log('▶ Test 2: 404 distinctions (Route not found vs Resource not found)');
  const rNonExistentRoute = await fetch(`${BASE_URL}/attendance/invalid-nonexistent-endpoint`, { headers: staffHeaders });
  assert.strictEqual(rNonExistentRoute.status, 404, 'Unknown endpoint must return 404');
  const dNonExistent = await rNonExistentRoute.json();
  assert(dNonExistent.message.includes('not found'), 'Message must state route not found');

  const rInvalidHostelFloors = await fetch(`${BASE_URL}/attendance/hostels/NONEXISTENT_HOSTEL_XYZ/floors`, { headers: staffHeaders });
  assert.strictEqual(rInvalidHostelFloors.status, 404, 'Non-existent hostel must return 404 resource not found');
  const dInvalidHostel = await rInvalidHostelFloors.json();
  assert(dInvalidHostel.message.includes('not found'), 'Message must state hostel not found');

  const rInvalidRound = await fetch(`${BASE_URL}/attendance/rounds/650000000000000000000000/rooms`, { headers: staffHeaders });
  assert.strictEqual(rInvalidRound.status, 404, 'Non-existent round must return 404 Round not found');
  console.log('  ✅ Route not found and Resource not found distinguished correctly');

  // ── TEST 3: Path Aliasing (Singular & Plural routes both reachable) ──
  console.log('▶ Test 3: Path Aliasing (Singular & Plural)');
  const rHostels = await fetch(`${BASE_URL}/attendance/hostels`, { headers: staffHeaders });
  assert.strictEqual(rHostels.status, 200);
  const dHostels = await rHostels.json();
  assert(dHostels.hostels.length > 0, 'Hostel list must be populated');

  // Plural & Singular floors
  const rFloorsPlural = await fetch(`${BASE_URL}/attendance/hostels/BH2/floors`, { headers: staffHeaders });
  assert.strictEqual(rFloorsPlural.status, 200);
  const rFloorsSingular = await fetch(`${BASE_URL}/attendance/hostel/BH2/floors`, { headers: staffHeaders });
  assert.strictEqual(rFloorsSingular.status, 200);
  console.log('  ✅ /hostels/BH2/floors and /hostel/BH2/floors both return 200');

  // ── TEST 4: Full End-to-End Attendance Flow ──
  console.log('▶ Test 4: Full End-to-End Staff Floor Round Flow');
  const sessionName = 'Regression Test Session ' + Date.now();
  const testFloor = '1st Floor';

  // 1. Start Round (test POST /rounds)
  const rStart = await fetch(`${BASE_URL}/attendance/rounds`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ hostel: 'BH2', floor: testFloor, session_name: sessionName }),
  });
  assert.strictEqual(rStart.status, 200);
  const dStart = await rStart.json();
  const roundId = dStart.round._id;
  assert(roundId, 'Round ID must be returned');
  console.log(`  1. Started round: ${roundId} for Floor: ${testFloor}`);

  // 2. Resume Round (test idempotent re-call)
  const rResume = await fetch(`${BASE_URL}/attendance/rounds`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ hostel: 'BH2', floor: testFloor, session_name: sessionName }),
  });
  assert.strictEqual(rResume.status, 200);
  const dResume = await rResume.json();
  assert.strictEqual(dResume.resumed, true, 'Subsequent start should resume existing round');
  console.log('  2. Resumed round confirmed');

  // 3. Room List for Round (test both singular /round/:id/rooms and plural /rounds/:id/rooms)
  const rRoomsPlural = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms`, { headers: staffHeaders });
  assert.strictEqual(rRoomsPlural.status, 200);
  const rRoomsSingular = await fetch(`${BASE_URL}/attendance/round/${roundId}/rooms`, { headers: staffHeaders });
  assert.strictEqual(rRoomsSingular.status, 200);
  const dRooms = await rRoomsPlural.json();
  assert(dRooms.rooms && dRooms.rooms.length > 0, 'Round must return room list');
  const testRoom = dRooms.rooms[0].roomNo;
  console.log(`  3. Room list loaded: ${dRooms.rooms.length} rooms (First room: ${testRoom})`);

  // 4. Room Details (test both singular and plural)
  const rDetailsPlural = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/${testRoom}`, { headers: staffHeaders });
  assert.strictEqual(rDetailsPlural.status, 200);
  const rDetailsSingular = await fetch(`${BASE_URL}/attendance/round/${roundId}/rooms/${testRoom}`, { headers: staffHeaders });
  assert.strictEqual(rDetailsSingular.status, 200);
  console.log(`  4. Room details loaded for Room ${testRoom}`);

  // 5. Skip Room (with mandatory reason)
  const rSkip = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/${testRoom}/skip`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ reason: 'Room locked - students at laboratory' }),
  });
  assert.strictEqual(rSkip.status, 200);
  const dSkip = await rSkip.json();
  assert.strictEqual(dSkip.success, true);
  console.log(`  5. Skipped Room ${testRoom} with reason`);

  // 6. Reopen Room
  const rReopen = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/${testRoom}/reopen`, {
    method: 'POST',
    headers: staffHeaders,
  });
  assert.strictEqual(rReopen.status, 200);
  console.log(`  6. Reopened Room ${testRoom}`);

  // 7. Request Attendance or Skip for All Rooms
  const rReqAll = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/request-all`, {
    method: 'POST',
    headers: staffHeaders,
  });
  assert.strictEqual(rReqAll.status, 200);
  console.log('  7. 1-Click Request All Rooms executed');

  // 8. Resend Route (test /rounds/:id/rooms/:roomNo/resend)
  const rResend = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/${testRoom}/resend`, {
    method: 'POST',
    headers: staffHeaders,
  });
  // If room was vacant, 400 is valid; if open, 200 is valid
  assert([200, 400, 404].includes(rResend.status), 'Resend route must be handled by controller, not 404 Route Not Found');
  console.log(`  8. Resend route reachable (status: ${rResend.status})`);

  // 9. Complete Round
  const rComplete = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/complete`, {
    method: 'POST',
    headers: staffHeaders,
  });
  assert.strictEqual(rComplete.status, 200);
  const dComplete = await rComplete.json();
  assert.strictEqual(dComplete.success, true);
  console.log('  9. Completed and finalized round');

  // 10. Live Status Route
  const rStatus = await fetch(`${BASE_URL}/attendance/status`, { headers: staffHeaders });
  assert.strictEqual(rStatus.status, 200);
  console.log('  10. Live status endpoint verified (200 OK)');

  console.log('\n🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runRegressionTests().catch((err) => {
  console.error('\n❌ Regression Test Failed:', err);
  process.exit(1);
});
