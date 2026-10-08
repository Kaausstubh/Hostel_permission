/**
 * Unit & Integration Tests: Room Allocation Module
 * Tests capacity rules, one-active-allocation constraint, atomic transfers, vacating, and audit trails.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');

const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const RoomAllocationAudit = require('../models/RoomAllocationAudit');
const User = require('../models/User');

const allocationService = require('../services/allocationService');

async function runTests() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB for Allocation Service tests.');

  try {
    // 1. Setup Test Hostel & Floor
    let testHostel = await Hostel.findOne({ code: 'BH2' });
    if (!testHostel) {
      testHostel = await Hostel.create({
        code: 'BH2',
        name: 'Boys Hostel 2',
        type: 'boys',
      });
    }

    let testFloor = await HostelFloor.findOne({ hostel_id: testHostel._id, floor_number: 99 });
    if (!testFloor) {
      testFloor = await HostelFloor.create({
        hostel_id: testHostel._id,
        floor_number: 99,
        label: 'Floor 99 (Test)',
      });
    }

    // Clean up previous test rooms and allocations for this test floor
    const oldRooms = await HostelRoom.find({ floor_id: testFloor._id });
    const oldRoomIds = oldRooms.map((r) => r._id);
    await RoomAllocation.deleteMany({ room_id: { $in: oldRoomIds } });
    await RoomAllocationAudit.deleteMany({
      $or: [{ old_room_id: { $in: oldRoomIds } }, { new_room_id: { $in: oldRoomIds } }],
    });
    await HostelRoom.deleteMany({ floor_id: testFloor._id });

    // 2. Setup Test Students
    await User.deleteMany({ rollNo: { $in: ['TEST_STUDENT_1', 'TEST_STUDENT_2', 'TEST_STUDENT_3'] } });

    const student1 = await User.create({
      name: 'Test Student One',
      rollNo: 'TEST_STUDENT_1',
      email: 'test1@campus.edu',
      role: 'student',
      oauthProvider: 'google',
      oauthId: 'oauth_test_1',
      hostel: 'BH2',
    });

    const student2 = await User.create({
      name: 'Test Student Two',
      rollNo: 'TEST_STUDENT_2',
      email: 'test2@campus.edu',
      role: 'student',
      oauthProvider: 'google',
      oauthId: 'oauth_test_2',
      hostel: 'BH2',
    });

    // 3. Test Room Creation
    console.log('Testing Room Creation...');
    const roomA = await allocationService.createRoom({
      hostel_id: testHostel._id,
      floor_id: testFloor._id,
      room_number: 'TEST-A',
      capacity: 1, // Small capacity to test ROOM_FULL
      status: 'available',
    });
    assert.strictEqual(roomA.room_number, 'TEST-A');
    assert.strictEqual(roomA.capacity, 1);
    console.log('✔ Room created successfully.');

    const roomB = await allocationService.createRoom({
      hostel_id: testHostel._id,
      floor_id: testFloor._id,
      room_number: 'TEST-B',
      capacity: 2,
      status: 'available',
    });

    const roomMaint = await allocationService.createRoom({
      hostel_id: testHostel._id,
      floor_id: testFloor._id,
      room_number: 'TEST-MAINT',
      capacity: 2,
      status: 'maintenance',
    });

    // 4. Test Normal Allocation
    console.log('Testing Student Allocation...');
    const alloc1 = await allocationService.allocateStudent({
      student_id: student1._id,
      room_id: roomA._id,
      bed_number: '1',
      remarks: 'Initial allocation',
      actor_id: null,
      actor_role: 'warden',
    });
    assert.strictEqual(alloc1.status, 'active');
    assert.strictEqual(alloc1.student_id.toString(), student1._id.toString());
    console.log('✔ Student allocated successfully.');

    // 5. Test Room Full Constraint
    console.log('Testing Room Full Constraint...');
    try {
      await allocationService.allocateStudent({
        student_id: student2._id,
        room_id: roomA._id,
        bed_number: '2',
      });
      assert.fail('Should have thrown ROOM_FULL');
    } catch (err) {
      assert.strictEqual(err.code, 'ROOM_FULL');
      console.log('✔ ROOM_FULL correctly rejected second student in capacity-1 room.');
    }

    // 6. Test One-Active-Allocation Constraint
    console.log('Testing Single Active Allocation Constraint...');
    try {
      await allocationService.allocateStudent({
        student_id: student1._id,
        room_id: roomB._id,
        bed_number: '1',
      });
      assert.fail('Should have thrown STUDENT_ALREADY_ALLOCATED');
    } catch (err) {
      assert.strictEqual(err.code, 'STUDENT_ALREADY_ALLOCATED');
      console.log('✔ STUDENT_ALREADY_ALLOCATED correctly rejected allocating student to a second room.');
    }

    // 7. Test Room Unavailable (Maintenance)
    console.log('Testing Room Unavailable Constraint...');
    try {
      await allocationService.allocateStudent({
        student_id: student2._id,
        room_id: roomMaint._id,
      });
      assert.fail('Should have thrown ROOM_UNAVAILABLE');
    } catch (err) {
      assert.strictEqual(err.code, 'ROOM_UNAVAILABLE');
      console.log('✔ ROOM_UNAVAILABLE correctly rejected allocation to maintenance room.');
    }

    // 8. Test Atomic Transfer
    console.log('Testing Atomic Student Transfer...');
    const transferAlloc = await allocationService.transferStudent({
      allocation_id: alloc1._id,
      new_room_id: roomB._id,
      bed_number: 'Bed-B1',
      reason: 'Room upgraded to Room B',
    });
    assert.strictEqual(transferAlloc.status, 'active');
    assert.strictEqual(transferAlloc.room_id.toString(), roomB._id.toString());

    // Verify old allocation is marked 'transferred'
    const updatedOldAlloc = await RoomAllocation.findById(alloc1._id);
    assert.strictEqual(updatedOldAlloc.status, 'transferred');
    assert.ok(updatedOldAlloc.vacated_on !== null);

    // Verify roomA is now available again!
    const updatedRoomA = await HostelRoom.findById(roomA._id);
    assert.strictEqual(updatedRoomA.status, 'available');
    console.log('✔ Transfer executed atomically. Old allocation marked transferred, old room freed, new allocation active.');

    // 9. Test Vacating Student
    console.log('Testing Vacate Student...');
    const vacatedAlloc = await allocationService.vacateStudent({
      allocation_id: transferAlloc._id,
      reason: 'Semester ended',
    });
    assert.strictEqual(vacatedAlloc.status, 'vacated');
    assert.ok(vacatedAlloc.vacated_on !== null);

    const activeCheck = await RoomAllocation.findOne({
      student_id: student1._id,
      status: 'active',
    });
    assert.strictEqual(activeCheck, null);
    console.log('✔ Vacate executed successfully. Student has no active allocation.');

    // 10. Test Audit Logs
    console.log('Testing Audit Trail...');
    const audits = await RoomAllocationAudit.find({ student_id: student1._id });
    assert.ok(audits.length >= 3); // ALLOCATE, TRANSFER, VACATE
    const actions = audits.map((a) => a.action);
    assert.ok(actions.includes('ALLOCATE'));
    assert.ok(actions.includes('TRANSFER'));
    assert.ok(actions.includes('VACATE'));
    console.log(`✔ Audit logs confirmed (${audits.length} entries for student).`);

    // Clean up test data
    await RoomAllocation.deleteMany({ room_id: { $in: [roomA._id, roomB._id, roomMaint._id] } });
    await RoomAllocationAudit.deleteMany({ student_id: student1._id });
    await HostelRoom.deleteMany({ floor_id: testFloor._id });
    await HostelFloor.deleteOne({ _id: testFloor._id });
    await User.deleteMany({ _id: { $in: [student1._id, student2._id] } });

    console.log('\n=======================================');
    console.log('ALL ALLOCATION MODULE TESTS PASSED! ✔');
    console.log('=======================================\n');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}
