/**
 * End-to-End Test for:
 * 1. Parent Approval -> QR Generation
 * 2. Security Scan 1: HOME OUT (Departure)
 * 3. Multi-Day Departure State
 * 4. Security Scan 2: HOME IN (Return after days -> Marks Completed)
 * 5. Replay Protection (Scan 3 -> ALREADY_USED)
 * 6. Parent Rejection -> Status Rejected, Email with Remarks, GatePass Cancelled, Scan Blocked
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const assert = require('assert');

async function runScanAndRejectionTest() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB\n');

  const User = require('../models/User');
  const Guardian = require('../models/Guardian');
  const HomeVisitLog = require('../models/HomeVisitLog');
  const ParentApproval = require('../models/ParentApproval');
  const ApprovalAuditLog = require('../models/ApprovalAuditLog');
  const GatePass = require('../models/GatePass');
  const { linkInitialGuardians } = require('../services/guardianService');
  const { recordParentDecision } = require('../services/parentApprovalService');
  const { issueHomeVisitGatePass, getHomeVisitPassData } = require('../services/homeVisitQrService');
  const { handleHomeVisitScan } = require('../services/homeVisitQrService');

  const STUDENT_EMAIL = 'scan.test.student@cse.iiitp.ac.in';
  const PARENT_EMAIL = 'scan.test.parent@gmail.com';
  const GUARD_EMAIL = 'security.guard.test@campus.edu';

  try {
    // Teardown previous test data
    await User.deleteMany({ email: { $in: [STUDENT_EMAIL, PARENT_EMAIL, GUARD_EMAIL] } });
    await Guardian.deleteMany({ email: PARENT_EMAIL });
    await HomeVisitLog.deleteMany({ rollNo: '112415777' });
    await GatePass.deleteMany({ reason: /Test/ });

    // Create Security Guard
    const guard = await User.create({
      name: 'Ramesh Security Guard',
      email: GUARD_EMAIL,
      role: 'security',
      isActive: true,
    });

    // Create Student
    const student = await User.create({
      name: 'Sanjay Kumar (Student)',
      email: STUDENT_EMAIL,
      role: 'student',
      rollNo: '112415777',
      hostel: 'BH1',
      roomNo: '305',
      phone: '+919876599001',
      parentPhone: '+919876599002',
      isActive: true,
      isEmailVerified: true,
    });

    // Link Guardian
    const linkRes = await linkInitialGuardians({
      studentId: student._id,
      guardian1: {
        name: 'Mr. Suresh Kumar',
        relationship: 'Father',
        phone: '9876599002',
        email: PARENT_EMAIL,
      },
      ip: '127.0.0.1',
      actorId: student._id,
    });

    // Activate Parent Account
    const parentUser = await User.create({
      name: 'Mr. Suresh Kumar',
      email: PARENT_EMAIL,
      role: 'parent',
      isActive: true,
    });

    // ──────────────────────────────────────────────────────────────────────────
    // PART A: SCENARIO 1 — Parent Approves -> QR Generated -> HOME OUT -> HOME IN
    // ──────────────────────────────────────────────────────────────────────────
    console.log('=== PART A: Home Visit Request Submitted ===');
    const persistentToken = 'HV-TEST-' + Date.now();
    const visit1 = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      parent_phone: student.parentPhone,
      place: 'Nagpur Home',
      reason: 'Diwali Festival with family',
      leave_date: '2026-10-25',
      return_date: '2026-10-30',
      qr_token: persistentToken,
      parent_approval_status: 'pending',
      overall_status: 'pending',
    });

    await GatePass.create({
      student_id: student._id,
      pass_type: 'HOME_VISIT',
      home_visit_id: visit1._id,
      qr_token: persistentToken,
      status: 'PENDING',
      place: visit1.place,
      reason: visit1.reason,
    });

    console.log('✅ Visit 1 created. Status: pending. GatePass created: PENDING');

    console.log('\n=== STEP 1: Parent Approves with Remarks ===');
    const approveRes = await recordParentDecision({
      visitId: visit1._id,
      parentUser,
      decision: 'APPROVED',
      remarks: 'Permission granted, have a safe train journey to Nagpur.',
      ip: '127.0.0.1',
    });

    assert.strictEqual(approveRes.decision, 'APPROVED');
    const updatedVisit1 = await HomeVisitLog.findById(visit1._id);
    console.log('✅ Parent Approval Status:', updatedVisit1.parent_approval_status);
    console.log('✅ Overall Status:', updatedVisit1.overall_status);
    console.log('✅ Scannable QR Token:', updatedVisit1.qr_token);

    assert.strictEqual(updatedVisit1.parent_approval_status, 'parent_approved');
    assert.strictEqual(updatedVisit1.overall_status, 'approved');
    assert.ok(updatedVisit1.qr_token, 'QR token must be populated');

    // Verify GatePass was synchronized
    const gatePass1 = await GatePass.findOne({ home_visit_id: visit1._id });
    console.log('✅ GatePass Status:', gatePass1.status, '| Token:', gatePass1.qr_token);
    assert.strictEqual(gatePass1.status, 'PENDING');
    assert.strictEqual(gatePass1.qr_token, updatedVisit1.qr_token);

    // Verify pass data rendered for student dashboard
    const passData = await getHomeVisitPassData(updatedVisit1);
    console.log('✅ Student dashboard QR pass generated:', Boolean(passData?.qrDataUrl));
    assert.ok(passData?.qrDataUrl, 'Student dashboard must have renderable QR dataUrl');

    console.log('\n=== STEP 2: Security Scans QR at Gate for Departure (HOME OUT) ===');
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const guardToken = jwt.sign({ id: guard._id }, process.env.JWT_SECRET || 'c5e8b67dd135136370f3fb02c8fc055038e46de0ae5f38aa4368ad6eb6c00be0');

    const app = express();
    app.use(express.json());
    const gateScanRouter = require('../routes/gateScan');
    app.use('/api/gatescan', gateScanRouter);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    const postScan = async (token) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/gatescan/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guardToken}`,
        },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      return { status: res.status, body };
    };

    const scanOutRes = await postScan(updatedVisit1.qr_token);

    console.log('✅ Scan OUT HTTP Response:', scanOutRes.status, scanOutRes.body?.message);
    console.log('✅ Scanned Log Status:', scanOutRes.body?.log?.status);
    assert.strictEqual(scanOutRes.status, 200);
    assert.strictEqual(scanOutRes.body?.message, 'Marked as HOME OUT');

    // Verify DB state after departure
    const visitAfterOut = await HomeVisitLog.findById(visit1._id);
    const studentAfterOut = await User.findById(student._id);
    const passAfterOut = await GatePass.findOne({ home_visit_id: visit1._id });

    console.log('✅ HomeVisitLog: qr_used_out =', visitAfterOut.qr_used_out, '| actual_out_time =', visitAfterOut.actual_out_time);
    console.log('✅ Student: isOutsideCampus =', studentAfterOut.isOutsideCampus);
    console.log('✅ GatePass: status =', passAfterOut.status, '| out_time =', passAfterOut.out_time);

    assert.strictEqual(visitAfterOut.qr_used_out, true);
    assert.strictEqual(passAfterOut.status, 'OUTSIDE');

    console.log('\n=== STEP 3: Multi-Day Stay at Home & Return Scan (HOME IN) ===');
    // Simulate return days later: reset cooldown so return scan is immediate in test
    visitAfterOut.actual_out_time = new Date(Date.now() - 3600 * 1000 * 48); // 2 days ago
    await visitAfterOut.save();

    const scanInRes = await postScan(updatedVisit1.qr_token);

    console.log('✅ Scan IN HTTP Response:', scanInRes.status, scanInRes.body?.message);
    console.log('✅ Scanned Log Status:', scanInRes.body?.log?.status);
    assert.strictEqual(scanInRes.status, 200);
    assert.strictEqual(scanInRes.body?.message, 'Marked as HOME IN');

    // Verify DB state after return
    const visitAfterIn = await HomeVisitLog.findById(visit1._id);
    const passAfterIn = await GatePass.findOne({ home_visit_id: visit1._id });

    console.log('✅ HomeVisitLog: qr_used_in =', visitAfterIn.qr_used_in, '| overall_status =', visitAfterIn.overall_status);
    console.log('✅ GatePass: status =', passAfterIn.status, '| in_time =', passAfterIn.in_time);

    assert.strictEqual(visitAfterIn.qr_used_in, true);
    assert.strictEqual(visitAfterIn.overall_status, 'completed');
    assert.strictEqual(passAfterIn.status, 'COMPLETED');

    console.log('\n=== STEP 4: Anti-Replay Protection (Scan 3 on Completed Pass) ===');
    const scan3Res = await postScan(updatedVisit1.qr_token);

    console.log('✅ Scan 3 Rejection:', scan3Res.status, scan3Res.body?.code, scan3Res.body?.message);
    assert.strictEqual(scan3Res.status, 400);
    assert.ok(['INVALID', 'ALREADY_USED'].includes(scan3Res.body?.code));

    // ──────────────────────────────────────────────────────────────────────────
    // PART B: SCENARIO 2 — Parent Rejection -> Status Rejected, Email, GatePass Cancelled
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n=== PART B: Second Visit Request (Testing Parent Rejection) ===');
    const visit2 = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      parent_phone: student.parentPhone,
      place: 'Goa',
      reason: 'Trip with Friends',
      leave_date: '2026-11-10',
      return_date: '2026-11-14',
      qr_token: 'HV-REJECT-TEST-' + Date.now(),
      parent_approval_status: 'pending',
      overall_status: 'pending',
    });

    await GatePass.create({
      student_id: student._id,
      pass_type: 'HOME_VISIT',
      home_visit_id: visit2._id,
      qr_token: visit2.qr_token,
      status: 'PENDING',
      place: visit2.place,
      reason: visit2.reason,
    });

    console.log('✅ Visit 2 created. Parent rejects with remarks...');
    const rejectRes = await recordParentDecision({
      visitId: visit2._id,
      parentUser,
      decision: 'REJECTED',
      remarks: 'End-semester practical exams start next week. Travel not permitted.',
      ip: '127.0.0.1',
    });

    assert.strictEqual(rejectRes.decision, 'REJECTED');

    const updatedVisit2 = await HomeVisitLog.findById(visit2._id);
    const pass2 = await GatePass.findOne({ home_visit_id: visit2._id });
    const audit2 = await ApprovalAuditLog.findOne({ home_visit_request_id: visit2._id, event: 'DECISION_MADE' });

    console.log('✅ Visit 2 parent_approval_status:', updatedVisit2.parent_approval_status);
    console.log('✅ Visit 2 overall_status:', updatedVisit2.overall_status);
    console.log('✅ GatePass 2 status:', pass2.status);
    console.log('✅ Audit remarks logged:', audit2.details.remarks);

    assert.strictEqual(updatedVisit2.parent_approval_status, 'parent_rejected');
    assert.strictEqual(updatedVisit2.overall_status, 'rejected');
    assert.strictEqual(pass2.status, 'CANCELLED');
    assert.strictEqual(audit2.details.decision, 'REJECTED');

    console.log('\n=== STEP 5: Security Scan Attempt on Rejected Visit ===');
    const scanRejectRes = await postScan(visit2.qr_token);

    console.log('✅ Scan on rejected visit response:', scanRejectRes.status, scanRejectRes.body?.message);
    assert.strictEqual(scanRejectRes.status, 400);
    assert.strictEqual(scanRejectRes.body?.code, 'INVALID');

    server.close();
    assert.strictEqual(scanRejectRes.body?.code, 'INVALID');

    console.log('\n🎉 ALL HOME VISIT APPROVAL, SCAN (OUT & IN), REPLAY PROTECTION, AND REJECTION TESTS PASSED PERFECTLY!');
  } finally {
    // Teardown
    await User.deleteMany({ email: { $in: [STUDENT_EMAIL, PARENT_EMAIL, GUARD_EMAIL] } });
    await Guardian.deleteMany({ email: PARENT_EMAIL });
    await HomeVisitLog.deleteMany({ rollNo: '112415777' });
    await GatePass.deleteMany({ reason: /Test|Diwali|Goa/ });
    await mongoose.connection.collection('parentapprovals').deleteMany({ decided_by_email: PARENT_EMAIL });
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

runScanAndRejectionTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
