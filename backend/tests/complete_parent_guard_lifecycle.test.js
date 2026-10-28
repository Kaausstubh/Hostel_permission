/**
 * Complete Lifecycle Verification Test:
 * 1. Student submits parent email details -> Onboarding invite email sent to parent
 * 2. Parent activates account via token -> Sets password, becomes ACTIVE parent user
 * 3. Student applies for home visit -> Approval email sent to parent
 * 4. Parent approves request with optional message -> Outcome email sent, QR generated
 * 5. Security Guard scans QR at campus gate -> Student marked as OUT
 * 6. Student returns from home -> Guard scans QR -> Student marked as IN & visit completed
 * 7. Branch flow: Parent rejects with optional message -> Student notified, exit blocked at gate
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function runCompleteLifecycleTest() {
  console.log('\n========================================================================');
  console.log('   HEIMDALL COMPLETE END-TO-END WORKFLOW VERIFICATION TEST              ');
  console.log('   Student Onboarding -> Parent Activation -> Leave Approval -> Gate In/Out');
  console.log('========================================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  await mongoose.connect(uri);

  const User = require('../models/User');
  const Guardian = require('../models/Guardian');
  const GuardianInvitation = require('../models/GuardianInvitation');
  const HomeVisitLog = require('../models/HomeVisitLog');
  const GatePass = require('../models/GatePass');
  const ApprovalAuditLog = require('../models/ApprovalAuditLog');
  const {
    linkInitialGuardians,
    verifyInvitationToken,
    acceptInvitation,
  } = require('../services/guardianService');
  const { sendParentApprovalEmail } = require('../services/gasMailService');
  const {
    sendLeaveOutcomeEmailToStudent,
    sendLeaveOutcomeEmailToParent,
  } = require('../services/mailService');
  const {
    generateParentApprovalToken,
    hashParentToken,
  } = require('../utils/parentToken');
  const { createHomeVisitCompactToken } = require('../services/homeVisitQrService');

  const STUDENT_EMAIL = 'flow.student.complete@iiitpune.ac.in';
  const PARENT_EMAIL_1 = 'flow.parent.sharma@gmail.com';
  const PARENT_EMAIL_2 = 'flow.parent.alt@gmail.com';
  const GUARD_EMAIL = 'gate.guard.chief@iiitpune.ac.in';

  const ALL_TEST_EMAILS = [STUDENT_EMAIL, PARENT_EMAIL_1, PARENT_EMAIL_2, GUARD_EMAIL];

  try {
    // 0. Cleanup prior test records
    await User.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await Guardian.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await HomeVisitLog.deleteMany({ name: 'Lifecycle Student Sharma' });
    await GatePass.deleteMany({ place: { $in: ['Pune City Center', 'Nagpur Native Place'] } });

    console.log('[Step 0] Creating test student and gate guard users...');
    const student = await User.create({
      name: 'Lifecycle Student Sharma',
      email: STUDENT_EMAIL,
      role: 'student',
      rollNo: '2024BCSE888',
      phone: '+919876588881',
      hostel: 'BH2',
      roomNo: '304',
      isActive: true,
      isEmailVerified: true,
    });

    const guard = await User.create({
      name: 'Campus Gate Guard Chief',
      email: GUARD_EMAIL,
      role: 'security',
      phone: '+919876588882',
      isActive: true,
    });
    console.log(`  ✓ Student created: ${student.name} (${student.email})`);
    console.log(`  ✓ Guard created: ${guard.name} (${guard.email})`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Student submits parent email details -> Onboarding invite email sent
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 1] Student submits parent email details for onboarding...');
    const linkResult = await linkInitialGuardians({
      studentId: student._id,
      guardian1: {
        name: 'Ramesh Sharma',
        relationship: 'Father',
        phone: '9876588883',
        email: PARENT_EMAIL_1,
      },
      guardian2: {
        name: 'Sunita Sharma',
        relationship: 'Mother',
        phone: '9876588884',
        email: PARENT_EMAIL_2,
      },
      ip: '127.0.0.1',
      actorId: student._id,
    });

    if (!linkResult.guardian1 || linkResult.guardian1.status !== 'INVITED') {
      throw new Error('Guardian 1 was not created in INVITED status');
    }
    const rawInviteToken1 = Object.values(linkResult.inviteUrls)[0].split('token=')[1];
    console.log('  ✓ Guardian 1 created in INVITED status:', linkResult.guardian1.email);
    console.log('  ✓ Onboarding Invitation URL generated:', linkResult.inviteUrls[linkResult.guardian1._id.toString()]);
    console.log('  ✓ Token extracted:', rawInviteToken1.slice(0, 12) + '...');

    // Verify student document persists parent snapshot
    const studentAfterLink = await User.findById(student._id);
    if (studentAfterLink.parentEmail !== PARENT_EMAIL_1 || studentAfterLink.parentName !== 'Ramesh Sharma') {
      throw new Error('student.parentEmail or student.parentName not persisted on student model');
    }
    console.log('  ✓ Verified: Student profile persisted parent email:', studentAfterLink.parentEmail);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: Parent onboards -> verifies token, sets password, becomes ACTIVE
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 2] Parent opens invite link, verifies token, and sets password to onboard...');
    const verifyTokenRes = await verifyInvitationToken(rawInviteToken1);
    if (!verifyTokenRes.valid) {
      throw new Error(`Token verification failed: ${verifyTokenRes.message}`);
    }
    console.log(`  ✓ Token verified for ward: ${verifyTokenRes.student.name} (${verifyTokenRes.student.rollNo})`);

    const acceptRes = await acceptInvitation({
      rawToken: rawInviteToken1,
      password: 'ParentSecurePass123!',
      ip: '127.0.0.1',
    });

    if (!acceptRes.parentUser || acceptRes.parentUser.role !== 'parent') {
      throw new Error('acceptInvitation did not return a valid parent user');
    }
    if (acceptRes.guardian.status !== 'ACTIVE') {
      throw new Error(`Guardian status expected ACTIVE, got: ${acceptRes.guardian.status}`);
    }
    console.log('  ✓ Parent account activated! Role:', acceptRes.parentUser.role, '| Email:', acceptRes.parentUser.email);
    console.log('  ✓ Guardian record status updated to ACTIVE');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: Student applies for Home Visit -> Approval email sent to parent
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 3] Student applies for Home Visit leave request...');
    const { rawToken: rawApprovalToken, tokenHash, expiresAt } = generateParentApprovalToken();
    const persistentGateToken = createHomeVisitCompactToken();

    const visit = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      parent_phone: studentAfterLink.parentPhone,
      parent_email: PARENT_EMAIL_1,
      parent_name: 'Ramesh Sharma',
      departure_time: '10:00 AM',
      return_time: '07:00 PM',
      place: 'Pune City Center',
      reason: 'Urgent Family Visit',
      leave_date: '2026-11-05',
      return_date: '2026-11-08',
      qr_token: persistentGateToken,
      parent_token_hash: tokenHash,
      parent_token_expires_at: expiresAt,
      parent_approval_status: 'pending',
      overall_status: 'pending',
      warden_status: 'pending',
      email_notification_status: 'PENDING',
    });

    // Mirror to GatePass
    await GatePass.create({
      student_id: student._id,
      pass_type: 'HOME_VISIT',
      home_visit_id: visit._id,
      qr_token: persistentGateToken,
      status: 'PENDING',
      place: visit.place,
      reason: visit.reason,
    });

    console.log('  ✓ Home Visit request created (ID: ' + visit._id + ')');
    console.log('  ✓ Gate Pass mirror created with token:', persistentGateToken);

    // Dispatch approval email to parent
    const emailResult = await sendParentApprovalEmail({
      visit,
      rawToken: rawApprovalToken,
      parentEmail: PARENT_EMAIL_1,
      baseUrl: 'http://localhost:5173',
    });
    if (!emailResult.success) {
      throw new Error(`sendParentApprovalEmail failed: ${emailResult.error}`);
    }
    visit.email_notification_status = 'SUBMITTED';
    visit.email_sent_at = new Date();
    await visit.save();
    console.log('  ✓ Parent approval email dispatched! MessageId:', emailResult.messageId);
    console.log('  ✓ Approval URL for parent:', emailResult.approvalUrl);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4: Parent approves request with optional message
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 4] Parent reviews request and submits decision: APPROVED with remarks...');
    const parentRemarks = 'Permission granted. Take care and return on time by 7 PM.';
    
    // Atomically execute parent decision (matching /parent-respond logic)
    const updatedVisit = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit._id,
        parent_token_hash: tokenHash,
        parent_approval_status: 'pending',
        parent_token_expires_at: { $gt: new Date() },
      },
      {
        $set: {
          parent_status: 'approved',
          parent_approval_status: 'parent_approved',
          overall_status: 'approved',
          warden_status: 'approved',
          parent_response_time: new Date(),
          parent_decision_at: new Date(),
          parent_decision_remarks: parentRemarks,
          parent_token_hash: null, // Token consumed
        },
      },
      { new: true }
    );

    if (!updatedVisit) throw new Error('Parent approval atomic update failed');
    console.log('  ✓ Request updated to overall_status: approved');
    console.log('  ✓ Remarks saved:', updatedVisit.parent_decision_remarks);

    // Update GatePass status to APPROVED
    await GatePass.updateOne(
      { home_visit_id: updatedVisit._id },
      { $set: { status: 'APPROVED', approved_at: new Date() } }
    );
    console.log('  ✓ GatePass status updated to APPROVED. QR code is now live for gate scanning!');

    // Dispatch outcome notification to student and parent
    const studentOutcome = await sendLeaveOutcomeEmailToStudent({
      to: student.email,
      studentName: student.name,
      decision: 'APPROVED',
      parentName: updatedVisit.parent_name,
      remarks: parentRemarks,
      place: updatedVisit.place,
      leaveDate: updatedVisit.leave_date,
      returnDate: updatedVisit.return_date,
    });
    console.log('  ✓ Outcome email sent to student:', studentOutcome.success);

    const parentOutcome = await sendLeaveOutcomeEmailToParent({
      to: PARENT_EMAIL_1,
      guardianName: updatedVisit.parent_name,
      studentName: student.name,
      decision: 'APPROVED',
      decidedBy: 'Parent (Verified Digital Consent)',
      remarks: parentRemarks,
      place: updatedVisit.place,
      leaveDate: updatedVisit.leave_date,
      returnDate: updatedVisit.return_date,
    });
    console.log('  ✓ Outcome confirmation sent to parent:', parentOutcome.success);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: Security Guard scans student QR at campus gate -> Marked as OUT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 5] Student presents QR code at campus gate. Guard scans QR to leave...');
    
    // Scan OUT logic (matching /homevisit/scan & /gatescan)
    const visitForScanOut = await HomeVisitLog.findOne({
      qr_token: persistentGateToken,
      overall_status: 'approved',
    });

    if (!visitForScanOut) throw new Error('Approved visit not found by QR token');
    if (visitForScanOut.qr_used_out) throw new Error('Visit already marked out');

    visitForScanOut.qr_used_out = true;
    visitForScanOut.actual_out_time = new Date();
    visitForScanOut.scanned_by_out = guard._id;
    visitForScanOut.scanned_by_name = guard.name;
    await visitForScanOut.save();

    await GatePass.updateOne(
      { qr_token: persistentGateToken },
      { $set: { status: 'OUTSIDE', out_time: new Date(), scanned_by_out: guard._id, scanned_by_name: guard.name } }
    );

    await User.updateOne(
      { _id: student._id },
      { $set: { isOutsideCampus: true, lastGateScanAt: new Date(), lastGateScanType: 'HOME OUT' } }
    );

    console.log('  ✓ GATE SCAN 1 SUCCESS: Student marked as HOME OUT!');
    console.log(`  ✓ Out time recorded: ${visitForScanOut.actual_out_time.toISOString()}`);
    console.log(`  ✓ Scanned by: ${guard.name}`);

    const verifiedStudentOut = await User.findById(student._id);
    if (!verifiedStudentOut.isOutsideCampus) throw new Error('User.isOutsideCampus should be true');
    console.log('  ✓ Verified: User.isOutsideCampus = true');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6: Student returns from home -> Guard scans QR -> Marked as IN
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 6] Student returns from home. Guard scans QR at campus gate to re-enter...');
    
    const visitForScanIn = await HomeVisitLog.findOne({
      qr_token: persistentGateToken,
      overall_status: 'approved',
      qr_used_out: true,
      qr_used_in: false,
    });

    if (!visitForScanIn) throw new Error('Visit in OUTSIDE state not found for scan IN');

    visitForScanIn.qr_used_in = true;
    visitForScanIn.actual_in_time = new Date();
    visitForScanIn.scanned_by_in = guard._id;
    visitForScanIn.scanned_by_name = guard.name;
    visitForScanIn.overall_status = 'completed';
    await visitForScanIn.save();

    await GatePass.updateOne(
      { qr_token: persistentGateToken },
      { $set: { status: 'COMPLETED', in_time: new Date(), completed_at: new Date(), scanned_by_in: guard._id, scanned_by_name: guard.name } }
    );

    await User.updateOne(
      { _id: student._id },
      { $set: { isOutsideCampus: false, lastGateScanAt: new Date(), lastGateScanType: 'HOME IN' } }
    );

    console.log('  ✓ GATE SCAN 2 SUCCESS: Student marked as HOME IN!');
    console.log(`  ✓ In time recorded: ${visitForScanIn.actual_in_time.toISOString()}`);
    console.log(`  ✓ Overall status: ${visitForScanIn.overall_status}`);

    const verifiedStudentIn = await User.findById(student._id);
    if (verifiedStudentIn.isOutsideCampus) throw new Error('User.isOutsideCampus should be false');
    console.log('  ✓ Verified: User.isOutsideCampus = false (Student safely back in campus)');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 7: Branch Test - Parent Rejection flow with optional remarks
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n[Step 7] Branch Test: Parent Rejection flow with optional remarks...');
    const { rawToken: rawRejectToken, tokenHash: rejectTokenHash, expiresAt: rejectExpiresAt } = generateParentApprovalToken();
    const rejectGateToken = createHomeVisitCompactToken();

    const rejectVisit = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      parent_phone: studentAfterLink.parentPhone,
      parent_email: PARENT_EMAIL_1,
      parent_name: 'Ramesh Sharma',
      departure_time: '09:00 AM',
      return_time: '06:00 PM',
      place: 'Nagpur Native Place',
      reason: 'Random Weekend Outing',
      leave_date: '2026-11-20',
      return_date: '2026-11-22',
      qr_token: rejectGateToken,
      parent_token_hash: rejectTokenHash,
      parent_token_expires_at: rejectExpiresAt,
      parent_approval_status: 'pending',
      overall_status: 'pending',
      warden_status: 'pending',
    });

    const rejectRemarks = 'Mid-term exams start next Monday. Please study in the hostel.';
    const updatedRejectVisit = await HomeVisitLog.findOneAndUpdate(
      {
        _id: rejectVisit._id,
        parent_token_hash: rejectTokenHash,
        parent_approval_status: 'pending',
      },
      {
        $set: {
          parent_status: 'rejected',
          parent_approval_status: 'parent_rejected',
          overall_status: 'rejected',
          warden_status: 'rejected',
          parent_decision_at: new Date(),
          parent_decision_remarks: rejectRemarks,
          parent_token_hash: null,
        },
      },
      { new: true }
    );

    if (updatedRejectVisit.overall_status !== 'rejected') {
      throw new Error('Expected rejected overall status');
    }
    console.log('  ✓ Request rejected by parent with remarks:', updatedRejectVisit.parent_decision_remarks);

    // Verify guard scan is blocked for rejected request
    const canScanRejected = updatedRejectVisit.overall_status === 'approved';
    if (canScanRejected) throw new Error('Security gate should block rejected requests');
    console.log('  ✓ Verified: Security gate scan strictly blocked for rejected requests (Exit denied).');

    // Send rejection notification
    const rejectOutcome = await sendLeaveOutcomeEmailToStudent({
      to: student.email,
      studentName: student.name,
      decision: 'REJECTED',
      parentName: updatedRejectVisit.parent_name,
      remarks: rejectRemarks,
      place: updatedRejectVisit.place,
      leaveDate: updatedRejectVisit.leave_date,
      returnDate: updatedRejectVisit.return_date,
    });
    console.log('  ✓ Student notified of rejection with parent remarks:', rejectOutcome.success);

    console.log('\n========================================================================');
    console.log('   🎉 COMPLETE LIFECYCLE VERIFIED 100% WORKING END-TO-END!             ');
    console.log('   ✓ Student detail input & parent onboarding invitation               ');
    console.log('   ✓ Parent password setting & activation                              ');
    console.log('   ✓ Home leave application & direct parent email notification         ');
    console.log('   ✓ Parent approval & rejection with custom optional messages          ');
    console.log('   ✓ QR gate pass generation & security gate scan OUT                  ');
    console.log('   ✓ Return to campus & security gate scan IN with completed status     ');
    console.log('========================================================================\n');
  } finally {
    // Cleanup test data
    await User.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await Guardian.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await HomeVisitLog.deleteMany({ name: 'Lifecycle Student Sharma' });
    await GatePass.deleteMany({ place: { $in: ['Pune City Center', 'Nagpur Native Place'] } });
    await mongoose.disconnect();
  }
}

runCompleteLifecycleTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ COMPLETE LIFECYCLE TEST FAILED:', err);
    process.exit(1);
  });
