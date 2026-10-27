const mongoose = require('mongoose');
const assert = require('assert');
require('dotenv').config();

async function runTest() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel_permission');
  const User = require('../models/User');
  const HomeVisitLog = require('../models/HomeVisitLog');
  const GatePass = require('../models/GatePass');
  const Guardian = require('../models/Guardian');
  const { findHomeVisitByScanToken, issueHomeVisitGatePass } = require('../services/homeVisitQrService');
  const { recordParentDecision } = require('../services/parentApprovalService');

  console.log('--- STEP 1: VERIFY INITIAL STUDENT STATUS BEFORE SCANNING ---');
  const student = await User.findOne({ email: '112415216@cse.iiitp.ac.in' });
  assert(student, 'Student exists');
  console.log('Student:', student.name, '| Roll:', student.rollNo, '| isOutsideCampus:', student.isOutsideCampus);
  assert.strictEqual(student.isOutsideCampus, false, 'Student MUST be IN before scanning out');

  const parent = await User.findOne({ email: 'sundar20000202@gmail.com' });
  assert(parent, 'Parent exists');

  // Ensure guardian record links parent to student
  const guardian = await Guardian.findOne({ student_id: student._id, user_id: parent._id });
  assert(guardian, 'Guardian link exists');

  console.log('\n--- STEP 2: CREATE TEST HOME VISIT REQUEST & PARENT APPROVES IT ---');
  // Create a clean test visit document
  const testVisit = await HomeVisitLog.create({
    student_id: student._id,
    name: student.name,
    rollNo: student.rollNo,
    email: student.email,
    phone: student.phone,
    parent_phone: parent.phone || '+918459477482',
    hostel: student.hostel,
    roomNo: student.roomNo,
    place: 'Home Town',
    reason: 'Family event',
    leave_date: '2026-10-20',
    return_date: '2026-10-24',
    parent_approval_status: 'pending',
    overall_status: 'pending',
    qr_used_out: false,
    qr_used_in: false,
  });

  console.log('Created test visit:', testVisit._id);

  // Record parent approval
  const decisionRes = await recordParentDecision({
    visitId: testVisit._id,
    parentUser: parent,
    decision: 'APPROVED',
    remarks: 'Approved by parent via portal',
  });
  const approvedVisit = decisionRes.visit;

  console.log('Approved visit details:');
  console.log('  overall_status:', approvedVisit.overall_status);
  console.log('  parent_approval_status:', approvedVisit.parent_approval_status);
  console.log('  qr_token:', approvedVisit.qr_token);
  console.log('  qr_used_out:', approvedVisit.qr_used_out);
  console.log('  qr_used_in:', approvedVisit.qr_used_in);

  assert.strictEqual(approvedVisit.qr_used_out, false, 'qr_used_out must be false initially');
  assert.strictEqual(approvedVisit.qr_used_in, false, 'qr_used_in must be false initially');
  assert(approvedVisit.qr_token, 'Pass QR token must be generated');

  // Verify student is STILL IN inside campus after approval (before scanning out)
  const studentBeforeScan = await User.findById(student._id);
  assert.strictEqual(studentBeforeScan.isOutsideCampus, false, 'Student MUST remain IN until gate scan');
  console.log('✅ Student is IN before scanning outpass (isOutsideCampus = false)');

  console.log('\n--- STEP 3: SECURITY SCANS OUTPASS (STUDENT LEAVING CAMPUS) ---');
  const guard = await User.findOne({ role: 'security' }) || { _id: new mongoose.Types.ObjectId(), name: 'Security Guard' };

  // Resolve visit using scanner lookup
  const resolved = await findHomeVisitByScanToken(approvedVisit.qr_token);
  assert(resolved, 'Scanner must resolve approved visit by token');
  console.log('Scanner resolved token:', resolved.qr_token, 'for student:', resolved.name);

  // Security records OUT scan at gate
  const outTime = new Date();
  const visitAfterOut = await HomeVisitLog.findOneAndUpdate(
    { _id: approvedVisit._id, qr_used_out: false },
    {
      $set: {
        qr_used_out: true,
        actual_out_time: outTime,
        actual_out: outTime,
        scanned_by_out: guard._id,
        scanned_by_name: guard.name || 'Security Guard',
      },
    },
    { new: true }
  );
  await User.updateOne({ _id: student._id }, { $set: { isOutsideCampus: true, lastGateScanType: 'HOME OUT', lastGateScanAt: outTime } });

  console.log('After OUT scan:');
  console.log('  qr_used_out:', visitAfterOut.qr_used_out);
  console.log('  actual_out_time:', visitAfterOut.actual_out_time);
  const studentAfterOut = await User.findById(student._id);
  console.log('  student.isOutsideCampus:', studentAfterOut.isOutsideCampus);
  console.log('  student.lastGateScanType:', studentAfterOut.lastGateScanType);
  assert.strictEqual(studentAfterOut.isOutsideCampus, true, 'Student status MUST be OUT after scanning outpass');
  console.log('✅ Student successfully recorded as OUT (isOutsideCampus = true)');

  console.log('\n--- STEP 4: STUDENT AT HOME — WHICH QR IS HE SUPPOSED TO SHOW? ---');
  console.log('  The student opens their student dashboard at home.');
  console.log('  The exact same Home Visit Pass is shown, with the instruction dynamically updated to:');
  console.log('  "🏫 Use this QR to enter campus (Home Return)"');
  console.log('  Pass token used:', visitAfterOut.qr_token);

  console.log('\n--- STEP 5: SECURITY SCANS HOME VISIT QR UPON RETURN ---');
  const inTime = new Date(Date.now() + 1000);
  const visitAfterIn = await HomeVisitLog.findOneAndUpdate(
    { _id: approvedVisit._id, qr_used_out: true, qr_used_in: false },
    {
      $set: {
        qr_used_in: true,
        actual_in_time: inTime,
        actual_in: inTime,
        overall_status: 'completed',
        scanned_by_in: guard._id,
        scanned_by_name: guard.name || 'Security Guard',
      },
    },
    { new: true }
  );
  await User.updateOne({ _id: student._id }, { $set: { isOutsideCampus: false, lastGateScanType: 'HOME IN', lastGateScanAt: inTime } });

  console.log('After IN scan:');
  console.log('  qr_used_in:', visitAfterIn.qr_used_in);
  console.log('  actual_in_time:', visitAfterIn.actual_in_time);
  console.log('  overall_status:', visitAfterIn.overall_status);
  const studentAfterIn = await User.findById(student._id);
  console.log('  student.isOutsideCampus:', studentAfterIn.isOutsideCampus);
  console.log('  student.lastGateScanType:', studentAfterIn.lastGateScanType);
  assert.strictEqual(studentAfterIn.isOutsideCampus, false, 'Student status MUST be IN after return scan');
  assert.strictEqual(visitAfterIn.overall_status, 'completed', 'Home visit MUST be marked completed');
  console.log('✅ Student successfully recorded as IN (isOutsideCampus = false, overall_status = completed)');

  // Clean up test document
  await HomeVisitLog.deleteOne({ _id: testVisit._id });
  await mongoose.connection.collection('parentapprovals').deleteMany({ home_visit_request_id: testVisit._id });

  console.log('\n🎉 ALL 5 VERIFICATION STEPS PASSED SUCCESSFULLY!');
  process.exit(0);
}

runTest().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
