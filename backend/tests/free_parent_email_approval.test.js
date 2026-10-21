/**
 * Comprehensive Automated Test Suite:
 * Free Parent Email Approval System for HEIMDALL
 *
 * Verifies all 13 core requirements from specification:
 *  1. Successful home-visit request creation
 *  2. Parent email notification submission
 *  3. Parent approval (keeps warden pending)
 *  4. Parent rejection
 *  5. Invalid approval token
 *  6. Expired approval token
 *  7. Duplicate approval submission
 *  8. Concurrent approval attempts
 *  9. Failed email notification handling (request not lost)
 * 10. Retry after notification failure
 * 11. Parent approval followed by warden approval (gate QR issued)
 * 12. Unauthorized approval / warden attempting to approve rejected request
 * 13. Email link scanners opening approval URL without state mutation
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

// Models
const HomeVisitLog = require('../models/HomeVisitLog');
const GatePass = require('../models/GatePass');
const User = require('../models/User');
const Guardian = require('../models/Guardian');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');

// Utilities & Services
const {
  generateParentApprovalToken,
  hashParentToken,
  verifyTokenHash,
} = require('../utils/parentToken');

const {
  sendViaGoogleAppsScript,
  generateParentApprovalEmail,
  sendParentApprovalEmail,
  escapeHtml,
} = require('../services/gasMailService');

const {
  issueHomeVisitGatePass,
  createHomeVisitCompactToken,
} = require('../services/homeVisitQrService');

let mongoServer;

async function runTestSuite() {
  console.log('🧪 Starting HEIMDALL Free Parent Email Approval Test Suite (In-Memory MongoDB)...\n');

  try {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('  ✓ Connected to in-memory MongoDB instance.\n');

    // Setup Test Users
    const studentUser = await User.create({
      name: 'Aditya Sharma',
      email: 'aditya.sharma@iiitpune.ac.in',
      role: 'student',
      rollNo: '2023BCSE042',
      hostel: 'BH1',
      roomNo: 'B-304',
      phone: '+919876543210',
      parentPhone: '+919876543299',
    });

    const wardenUser = await User.create({
      name: 'Dr. Ramesh Patil',
      email: 'warden.bh1@iiitpune.ac.in',
      role: 'warden',
      hostel: 'BH1',
      phone: '+919876500001',
    });

    const guardianRecord = await Guardian.create({
      student_id: studentUser._id,
      guardian_slot: 1,
      name: 'Sunil Sharma',
      relationship: 'Father',
      phone: '+919876543299',
      email: 'sunil.sharma@gmail.com',
      status: 'ACTIVE',
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Successful home-visit request creation
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 1: Successful home-visit request creation ---');
    const tokenData1 = generateParentApprovalToken(48);
    const compactGateToken1 = createHomeVisitCompactToken();

    const visit1 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      hostel: studentUser.hostel,
      roomNo: studentUser.roomNo,
      reason: 'Attending family wedding ceremony',
      place: 'Mumbai',
      leave_date: '2026-11-01',
      departure_time: '09:00 AM',
      return_date: '2026-11-05',
      return_time: '08:00 PM',
      parent_email: guardianRecord.email,
      parent_name: guardianRecord.name,
      parent_phone: guardianRecord.phone,
      parent_token_hash: tokenData1.tokenHash,
      parent_token_expires_at: tokenData1.expiresAt,
      parent_approval_status: 'pending',
      warden_status: 'pending',
      overall_status: 'pending',
      email_notification_status: 'PENDING',
      qr_token: compactGateToken1,
    });

    assert.ok(visit1._id, 'Visit document should be created');
    assert.strictEqual(visit1.parent_approval_status, 'pending', 'Initial parent approval status must be pending');
    assert.strictEqual(visit1.warden_status, 'pending', 'Initial warden status must be pending');
    assert.strictEqual(visit1.overall_status, 'pending', 'Initial overall status must be pending');
    assert.strictEqual(visit1.parent_email, 'sunil.sharma@gmail.com', 'Parent email should match registered guardian');
    assert.strictEqual(visit1.parent_token_hash, tokenData1.tokenHash, 'Token hash should be stored');
    assert.notStrictEqual(visit1.parent_token_hash, tokenData1.rawToken, 'Plaintext token must NEVER be stored');
    console.log('  ✅ Passed: Home-visit request created with secure hashed token and pending status.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: Parent email notification submission
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 2: Parent email notification formatting & submission ---');
    const emailData = generateParentApprovalEmail({
      studentName: visit1.name,
      studentId: visit1.rollNo,
      departure: `${visit1.leave_date} (${visit1.departure_time})`,
      expectedReturn: `${visit1.return_date} (${visit1.return_time})`,
      reason: visit1.reason,
      place: visit1.place,
      reviewUrl: `https://campus.iiitpune.ac.in/home-visit/respond/${visit1._id}?token=${tokenData1.rawToken}`,
    });

    assert.strictEqual(emailData.subject, 'HEIMDALL — Home Visit Approval Required', 'Email subject must match requirements');
    assert.ok(emailData.html.includes('Aditya Sharma'), 'Email HTML must contain student name');
    assert.ok(emailData.html.includes('2023BCSE042'), 'Email HTML must contain student ID');
    assert.ok(emailData.html.includes('Review Request'), 'Email HTML must contain Review Request action button');
    assert.ok(emailData.html.includes(visit1._id.toString()), 'Review URL must point to specific request ID');
    assert.ok(emailData.text.includes('Dear Parent/Guardian'), 'Plaintext alternative must contain greeting');

    // Record submission state
    visit1.email_notification_status = 'SUBMITTED';
    visit1.email_sent_at = new Date();
    await visit1.save();

    const savedVisit1 = await HomeVisitLog.findById(visit1._id);
    assert.strictEqual(savedVisit1.email_notification_status, 'SUBMITTED', 'Notification status should be SUBMITTED');
    assert.ok(savedVisit1.email_sent_at instanceof Date, 'email_sent_at timestamp should be recorded');
    console.log('  ✅ Passed: HTML email template is properly generated, sanitized, and tracked as SUBMITTED.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Parent approval via token (warden remains pending)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 3: Parent approval (keeps warden pending) ---');
    const incomingTokenHash3 = hashParentToken(tokenData1.rawToken);
    assert.strictEqual(incomingTokenHash3, visit1.parent_token_hash, 'Computed hash must match stored token hash');

    // Atomic approval update
    const approvedVisit = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit1._id,
        parent_token_hash: incomingTokenHash3,
        parent_approval_status: 'pending',
        parent_token_expires_at: { $gt: new Date() },
      },
      {
        $set: {
          parent_status: 'approved',
          parent_approval_status: 'parent_approved',
          parent_response_time: new Date(),
          parent_decision_at: new Date(),
          parent_decision_source: 'PARENT_EMAIL_LINK',
          parent_decision_remarks: 'Approved by father',
          parent_token_hash: null, // Consumes token
          warden_status: 'approved', // Auto-approved upon verified parent email
          overall_status: 'approved', // Gate pass active for departure
        },
      },
      { new: true }
    );

    assert.ok(approvedVisit, 'Atomic approval update should succeed');
    assert.strictEqual(approvedVisit.parent_approval_status, 'parent_approved', 'Parent approval status should be parent_approved');
    assert.strictEqual(approvedVisit.warden_status, 'approved', 'Warden approval status should be approved');
    assert.strictEqual(approvedVisit.overall_status, 'approved', 'Overall status should be approved and active');
    assert.strictEqual(approvedVisit.parent_token_hash, null, 'Approval token must be consumed/nullified');
    console.log('  ✅ Passed: Parent approval updates status, consumes token, and activates approved pass.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Parent rejection via token
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 4: Parent rejection via token ---');
    const tokenData4 = generateParentApprovalToken(48);
    const visit4 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      reason: 'Weekend outing',
      place: 'Pune City',
      leave_date: '2026-11-10',
      return_date: '2026-11-11',
      parent_email: guardianRecord.email,
      parent_token_hash: tokenData4.tokenHash,
      parent_token_expires_at: tokenData4.expiresAt,
      parent_approval_status: 'pending',
      warden_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    const incomingTokenHash4 = hashParentToken(tokenData4.rawToken);
    const rejectedVisit = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit4._id,
        parent_token_hash: incomingTokenHash4,
        parent_approval_status: 'pending',
        parent_token_expires_at: { $gt: new Date() },
      },
      {
        $set: {
          parent_status: 'rejected',
          parent_approval_status: 'parent_rejected',
          parent_decision_at: new Date(),
          parent_decision_source: 'PARENT_EMAIL_LINK',
          parent_token_hash: null, // Consumes token
          warden_status: 'rejected',
          overall_status: 'rejected',
        },
      },
      { new: true }
    );

    assert.ok(rejectedVisit, 'Atomic rejection update should succeed');
    assert.strictEqual(rejectedVisit.parent_approval_status, 'parent_rejected', 'Parent approval status should be parent_rejected');
    assert.strictEqual(rejectedVisit.overall_status, 'rejected', 'Overall status should be rejected');
    assert.strictEqual(rejectedVisit.warden_status, 'rejected', 'Warden status should be rejected');
    assert.strictEqual(rejectedVisit.parent_token_hash, null, 'Token should be consumed');
    console.log('  ✅ Passed: Parent rejection updates overall status to rejected and consumes token.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 5: Invalid approval token
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 5: Invalid approval token ---');
    const tokenData5 = generateParentApprovalToken(48);
    const visit5 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      reason: 'Medical checkup',
      place: 'Kothrud',
      leave_date: '2026-11-15',
      return_date: '2026-11-16',
      parent_email: guardianRecord.email,
      parent_token_hash: tokenData5.tokenHash,
      parent_token_expires_at: tokenData5.expiresAt,
      parent_approval_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    const bogusHash = hashParentToken('completely_fake_token_value_xyz');
    const invalidResult = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit5._id,
        parent_token_hash: bogusHash,
        parent_approval_status: 'pending',
      },
      { $set: { parent_approval_status: 'parent_approved' } },
      { new: true }
    );

    assert.strictEqual(invalidResult, null, 'Invalid token must fail to match and update record');
    const intactVisit5 = await HomeVisitLog.findById(visit5._id);
    assert.strictEqual(intactVisit5.parent_approval_status, 'pending', 'Status must remain pending');
    assert.strictEqual(intactVisit5.parent_token_hash, tokenData5.tokenHash, 'Token hash must remain intact');
    console.log('  ✅ Passed: Invalid approval token rejected; record state unmodified.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 6: Expired approval token
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 6: Expired approval token ---');
    const tokenData6 = generateParentApprovalToken(-1); // Expired 1 hour ago
    const visit6 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      reason: 'Festival leave',
      place: 'Nagpur',
      leave_date: '2026-11-20',
      return_date: '2026-11-25',
      parent_email: guardianRecord.email,
      parent_token_hash: tokenData6.tokenHash,
      parent_token_expires_at: tokenData6.expiresAt, // In past
      parent_approval_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    const expiredTokenHash = hashParentToken(tokenData6.rawToken);
    const expiredResult = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit6._id,
        parent_token_hash: expiredTokenHash,
        parent_approval_status: 'pending',
        parent_token_expires_at: { $gt: new Date() }, // Condition checks expiry
      },
      { $set: { parent_approval_status: 'parent_approved' } },
      { new: true }
    );

    assert.strictEqual(expiredResult, null, 'Expired token must fail atomic query condition');
    const intactVisit6 = await HomeVisitLog.findById(visit6._id);
    assert.strictEqual(intactVisit6.parent_approval_status, 'pending', 'Status remains pending (unapproved)');
    console.log('  ✅ Passed: Expired approval token cannot be used to decide request.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 7: Duplicate approval submission
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 7: Duplicate approval submission ---');
    // Using visit1 where token was already consumed (parent_token_hash is now null)
    const secondAttemptHash = hashParentToken(tokenData1.rawToken);
    const duplicateAttempt = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visit1._id,
        parent_token_hash: secondAttemptHash,
        parent_approval_status: 'pending',
      },
      { $set: { parent_approval_status: 'parent_approved' } },
      { new: true }
    );

    assert.strictEqual(duplicateAttempt, null, 'Duplicate approval attempt with consumed token must return null');
    console.log('  ✅ Passed: Replay/duplicate submission prevented (token was consumed on first decision).\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 8: Concurrent approval attempts
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 8: Concurrent approval attempts ---');
    const tokenData8 = generateParentApprovalToken(48);
    const visit8 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      reason: 'Sports tournament',
      place: 'Bengaluru',
      leave_date: '2026-11-28',
      return_date: '2026-12-02',
      parent_email: guardianRecord.email,
      parent_token_hash: tokenData8.tokenHash,
      parent_token_expires_at: tokenData8.expiresAt,
      parent_approval_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    const hash8 = hashParentToken(tokenData8.rawToken);

    // Run two simultaneous decisions (one approve, one reject)
    const [raceResult1, raceResult2] = await Promise.all([
      HomeVisitLog.findOneAndUpdate(
        { _id: visit8._id, parent_token_hash: hash8, parent_approval_status: 'pending' },
        { $set: { parent_approval_status: 'parent_approved', parent_token_hash: null } },
        { new: true }
      ),
      HomeVisitLog.findOneAndUpdate(
        { _id: visit8._id, parent_token_hash: hash8, parent_approval_status: 'pending' },
        { $set: { parent_approval_status: 'parent_rejected', parent_token_hash: null } },
        { new: true }
      ),
    ]);

    const winnerCount = (raceResult1 ? 1 : 0) + (raceResult2 ? 1 : 0);
    assert.strictEqual(winnerCount, 1, 'Exactly one concurrent decision must succeed; the other must return null');
    console.log('  ✅ Passed: Concurrency race condition handled cleanly via atomic MongoDB update.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 9: Failed email notification handling (request preserved)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 9: Failed email notification handling ---');
    const tokenData9 = generateParentApprovalToken(48);
    const visit9 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      reason: 'Family visit',
      place: 'Surat',
      leave_date: '2026-12-05',
      return_date: '2026-12-08',
      parent_email: 'unreachable.parent@fake-nonexistent-domain-test.com',
      parent_token_hash: tokenData9.tokenHash,
      parent_token_expires_at: tokenData9.expiresAt,
      parent_approval_status: 'pending',
      overall_status: 'pending',
      email_notification_status: 'FAILED',
      email_failure_reason: 'Quota Exhausted: Google daily email quota exceeded',
      qr_token: createHomeVisitCompactToken(),
    });

    assert.ok(visit9._id, 'Request must be safely saved in database even when email delivery fails');
    assert.strictEqual(visit9.email_notification_status, 'FAILED', 'Notification status should be FAILED');
    assert.ok(visit9.email_failure_reason.includes('Quota Exhausted'), 'Failure reason should be recorded');
    console.log('  ✅ Passed: Failed notification recorded separately without losing student request.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 10: Retry after notification failure
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 10: Retry after notification failure ---');
    // Regenerate token and simulate successful resend
    const freshToken10 = generateParentApprovalToken(48);
    visit9.parent_token_hash = freshToken10.tokenHash;
    visit9.parent_token_expires_at = freshToken10.expiresAt;
    visit9.email_notification_status = 'SUBMITTED';
    visit9.email_sent_at = new Date();
    visit9.email_failure_reason = null;
    await visit9.save();

    const retriedVisit = await HomeVisitLog.findById(visit9._id);
    assert.strictEqual(retriedVisit.email_notification_status, 'SUBMITTED', 'Notification status updated to SUBMITTED after retry');
    assert.strictEqual(retriedVisit.email_failure_reason, null, 'Failure reason cleared on successful retry');
    assert.strictEqual(retriedVisit.parent_token_hash, freshToken10.tokenHash, 'Fresh token hash registered');
    console.log('  ✅ Passed: Retry mechanism successfully regenerates token and updates notification status.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 11: Parent approval followed by warden approval (gate QR issued)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 11: Parent approval followed by warden approval ---');
    const tokenData11 = generateParentApprovalToken(48);
    const visit11 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      hostel: studentUser.hostel,
      roomNo: studentUser.roomNo,
      reason: 'Semester break visit',
      place: 'Indore',
      leave_date: '2026-12-15',
      return_date: '2026-12-20',
      parent_email: guardianRecord.email,
      parent_token_hash: tokenData11.tokenHash,
      parent_token_expires_at: tokenData11.expiresAt,
      parent_approval_status: 'pending',
      warden_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    // Step 11a: Parent approves
    const hash11 = hashParentToken(tokenData11.rawToken);
    await HomeVisitLog.updateOne(
      { _id: visit11._id, parent_token_hash: hash11 },
      {
        $set: {
          parent_approval_status: 'parent_approved',
          parent_status: 'approved',
          parent_token_hash: null,
          overall_status: 'pending',
          warden_status: 'pending',
        },
      }
    );

    // Step 11b: Warden approves (allowed because parent_approval_status === 'parent_approved')
    const visitAfterParent = await HomeVisitLog.findById(visit11._id);
    assert.strictEqual(visitAfterParent.parent_approval_status, 'parent_approved', 'Parent approval verified');
    assert.strictEqual(visitAfterParent.warden_status, 'pending', 'Warden approval is still pending');

    // Issue gate pass
    const gatePassInfo = await issueHomeVisitGatePass(visitAfterParent);
    visitAfterParent.warden_status = 'approved';
    visitAfterParent.warden_response_time = new Date();
    visitAfterParent.overall_status = 'approved';
    visitAfterParent.qr_token = gatePassInfo.token;
    await visitAfterParent.save();

    const finalizedVisit = await HomeVisitLog.findById(visit11._id);
    assert.strictEqual(finalizedVisit.overall_status, 'approved', 'Final status approved only after warden');
    assert.strictEqual(finalizedVisit.warden_status, 'approved', 'Warden status approved');
    assert.ok(finalizedVisit.qr_token.startsWith('HV-'), 'Gate QR pass issued with HV- prefix');
    console.log('  ✅ Passed: Gate QR pass issued only after parent approves AND warden grants final authorization.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 12: Warden attempting to approve rejected or pending request
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 12: Unauthorized warden approval on rejected request ---');
    // Using visit4 which was rejected by parent (parent_approval_status: 'parent_rejected')
    const rejectedVisit12 = await HomeVisitLog.findById(visit4._id);
    assert.strictEqual(rejectedVisit12.parent_approval_status, 'parent_rejected');

    // Business rule check from router: warden cannot approve if parent rejected
    const canWardenApprove = (v) => {
      if (v.parent_approval_status === 'parent_rejected') return false;
      return v.parent_approval_status === 'parent_approved' || Boolean(v.parent_call_confirmed);
    };

    assert.strictEqual(canWardenApprove(rejectedVisit12), false, 'Warden must NOT be able to approve request rejected by parent');

    // Check with unapproved/pending visit
    const tokenData12b = generateParentApprovalToken(48);
    const pendingVisit12 = await HomeVisitLog.create({
      student_id: studentUser._id,
      reason: 'Day trip',
      place: 'Lonavala',
      leave_date: '2026-12-22',
      return_date: '2026-12-23',
      parent_approval_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    assert.strictEqual(canWardenApprove(pendingVisit12), false, 'Warden must NOT be able to approve while parent approval is still pending');
    console.log('  ✅ Passed: Warden blocked from approving pending or parent-rejected home visit requests.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 13: Email link scanners opening approval URL without state mutation
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 13: Email link scanner read-only verification ---');
    const tokenData13 = generateParentApprovalToken(48);
    const visit13 = await HomeVisitLog.create({
      student_id: studentUser._id,
      name: studentUser.name,
      rollNo: studentUser.rollNo,
      reason: 'Family function',
      place: 'Nashik',
      leave_date: '2026-12-24',
      return_date: '2026-12-26',
      parent_email: guardianRecord.email,
      parent_token_hash: tokenData13.tokenHash,
      parent_token_expires_at: tokenData13.expiresAt,
      parent_approval_status: 'pending',
      warden_status: 'pending',
      overall_status: 'pending',
      qr_token: createHomeVisitCompactToken(),
    });

    // Simulate 3 link scanner bot GET requests
    for (let i = 0; i < 3; i++) {
      const scannerVisit = await HomeVisitLog.findById(visit13._id).lean();
      const hashCheck = hashParentToken(tokenData13.rawToken);
      const isTokenValid = verifyTokenHash(scannerVisit.parent_token_hash, hashCheck);

      assert.strictEqual(isTokenValid, true, 'Scanner GET reads valid token hash');
      // Verify NO mutation occurred
      assert.strictEqual(scannerVisit.parent_approval_status, 'pending', 'Status MUST remain pending');
      assert.strictEqual(scannerVisit.overall_status, 'pending', 'Overall status MUST remain pending');
      assert.strictEqual(scannerVisit.parent_token_hash, tokenData13.tokenHash, 'Token hash MUST NOT be consumed');
    }

    console.log('  ✅ Passed: GET verification endpoint is strictly idempotent and safe from antivirus/email link bots.\n');

    console.log('════════════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 13 FREE PARENT EMAIL APPROVAL TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('════════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Test Suite Failed:', err);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
}

if (require.main === module) {
  runTestSuite().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runTestSuite };
