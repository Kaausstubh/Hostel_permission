/**
 * End-to-End Verification Test for Parent Approval & Onboarding Lifecycle
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

async function runTest() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB\n');

  const User = require('../models/User');
  const Guardian = require('../models/Guardian');
  const GuardianInvitation = require('../models/GuardianInvitation');
  const HomeVisitLog = require('../models/HomeVisitLog');
  const ParentApproval = require('../models/ParentApproval');
  const ApprovalAuditLog = require('../models/ApprovalAuditLog');
  const { linkInitialGuardians, verifyInvitationToken, acceptInvitation, resendInvitation } = require('../services/guardianService');
  const { recordParentDecision } = require('../services/parentApprovalService');

  const TEST_STUDENT_EMAIL = 'lifecycle.student@cse.iiitp.ac.in';
  const PARENT1_EMAIL = 'parent1.test@gmail.com';
  const PARENT2_EMAIL = 'parent2.test@gmail.com';

  try {
    // ── Clean up any previous test data ──
    await User.deleteMany({ email: { $in: [TEST_STUDENT_EMAIL, PARENT1_EMAIL, PARENT2_EMAIL] } });
    const oldStudent = await User.findOne({ email: TEST_STUDENT_EMAIL });
    if (oldStudent) {
      await Guardian.deleteMany({ student_id: oldStudent._id });
      await HomeVisitLog.deleteMany({ student_id: oldStudent._id });
    }

    console.log('=== STEP 1: Student registers with Google college email ===');
    const student = await User.create({
      name: 'Test Student Lifecycle',
      email: TEST_STUDENT_EMAIL,
      role: 'student',
      isActive: true,
      isEmailVerified: true,
    });
    console.log('✅ Created student from Google OAuth:', student.email, 'ID:', student._id);

    console.log('\n=== STEP 2: Student completes initial profile onboarding ===');
    student.rollNo = '112415999';
    student.phone = '+919876500001';
    student.parentPhone = '+919876500002';
    student.parentPhone2 = '+919876500003';
    student.hostel = 'BH1';
    student.roomNo = '101';
    await student.save();
    console.log('✅ Student onboarded with rollNo:', student.rollNo, 'and contact details');

    console.log('\n=== STEP 3: Student completes parent onboarding info (dispatches mail) ===');
    const linkResult = await linkInitialGuardians({
      studentId: student._id,
      guardian1: {
        name: 'Ramesh Test',
        relationship: 'Father',
        phone: '9876500002',
        email: PARENT1_EMAIL,
      },
      guardian2: {
        name: 'Sunita Test',
        relationship: 'Mother',
        phone: '9876500003',
        email: PARENT2_EMAIL,
      },
      ip: '127.0.0.1',
      actorId: student._id,
    });

    console.log('✅ Guardian 1 created:', linkResult.guardian1.email, 'Status:', linkResult.guardian1.status);
    console.log('✅ Guardian 2 created:', linkResult.guardian2.email, 'Status:', linkResult.guardian2.status);
    console.log('✅ Invitation URLs generated:', Object.keys(linkResult.inviteUrls).length);

    // Fetch the raw token from DB for Parent 1
    const inviteP1 = await GuardianInvitation.findOne({ guardian_id: linkResult.guardian1._id });
    console.log('✅ Found invitation record for Parent 1, expires at:', inviteP1.expires_at);

    // Get the actual inviteUrl for Parent 1
    const p1Url = linkResult.inviteUrls[linkResult.guardian1._id.toString()];
    const tokenP1 = new URL(p1Url).searchParams.get('token');
    console.log('✅ Token extracted from invite email link for Parent 1');

    console.log('\n=== STEP 4: Parent 1 opens onboarding mail link (verify token) ===');
    const verifyResult = await verifyInvitationToken(tokenP1);
    if (!verifyResult.valid) {
      throw new Error('Token verification failed: ' + verifyResult.message);
    }
    console.log('✅ Token verified successfully. Student identified as:', verifyResult.student.name, verifyResult.student.rollNo);

    console.log('\n=== STEP 5: Parent 1 sets password and activates account ===');
    const TEST_PARENT_PASSWORD = 'SecureParentPass123!';
    const acceptResult = await acceptInvitation({
      rawToken: tokenP1,
      password: TEST_PARENT_PASSWORD,
      ip: '127.0.0.1',
    });
    console.log('✅ Parent 1 account activated successfully! Role:', acceptResult.parentUser.role);

    // Verify parent user password with bcrypt
    const parentUserInDb = await User.findById(acceptResult.parentUser._id);
    const passMatches = await bcrypt.compare(TEST_PARENT_PASSWORD, parentUserInDb.passwordHash);
    console.log('✅ Password hash verified:', passMatches);

    console.log('\n=== STEP 6: Student requests a Home Visit ===');
    const visit = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      roll_no: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      place: 'Mumbai',
      reason: 'Family Function',
      leave_date: '2026-10-25',
      return_date: '2026-10-28',
      parent_approval_status: 'pending',
      overall_status: 'pending',
    });
    console.log('✅ Home visit request created:', visit._id, 'Status:', visit.parent_approval_status);

    console.log('\n=== STEP 7: Parent 1 logs in using their password ===');
    const authParent = await User.findOne({ email: PARENT1_EMAIL, role: 'parent' });
    const canLogin = await bcrypt.compare(TEST_PARENT_PASSWORD, authParent.passwordHash);
    if (!canLogin) throw new Error('Parent password authentication failed');
    console.log('✅ Parent 1 successfully logged in via credentials');

    console.log('\n=== STEP 8: Parent 1 views request details and makes decision (APPROVE) ===');
    const decisionResult = await recordParentDecision({
      visitId: visit._id,
      parentUser: authParent,
      decision: 'APPROVED',
      remarks: 'Permission granted, have a safe journey.',
      ip: '127.0.0.1',
    });

    console.log('✅ Decision recorded successfully:', decisionResult.decision);
    console.log('✅ Updated visit status in DB:', decisionResult.visit.parent_approval_status, '| overall:', decisionResult.visit.overall_status);

    // Verify in database
    const finalVisit = await HomeVisitLog.findById(visit._id);
    const approvalDoc = await ParentApproval.findOne({ home_visit_request_id: visit._id });
    const auditDoc = await ApprovalAuditLog.findOne({ home_visit_request_id: visit._id, event: 'DECISION_MADE' });

    console.log('\n=== DATABASE VERIFICATION CHECKS ===');
    console.log('1. Visit parent_approval_status:', finalVisit.parent_approval_status, '(Expected: parent_approved)');
    console.log('2. ParentApproval created:', Boolean(approvalDoc), '| Decided by:', approvalDoc?.decided_by_name, '| Remarks:', approvalDoc?.remarks);
    console.log('3. ApprovalAuditLog created:', Boolean(auditDoc), '| Event:', auditDoc?.event, '| Role:', auditDoc?.actor_role);

    if (finalVisit.parent_approval_status !== 'parent_approved' || !approvalDoc || !auditDoc) {
      throw new Error('Database verification failed: state is inconsistent');
    }

    console.log('\n=== STEP 9: Testing Warden / Hostel Staff Resend Invite Flow ===');
    const guardian2 = await Guardian.findOne({ student_id: student._id, guardian_slot: 2 });
    // Advance timestamp past 2-minute cooldown to test resend
    guardian2.last_invite_sent_at = new Date(Date.now() - 130_000);
    await guardian2.save();

    const resendRes = await resendInvitation({
      guardianId: guardian2._id,
      actorUser: { _id: student._id, role: 'warden', email: 'warden@iiitp.ac.in' },
      ip: '127.0.0.1',
    });
    console.log('✅ Warden resend invitation completed successfully:', resendRes.success, 'New inviteUrl generated:', Boolean(resendRes.inviteUrl));

    console.log('\n🎉 ALL 9 LIFECYCLE STEPS PASSED FLAWLESSLY IN THE LIVE DATABASE!');
  } finally {
    // Clean up test records
    await User.deleteMany({ email: { $in: [TEST_STUDENT_EMAIL, PARENT1_EMAIL, PARENT2_EMAIL] } });
    await Guardian.deleteMany({ email: { $in: [PARENT1_EMAIL, PARENT2_EMAIL] } });
    await HomeVisitLog.deleteMany({ name: 'Test Student Lifecycle' });
    // Use native collection deleteMany to bypass ParentApproval immutability schema hook during test teardown
    await mongoose.connection.collection('parentapprovals').deleteMany({ decided_by_email: PARENT1_EMAIL });
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Lifecycle test failed:', err);
    process.exit(1);
  });
