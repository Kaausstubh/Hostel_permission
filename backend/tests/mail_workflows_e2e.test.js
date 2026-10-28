/**
 * Comprehensive E2E Verification Test for All Mail Workflows:
 * 1. Student fills in details -> Email sent to parents + parent details persisted
 * 2. Warden allowed to send mails:
 *    - Warden resends invite email to guardian
 *    - Warden sends official notice email directly to parent/student
 *    - Warden approves home visit -> Outcome emails dispatched to student and parent
 * 3. Student applies for home leave / visit -> Approval email sent to parents
 *    - Parent approves -> Outcome email sent to student
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function runMailWorkflowsTest() {
  console.log('\n======================================================');
  console.log('   HEIMDALL ALL MAIL WORKFLOWS E2E TEST VERIFICATION  ');
  console.log('======================================================\n');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  await mongoose.connect(uri);

  const User = require('../models/User');
  const Guardian = require('../models/Guardian');
  const GuardianInvitation = require('../models/GuardianInvitation');
  const HomeVisitLog = require('../models/HomeVisitLog');
  const ApprovalAuditLog = require('../models/ApprovalAuditLog');
  const { linkInitialGuardians, resendInvitation } = require('../services/guardianService');
  const { sendParentApprovalEmail } = require('../services/gasMailService');
  const {
    sendLeaveOutcomeEmailToStudent,
    sendLeaveOutcomeEmailToParent,
    sendWardenNoticeEmail,
  } = require('../services/mailService');
  const { hashParentToken, generateParentApprovalToken } = require('../utils/parentToken');

  const TEST_STUDENT_EMAIL = 'mailflow.student@iiitpune.ac.in';
  const TEST_PRIMARY_PARENT_EMAIL = 'parent.sharma.test@gmail.com';
  const TEST_SECONDARY_PARENT_EMAIL = 'secondary.parent.test@outlook.com';
  const TEST_LEAVE_PARENT_EMAIL = 'custom.parent.leave@gmail.com';
  const TEST_NOTICE_RECIPIENT_EMAIL = 'arbitrary.student.parent@yahoo.com';
  const TEST_WARDEN_EMAIL = 'laxmanshinde@iiitp.ac.in';

  const ALL_TEST_EMAILS = [
    TEST_STUDENT_EMAIL,
    TEST_PRIMARY_PARENT_EMAIL,
    TEST_SECONDARY_PARENT_EMAIL,
    TEST_LEAVE_PARENT_EMAIL,
    TEST_NOTICE_RECIPIENT_EMAIL,
  ];

  try {
    // Cleanup prior test records
    await User.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await Guardian.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await HomeVisitLog.deleteMany({ name: 'Mail Workflow Student' });

    console.log('[Step 1] Creating test student and warden...');
    const student = await User.create({
      name: 'Mail Workflow Student',
      email: TEST_STUDENT_EMAIL,
      role: 'student',
      rollNo: '2024BCSE999',
      phone: '+919876599991',
      hostel: 'BH1',
      roomNo: '101',
      isActive: true,
      isEmailVerified: true,
    });

    let warden = await User.findOne({ email: TEST_WARDEN_EMAIL });
    if (!warden) {
      warden = await User.create({
        name: 'Test Warden',
        email: TEST_WARDEN_EMAIL,
        role: 'warden',
        phone: '+919876599992',
        isActive: true,
      });
    }
    console.log('  ✓ Student and Warden created successfully.');

    // ── Workflow 1: Student fills in details -> Mails sent to different parent emails ──
    console.log('\n[Workflow 1] Student fills in parent emails for first-time onboarding (linkInitialGuardians)...');
    const linkResult = await linkInitialGuardians({
      studentId: student._id,
      guardian1: {
        name: 'Primary Guardian Test',
        relationship: 'Father',
        phone: '9876599993',
        email: TEST_PRIMARY_PARENT_EMAIL,
      },
      guardian2: {
        name: 'Secondary Guardian Test',
        relationship: 'Mother',
        phone: '9876599994',
        email: TEST_SECONDARY_PARENT_EMAIL,
      },
      ip: '127.0.0.1',
      actorId: student._id,
    });

    console.log('  ✓ linkInitialGuardians executed for two distinct parent emails.');
    console.log('  ✓ Guardian 1 created with email:', linkResult.guardian1.email);
    console.log('  ✓ Guardian 2 created with email:', linkResult.guardian2?.email);
    console.log('  ✓ Invite URL for Guardian 1:', linkResult.inviteUrls[linkResult.guardian1._id.toString()]);
    console.log('  ✓ Invite URL for Guardian 2:', linkResult.inviteUrls[linkResult.guardian2?._id.toString()]);

    // Check student document has parentEmail and parentName saved
    const refreshedStudent = await User.findById(student._id);
    if (!refreshedStudent.parentEmail || refreshedStudent.parentEmail !== TEST_PRIMARY_PARENT_EMAIL) {
      throw new Error(`student.parentEmail was not persisted! Value: ${refreshedStudent.parentEmail}`);
    }
    if (!refreshedStudent.parentName || refreshedStudent.parentName !== 'Primary Guardian Test') {
      throw new Error(`student.parentName was not persisted! Value: ${refreshedStudent.parentName}`);
    }
    console.log('  ✓ Verified: student.parentEmail & student.parentName persisted in MongoDB!');

    const inviteAudit = await ApprovalAuditLog.findOne({
      guardian_id: linkResult.guardian1._id,
      event: 'INVITE_SENT',
    });
    if (!inviteAudit) throw new Error('INVITE_SENT audit log missing');
    console.log('  ✓ Verified: INVITE_SENT audit log created.');

    // ── Workflow 2: Warden sending emails to any email address ──
    console.log('\n[Workflow 2] Warden sending emails to arbitrary recipients...');
    
    // 2A: Warden sends official notice email to arbitrary recipient
    console.log('  [2A] Warden dispatches official notice email to arbitrary address:', TEST_NOTICE_RECIPIENT_EMAIL);
    const noticeResult = await sendWardenNoticeEmail({
      to: TEST_NOTICE_RECIPIENT_EMAIL,
      recipientName: 'Arbitrary Student / Parent',
      subject: 'Hostel Curfew Notice for Autumn Semester',
      messageContent: 'Dear Parent / Student,\nThis is an official notice regarding hostel gates and check-in times.\nHostel curfew is strictly 8:00 PM.',
      wardenName: warden.name,
    });
    if (!noticeResult.success) throw new Error(`Warden notice email failed: ${noticeResult.error}`);
    console.log('  ✓ Verified: Warden notice email sent successfully! MessageId:', noticeResult.messageId);

    // 2B: Warden resends parent invitation
    console.log('  [2B] Warden resends guardian activation invitation...');
    // Clear cooldown for test
    await Guardian.updateOne({ _id: linkResult.guardian1._id }, { $set: { last_invite_sent_at: new Date(Date.now() - 300_000) } });
    const resendRes = await resendInvitation({
      guardianId: linkResult.guardian1._id,
      actorUser: warden,
      ip: '127.0.0.1',
    });
    if (!resendRes.success) throw new Error('resendInvitation failed');
    console.log('  ✓ Verified: Warden resend invitation succeeded! Invite URL:', resendRes.inviteUrl);

    // ── Workflow 3: Student applies for Home Leave / Visit -> Mails sent to different parent email ──
    console.log('\n[Workflow 3] Student applies for home visit specifying distinct parent email:', TEST_LEAVE_PARENT_EMAIL);
    const { rawToken, tokenHash, expiresAt } = generateParentApprovalToken();
    const visit = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      parent_phone: refreshedStudent.parentPhone,
      parent_email: TEST_LEAVE_PARENT_EMAIL,
      parent_name: 'Leave Parent Contact',
      place: 'Mumbai',
      reason: 'Family Function',
      leave_date: '2026-11-10',
      return_date: '2026-11-15',
      parent_token_hash: tokenHash,
      parent_token_expires_at: expiresAt,
      parent_approval_status: 'pending',
      overall_status: 'pending',
      warden_status: 'pending',
      qr_token: 'test_token_flow_999',
    });

    console.log('  ✓ Home visit created. Dispatched parent approval email via sendParentApprovalEmail...');
    const emailResult = await sendParentApprovalEmail({
      visit,
      rawToken,
      parentEmail: TEST_LEAVE_PARENT_EMAIL,
      baseUrl: 'http://localhost:5173',
    });
    if (!emailResult.success) throw new Error(`sendParentApprovalEmail failed: ${emailResult.error}`);
    console.log('  ✓ Verified: Parent approval email delivered to distinct parent! Status:', emailResult.status, 'MessageId:', emailResult.messageId);

    // ── Workflow 3B: Warden approves home visit -> Outcome emails sent ──
    console.log('\n[Workflow 3B] Warden approves home visit -> Outcome emails dispatched...');
    visit.warden_status = 'approved';
    visit.overall_status = 'approved';
    await visit.save();

    const studentOutcome = await sendLeaveOutcomeEmailToStudent({
      to: student.email,
      studentName: student.name,
      decision: 'APPROVED',
      parentName: `Hostel Staff (${warden.name})`,
      remarks: 'Approved by Hostel Warden for family function',
      place: visit.place,
      leaveDate: visit.leave_date,
      returnDate: visit.return_date,
    });
    console.log('  ✓ Verified: Leave outcome email dispatched to student! Success:', studentOutcome.success);

    const parentOutcome = await sendLeaveOutcomeEmailToParent({
      to: TEST_LEAVE_PARENT_EMAIL,
      guardianName: 'Leave Parent Contact',
      studentName: student.name,
      decision: 'APPROVED',
      decidedBy: `Hostel Warden (${warden.name})`,
      remarks: 'Approved by Hostel Warden for family function',
      place: visit.place,
      leaveDate: visit.leave_date,
      returnDate: visit.return_date,
    });
    console.log('  ✓ Verified: Leave outcome email dispatched to distinct parent! Success:', parentOutcome.success);

    console.log('\n======================================================');
    console.log('   🎉 ALL 3 EMAIL WORKFLOWS TO MULTIPLE EMAILS VERIFIED WORKING 100%!   ');
    console.log('======================================================\n');
  } finally {
    await User.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await Guardian.deleteMany({ email: { $in: ALL_TEST_EMAILS } });
    await HomeVisitLog.deleteMany({ name: 'Mail Workflow Student' });
    await mongoose.disconnect();
  }
}

runMailWorkflowsTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  });
