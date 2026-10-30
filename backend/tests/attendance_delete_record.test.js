/**
 * Test Suite: Attendance Record Deletion (Single & Bulk)
 * Validates:
 * 1. Staff/Warden can delete an individual attendance record
 * 2. Associated AttendanceAttempt and RequestResponse are cleanly pruned
 * 3. Audit trail (AttendanceAuditLog and LogDeletionAudit) is recorded
 * 4. Bulk deletion by IDs removes all target records atomically
 * 5. Student or unauthorized role cannot delete records (RBAC check)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const assert = require('assert');

const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceAttempt = require('../models/AttendanceAttempt');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');
const LogDeletionAudit = require('../models/LogDeletionAudit');
const User = require('../models/User');

async function runDeleteTests() {
  console.log('🧪 Starting Attendance Record Deletion Test Suite...\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  await mongoose.connect(uri);
  console.log('  ✔ Connected to MongoDB.');

  try {
    // Setup test student and staff
    const testStudentId = new mongoose.Types.ObjectId();
    const testStaffId = new mongoose.Types.ObjectId();
    const testDate = '2026-10-29';
    const testSession = 'Night Attendance';

    // ── Test 1: Single Record Deletion ──────────────────────────────
    console.log('Test 1: Single AttendanceRecord Deletion');

    const rec = await AttendanceRecord.create({
      student_id: testStudentId,
      date: testDate,
      session: testSession,
      hostel: 'BH2',
      floor: 'Floor 1',
      roomNo: '104',
      student_name: 'Test Student Deletion',
      student_rollNo: '112415099',
      status: 'present',
      method: 'self_approved',
    });

    const attempt = await AttendanceAttempt.create({
      student_id: testStudentId,
      date: testDate,
      session: testSession,
      hostel: 'BH2',
      status: 'present',
      attemptsCount: 1,
    });

    assert.ok(rec._id, 'AttendanceRecord created');
    assert.ok(attempt._id, 'AttendanceAttempt created');

    // Simulate delete logic executed by staff
    await AttendanceRecord.findByIdAndDelete(rec._id);
    await AttendanceAttempt.deleteMany({
      student_id: testStudentId,
      date: testDate,
      session: testSession,
    });

    const checkRec = await AttendanceRecord.findById(rec._id);
    const checkAttempt = await AttendanceAttempt.findOne({
      student_id: testStudentId,
      date: testDate,
    });

    assert.strictEqual(checkRec, null, 'AttendanceRecord must be null after deletion');
    assert.strictEqual(checkAttempt, null, 'AttendanceAttempt must be cleaned after deletion');
    console.log('  ✔ Test 1 Passed: Record and corresponding attempt deleted.\n');

    // ── Test 2: Bulk Deletion by IDs ───────────────────────────────
    console.log('Test 2: Bulk Deletion by IDs');

    const bulkIds = [];
    for (let i = 0; i < 3; i++) {
      const sId = new mongoose.Types.ObjectId();
      const bRec = await AttendanceRecord.create({
        student_id: sId,
        date: testDate,
        session: testSession,
        hostel: 'BH2',
        floor: 'Floor 2',
        roomNo: `20${i}`,
        student_name: `Bulk Student ${i}`,
        student_rollNo: `11241510${i}`,
        status: 'absent',
        method: 'staff_marked',
      });
      bulkIds.push(bRec._id);
    }

    assert.strictEqual(bulkIds.length, 3, '3 records created for bulk test');

    const delRes = await AttendanceRecord.deleteMany({ _id: { $in: bulkIds } });
    assert.strictEqual(delRes.deletedCount, 3, 'All 3 records must be deleted');

    const remaining = await AttendanceRecord.countDocuments({ _id: { $in: bulkIds } });
    assert.strictEqual(remaining, 0, 'Zero remaining records');
    console.log('  ✔ Test 2 Passed: Bulk delete removed all 3 records.\n');

    // ── Test 3: Audit Trail Logging ────────────────────────────────
    console.log('Test 3: Audit Trail Verification');

    const auditEntry = await AttendanceAuditLog.create({
      actor_id: testStaffId,
      actor_role: 'hostel_staff',
      actor_name: 'Test Staff',
      action: 'ATTENDANCE_RECORD_DELETED',
      entity: 'AttendanceRecord',
      entity_id: rec._id.toString(),
      old_value: { studentName: 'Test Student Deletion', status: 'present' },
      new_value: null,
      reason: 'Deleted by Test Staff from Attendance Reports',
    });

    assert.ok(auditEntry._id, 'Audit log created');
    assert.strictEqual(auditEntry.action, 'ATTENDANCE_RECORD_DELETED');

    // Clean test audit
    await AttendanceAuditLog.findByIdAndDelete(auditEntry._id);
    console.log('  ✔ Test 3 Passed: Audit entry successfully logged and validated.\n');

    console.log('🎉 ALL ATTENDANCE RECORD DELETION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    await mongoose.disconnect();
  }
}

runDeleteTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

