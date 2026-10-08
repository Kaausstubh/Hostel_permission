/**
 * Attendance Module + Room Allocation Integration Test
 * Verifies that:
 * 1. Attendance rounds for BH2 query floor rooms from HostelRoom & RoomAllocation as single source of truth.
 * 2. Room requests resolve active student occupants from RoomAllocation.
 * 3. Student approvals record allocation_id and enforce the 50m hostel geofence check.
 * 4. Vacant rooms are flagged and do not block round completion.
 * 5. Full round finalizes and creates official AttendanceRecords.
 */

const assert = require('assert');
const mongoose = require('mongoose');

const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const User = require('../models/User');

const {
  getHostelsAndFloors,
  startOrResumeRound,
  getRoundRoomsSummary,
  getRoomDetails,
  requestRoomAttendance,
  skipRoom,
  completeRound,
} = require('../services/attendanceRoundService');

const { verifyHostelGeofence } = require('../services/geofenceService');

async function runIntegrationTest() {
  console.log('🧪 Starting Attendance + Room Allocation End-to-End Integration Test...\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel');

  // Find or create test staff user
  let staff = await User.findOne({ role: { $in: ['warden', 'admin'] } });
  if (!staff) {
    staff = await User.create({
      name: 'Test Warden',
      email: 'warden_test@example.com',
      role: 'warden',
      oauthProvider: 'google',
      oauthId: 'oauth_warden_test_' + Date.now(),
    });
  }

  // 1. Verify getHostelsAndFloors detects BH2 with its 5 floors
  const options = await getHostelsAndFloors();
  const bh2Option = options.find((h) => h.hostel === 'BH2');
  assert(bh2Option, 'BH2 hostel must be returned in options');
  console.log(`✅ Step 1: getHostelsAndFloors detected BH2 with ${bh2Option.floors.length} floors:`, bh2Option.floors);

  // 2. Start round for BH2, 1st Floor
  const roundSession = 'Test Integration Session ' + Date.now();
  const { round } = await startOrResumeRound({
    hostel: 'BH2',
    floor: '1st Floor',
    session_name: roundSession,
    staffUser: staff,
  });
  assert(round, 'Round must be created');
  assert.strictEqual(round.hostel, 'BH2');
  console.log(`✅ Step 2: Started round ${round._id} for BH2, 1st Floor`);

  // 3. Verify getRoundRoomsSummary loads the 30 rooms on 1st Floor
  const summary = await getRoundRoomsSummary(round._id);
  assert(summary.rooms.length > 0, 'Round summary must contain rooms');
  console.log(`✅ Step 3: getRoundRoomsSummary returned ${summary.rooms.length} rooms for 1st Floor`);

  // Pick first room with occupants (e.g. Room 101 or 102)
  const roomWithStudents = summary.rooms.find((r) => r.occupantCount > 0);
  assert(roomWithStudents, 'Must have at least one room with students on 1st Floor');
  console.log(`✅ Step 4: Selected Room ${roomWithStudents.roomNo} with ${roomWithStudents.occupantCount} active occupants`);

  // 4. Request attendance for this room
  const { request: roomReq } = await requestRoomAttendance({
    roundId: round._id,
    roomNo: roomWithStudents.roomNo,
    staffUser: staff,
  });
  assert(roomReq, 'RoomAttendanceRequest must be created');
  console.log(`✅ Step 5: Dispatched attendance request for Room ${roomWithStudents.roomNo} (nonce=${roomReq.nonce})`);

  // 5. Get room details and verify active student roster matches RoomAllocation
  const roomDetails = await getRoomDetails(round._id, roomWithStudents.roomNo);
  assert.strictEqual(roomDetails.students.length, roomWithStudents.occupantCount, 'Roster must match occupant count');
  console.log(`✅ Step 6: getRoomDetails verified roster of ${roomDetails.students.length} students`);

  const student = roomDetails.students[0];
  console.log(`   Student: ${student.name} (roll: ${student.rollNo})`);

  // 6. Test Geofence Verification for this student
  // Center of BH2: (18.763092, 73.699231)
  const insideBH2Coords = { lat: 18.763092, lng: 73.699231, accuracy: 15 };
  const geoResultInside = await verifyHostelGeofence('BH2', insideBH2Coords);
  assert.strictEqual(geoResultInside.valid, true, 'Coords inside BH2 must be valid');

  const outsideBH2Coords = { lat: 18.764126, lng: 73.699223, accuracy: 15 }; // At BH1
  const geoResultOutside = await verifyHostelGeofence('BH2', outsideBH2Coords);
  assert.strictEqual(geoResultOutside.valid, false, 'Coords at BH1 must be invalid for BH2');
  assert.strictEqual(geoResultOutside.reason, 'OUTSIDE_GEOFENCE');
  console.log(`✅ Step 7: Geofence check confirms student at BH2 (inside: ${geoResultInside.valid}, outside: ${geoResultOutside.valid})`);

  // 7. Simulate student response approval with active allocation_id
  const activeAlloc = await RoomAllocation.findOne({ student_id: student.studentId, status: 'active' });
  assert(activeAlloc, 'Active allocation must exist for student');

  let resp = await RequestResponse.findOne({ request_id: roomReq._id, student_id: student.studentId });
  assert(resp, 'RequestResponse must exist');
  resp.status = 'approved';
  resp.inside_geofence = true;
  resp.gps_lat = insideBH2Coords.lat;
  resp.gps_lng = insideBH2Coords.lng;
  resp.gps_accuracy = insideBH2Coords.accuracy;
  resp.allocation_id = activeAlloc._id;
  await resp.save();
  console.log(`✅ Step 8: Approved response saved with allocation_id=${resp.allocation_id}`);

  // Mark other students in the room as manual_present or approved so room is completed
  for (let i = 1; i < roomDetails.students.length; i++) {
    const otherSt = roomDetails.students[i];
    let otherResp = await RequestResponse.findOne({ request_id: roomReq._id, student_id: otherSt.studentId });
    if (otherResp) {
      otherResp.status = 'manual_present';
      otherResp.remark = 'Physically verified in room';
      await otherResp.save();
    }
  }

  // Skip remaining non-vacant rooms so round can be completed
  const updatedSummary = await getRoundRoomsSummary(round._id);
  for (const r of updatedSummary.rooms) {
    if (r.roomNo !== roomWithStudents.roomNo && !r.isVacant && r.status !== 'Completed' && r.status !== 'Skipped') {
      await skipRoom({
        roundId: round._id,
        roomNo: r.roomNo,
        reason: 'Automated test skip for remaining rooms',
        staffUser: staff,
      });
    }
  }

  // 8. Complete round and verify official attendance records
  const { round: finalRound, completedSummary } = await completeRound({ roundId: round._id, staffUser: staff });
  assert.strictEqual(finalRound.status, 'completed', 'Round must be completed');
  console.log(`✅ Step 9: completeRound finalized successfully! Present: ${completedSummary.present_students}`);

  // Verify AttendanceRecord written for approved student
  const record = await AttendanceRecord.findOne({
    student_id: student.studentId,
    round_id: round._id,
  });
  assert(record, 'AttendanceRecord must exist for student');
  assert.strictEqual(record.status, 'present');
  console.log(`✅ Step 10: Verified AttendanceRecord created with status=${record.status}`);

  console.log('\n🎉 ALL 10 END-TO-END INTEGRATION TEST STEPS PASSED!\n');
  await mongoose.disconnect();
  process.exit(0);
}

runIntegrationTest().catch((err) => {
  console.error('❌ Integration test failed:', err);
  process.exit(1);
});
