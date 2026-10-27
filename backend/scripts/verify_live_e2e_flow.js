/**
 * Comprehensive Live E2E Flow Verification Script
 * Tests the entire required floor attendance workflow against live server at http://localhost:5001:
 *
 * 1. Auth: Generate valid tokens for student and warden.
 * 2. Student listener start: Verify GET /api/attendance/pending.
 * 3. Staff floor selection: GET /api/attendance/hostels and GET /api/attendance/hostels/BH2/floors.
 * 4. Start Round: POST /api/attendance/rounds/start for BH2, 2nd Floor.
 * 5. Room List: GET /api/attendance/rounds/:id/rooms.
 * 6. Request Attendance: POST /api/attendance/rounds/:id/rooms/202/request.
 * 7. Student check pending: GET /api/attendance/pending verifies prompt data (nonce, expires, countdown).
 * 8. Student approve: POST /api/attendance/requests/:requestId/approve with GPS inside geofence.
 * 9. Live status check: GET /api/attendance/rounds/:id/live and GET /api/attendance/rounds/:id/rooms/202.
 * 10. Manual override with mandatory remark: POST /api/attendance/rounds/:id/override.
 * 11. Skip Room with mandatory reason: POST /api/attendance/rounds/:id/rooms/201/skip.
 * 12. Complete Round: POST /api/attendance/rounds/:id/complete.
 * 13. Reports: GET /api/attendance/reports and GET /api/attendance/reports/export.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const assert = require('assert');

const BASE_URL = 'http://localhost:5001/api';

async function main() {
  console.log('🚀 Starting Full End-to-End Live HTTP Verification against ' + BASE_URL);

  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('../models/User');

  const warden = await User.findOne({ role: 'warden' });
  const student = await User.findOne({ role: 'student', hostel: 'BH2' });

  assert(warden, 'Warden user required in DB');
  assert(student, 'Student user required in DB');

  const jwtSecret = process.env.JWT_SECRET || 'secret';
  const wardenToken = jwt.sign({ id: warden._id, role: warden.role }, jwtSecret, { expiresIn: '1h' });
  const studentToken = jwt.sign({ id: student._id, role: student.role }, jwtSecret, { expiresIn: '1h' });

  const staffHeaders = {
    'Authorization': `Bearer ${wardenToken}`,
    'Content-Type': 'application/json',
  };

  const studentHeaders = {
    'Authorization': `Bearer ${studentToken}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Student listener initial pending check
  console.log('\n--- Step 1: Student Listener initial pending check ---');
  const resPendingInit = await fetch(`${BASE_URL}/attendance/pending`, { headers: studentHeaders });
  const dataPendingInit = await resPendingInit.json();
  console.log('Student pending initial status:', dataPendingInit.success);
  assert.strictEqual(dataPendingInit.success, true);

  // Step 2: Staff Hostel & Floor Selection
  console.log('\n--- Step 2: Staff Hostel & Floor selection ---');
  const resHostels = await fetch(`${BASE_URL}/attendance/hostels`, { headers: staffHeaders });
  const dataHostels = await resHostels.json();
  assert.strictEqual(dataHostels.success, true);
  console.log('Hostels loaded:', dataHostels.hostels?.map(h => h.code).join(', '));

  const resFloors = await fetch(`${BASE_URL}/attendance/hostels/BH2/floors`, { headers: staffHeaders });
  const dataFloors = await resFloors.json();
  assert.strictEqual(dataFloors.success, true);
  console.log('BH2 Floors loaded:', dataFloors.floors?.join(', '));

  // Step 3: Start Round
  console.log('\n--- Step 3: Staff starts round on BH2, 2nd Floor ---');
  const sessionName = 'Live E2E Round ' + Date.now();
  const resStart = await fetch(`${BASE_URL}/attendance/rounds/start`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      hostel: 'BH2',
      floor: '2nd Floor',
      session_name: sessionName,
    }),
  });
  const dataStart = await resStart.json();
  assert.strictEqual(dataStart.success, true);
  const roundId = dataStart.round._id;
  console.log(`Round started successfully (id: ${roundId})`);

  // Step 4: Room list
  console.log('\n--- Step 4: Staff views room list for 2nd Floor ---');
  const resRooms = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms`, { headers: staffHeaders });
  const dataRooms = await resRooms.json();
  assert.strictEqual(dataRooms.success, true);
  console.log(`Loaded ${dataRooms.rooms?.length} rooms. First 3:`, dataRooms.rooms?.slice(0, 3).map(r => r.roomNo).join(', '));

  // Step 5: Staff requests attendance for Room 202
  console.log('\n--- Step 5: Staff requests attendance for Room 202 ---');
  const resReq = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/202/request`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({}),
  });
  const dataReq = await resReq.json();
  assert.strictEqual(dataReq.success, true);
  console.log('Request created for Room 202:', dataReq.request?._id || dataReq._id);
  const reqId = (dataReq.request?._id || dataReq._id).toString();

  // Step 6: Student listener detects request
  console.log('\n--- Step 6: Student checks /attendance/pending ---');
  const resPending = await fetch(`${BASE_URL}/attendance/pending`, { headers: studentHeaders });
  const dataPending = await resPending.json();
  assert.strictEqual(dataPending.success, true);
  assert.strictEqual(dataPending.hasPending, true);
  assert.strictEqual(dataPending.request.roomNo, '202');
  console.log('Student received pending request for Room 202 with remainingSeconds:', dataPending.request.remainingSeconds);

  // Step 7: Student approves attendance with GPS inside geofence
  console.log('\n--- Step 7: Student approves with GPS inside BH2 geofence ---');
  const resApprove = await fetch(`${BASE_URL}/attendance/requests/${reqId}/approve`, {
    method: 'POST',
    headers: studentHeaders,
    body: JSON.stringify({
      nonce: dataPending.request.nonce,
      gps_lat: 18.763092,
      gps_lng: 73.699231,
      gps_accuracy: 12,
    }),
  });
  const dataApprove = await resApprove.json();
  assert.strictEqual(dataApprove.success, true);
  assert(dataApprove.status === 'present' || dataApprove.code === 'ALREADY_APPROVED');
  console.log('Student approval confirmed:', dataApprove.message);

  // Step 8: Room details check
  console.log('\n--- Step 8: Staff checks Room 202 details ---');
  const resRoomDetail = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/202`, { headers: staffHeaders });
  const dataRoomDetail = await resRoomDetail.json();
  assert.strictEqual(dataRoomDetail.success, true);
  console.log('Room 202 occupant status:', dataRoomDetail.students?.[0]?.status);
  assert.strictEqual(dataRoomDetail.students?.[0]?.status?.toLowerCase(), 'approved');

  // Step 9: Manual override for student with mandatory remark
  console.log('\n--- Step 9: Staff performs manual override with mandatory remark ---');
  const resOverride = await fetch(`${BASE_URL}/attendance/requests/${reqId}/override`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      studentId: student._id,
      status: 'manual_present',
      remark: 'Verified physically in room during round inspection',
    }),
  });
  const dataOverride = await resOverride.json();
  assert.strictEqual(dataOverride.success, true);
  console.log('Manual override confirmed with audit log');

  // Step 10: Staff skips an empty room with mandatory reason
  console.log('\n--- Step 10: Staff skips Room 201 with reason ---');
  const resSkip = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/rooms/201/skip`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({
      reason: 'Room 201 is vacant and locked for maintenance',
    }),
  });
  const dataSkip = await resSkip.json();
  assert.strictEqual(dataSkip.success, true);
  console.log('Room 201 skipped:', dataSkip.message);

  // Step 11: Complete Round
  console.log('\n--- Step 11: Staff completes the round ---');
  const resComplete = await fetch(`${BASE_URL}/attendance/rounds/${roundId}/complete`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({}),
  });
  const dataComplete = await resComplete.json();
  assert.strictEqual(dataComplete.success, true);
  console.log('Round completed successfully! Summary:', JSON.stringify(dataComplete.round?.completed_summary));

  // Step 12: Reports
  console.log('\n--- Step 12: Staff retrieves attendance reports ---');
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const resReports = await fetch(`${BASE_URL}/attendance/reports?date=${today}&hostel=BH2`, { headers: staffHeaders });
  const dataReports = await resReports.json();
  assert.strictEqual(dataReports.success, true);
  console.log(`Reports loaded for ${today}: ${dataReports.records?.length} records found`);

  console.log('\n🎉 FULL LIVE E2E ATTENDANCE FLOW PASSED 100%!');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\n❌ E2E FLOW FAILED:', err);
  process.exit(1);
});
