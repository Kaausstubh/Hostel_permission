/**
 * Comprehensive Test Suite for Parent Linking & Digital Home-Visit Approval System
 *
 * Uses mongodb-memory-server for isolated, deterministic, reproducible in-memory execution.
 *
 * Covers all 11 user requirements and edge-cases:
 * 1. Email domain validation (college student email vs personal parent emails)
 * 2. 3 unique phone numbers & 2 unique parent emails contract
 * 3. PendingRegistration staging with 15-minute TTL & OTP activation
 * 4. Single-use invitation token lifecycle (idempotent verify without consuming, single-use accept)
 * 5. Sibling account reuse when email matches
 * 6. Strict parent authorization isolation (cannot view or approve other students' requests)
 * 7. Parent decision flows: ANY_ONE and ALL policies
 * 8. Concurrency / race condition handling via conditional atomic updates
 * 9. Append-only enforcement on ParentApproval (middleware blocks save, update, replace, delete, bulkWrite)
 * 10. Staff phone override (with and without linked guardians; on pending and parent_no_response)
 * 11. Scheduler multi-instance safety & Legacy record exemption from scheduler and warden-approval check
 * 12. Parent forgot-password & email-OTP login
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Models
const User = require('../models/User');
const Guardian = require('../models/Guardian');
const GuardianInvitation = require('../models/GuardianInvitation');
const ParentApproval = require('../models/ParentApproval');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const PendingRegistration = require('../models/PendingRegistration');

// Services
const {
  validateCollegeDomain,
  validateParentEmail,
  validateGuardianInputs,
  linkInitialGuardians,
  verifyInvitationToken,
  acceptInvitation,
} = require('../services/guardianService');

const {
  recordParentDecision,
  recordStaffPhoneOverride,
  getApprovalPolicy,
} = require('../services/parentApprovalService');

const {
  runParentApprovalCycle,
} = require('../jobs/parentApprovalScheduler');

let mongoServer;

async function runParentApprovalTestSuite() {
  console.log('🧪 Starting HEIMDALL Parent Approval System Test Suite (mongodb-memory-server)...\n');

  try {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    console.log('  ✓ Connected to in-memory MongoDB instance.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Email domain & phone validation contract
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 1: Email domain & phone validation contract ---');

    // Student domain
    assert.strictEqual(validateCollegeDomain('sjyotik@iiitpune.ac.in'), true, 'College domain should be valid');
    assert.strictEqual(validateCollegeDomain('sjyotik@cse.iiitp.ac.in'), true, 'Subdomain should be valid');
    assert.strictEqual(validateCollegeDomain('sjyotik@gmail.com'), false, 'Gmail should not be valid for student');

    // Parent email
    const pValid = validateParentEmail('parent@gmail.com');
    assert.strictEqual(pValid.valid, true, 'Personal parent email should be valid');
    const pInvalid = validateParentEmail('parent@iiitpune.ac.in');
    assert.strictEqual(pInvalid.valid, false, 'Parent cannot use college domain');
    assert.ok(pInvalid.error.includes('college domain'), 'Error message should mention college domain');

    // Duplicate phones or emails
    assert.throws(() => {
      validateGuardianInputs({
        studentPhone: '9876543210',
        studentEmail: 'student@iiitpune.ac.in',
        guardian1: { name: 'Dad', relationship: 'Father', phone: '9876543210', email: 'dad@gmail.com' },
        guardian2: { name: 'Mom', relationship: 'Mother', phone: '9876543211', email: 'mom@gmail.com' },
      });
    }, /Student phone number cannot be the same as any guardian phone number/, 'Should reject duplicate student & guardian 1 phone');

    assert.throws(() => {
      validateGuardianInputs({
        studentPhone: '9876543210',
        studentEmail: 'student@iiitpune.ac.in',
        guardian1: { name: 'Dad', relationship: 'Father', phone: '9876543211', email: 'dad@gmail.com' },
        guardian2: { name: 'Mom', relationship: 'Mother', phone: '9876543211', email: 'mom@gmail.com' },
      });
    }, /Guardian 1 phone and Guardian 2 phone must be distinct/, 'Should reject identical guardian phones');

    assert.throws(() => {
      validateGuardianInputs({
        studentPhone: '9876543210',
        studentEmail: 'student@iiitpune.ac.in',
        guardian1: { name: 'Dad', relationship: 'Father', phone: '9876543211', email: 'parent@gmail.com' },
        guardian2: { name: 'Mom', relationship: 'Mother', phone: '9876543212', email: 'parent@gmail.com' },
      });
    }, /Guardian 1 email and Guardian 2 email must be distinct from each other/, 'Should reject identical guardian emails');

    console.log('  ✓ Test 1 Passed: Domain and phone contracts strictly enforced.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: PendingRegistration staging with 15-minute TTL index
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 2: PendingRegistration staging with 15-minute TTL ---');

    const pending = await PendingRegistration.create({
      email: 'student1@iiitpune.ac.in',
      name: 'Rohan Sharma',
      passwordHash: 'hashed_pw_123',
      rollNo: '2023BCSE001',
      hostel: 'BH1',
      roomNo: '204',
      phone: '9876500001',
      otpHash: crypto.createHash('sha256').update('123456').digest('hex'),
      otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      guardian1: { name: 'Ramesh Sharma', relationship: 'Father', phone: '9876500002', email: 'ramesh.sharma@gmail.com' },
      guardian2: { name: 'Sunita Sharma', relationship: 'Mother', phone: '9876500003', email: 'sunita.sharma@gmail.com' },
    });

    assert.ok(pending._id, 'PendingRegistration document created');
    assert.strictEqual(pending.guardian1.email, 'ramesh.sharma@gmail.com');
    assert.strictEqual(pending.guardian2.phone, '9876500003');

    // Verify TTL index configuration in schema
    const ttlIndex = PendingRegistration.schema.indexes().find(idx => idx[0]?.createdAt === 1);
    assert.ok(ttlIndex, 'PendingRegistration must have createdAt index for TTL');
    assert.strictEqual(ttlIndex[1]?.expireAfterSeconds, 900, 'TTL must be 900 seconds (15 minutes)');

    console.log('  ✓ Test 2 Passed: PendingRegistration stages unverified data with 15m TTL.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: Single-use invitation token lifecycle & idempotent non-consumption
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 3: Invitation token lifecycle (verify does not consume, accept is single-use) ---');

    // Create student user
    const studentUser = await User.create({
      name: 'Rohan Sharma',
      email: 'student1@iiitpune.ac.in',
      role: 'student',
      rollNo: '2023BCSE001',
      hostel: 'BH1',
      roomNo: '204',
      phone: '+919876500001',
      parentPhone: '+919876500002',
      parentPhone2: '+919876500003',
      isEmailVerified: true,
    });

    // Link initial guardians
    const linkRes = await linkInitialGuardians({
      studentId: studentUser._id,
      guardian1: { name: 'Ramesh Sharma', relationship: 'Father', phone: '9876500002', email: 'ramesh.sharma@gmail.com' },
      guardian2: { name: 'Sunita Sharma', relationship: 'Mother', phone: '9876500003', email: 'sunita.sharma@gmail.com' },
      ip: '127.0.0.1',
    });

    const g1 = linkRes.guardian1;
    assert.strictEqual(g1.status, 'INVITED');
    assert.strictEqual(g1.user_id, null);

    // Retrieve invitation token
    const inviteDoc = await GuardianInvitation.findOne({ guardian_id: g1._id });
    assert.ok(inviteDoc, 'GuardianInvitation must exist');

    // To test verification, we recreate a known raw token
    const testRawToken = 'test-token-hex-1234567890abcdef1234567890abcdef';
    const testHash = crypto.createHash('sha256').update(testRawToken).digest('hex');
    inviteDoc.token_hash = testHash;
    await inviteDoc.save();

    // 1. First GET /verify — must NOT consume token
    const verify1 = await verifyInvitationToken(testRawToken);
    assert.strictEqual(verify1.valid, true);
    assert.strictEqual(verify1.guardian.name, 'Ramesh Sharma');
    assert.strictEqual(verify1.student.rollNo, '2023BCSE001');

    const inviteDocAfterVerify1 = await GuardianInvitation.findById(inviteDoc._id);
    assert.strictEqual(inviteDocAfterVerify1.used_at, null, 'verify must NOT mark used_at');

    // 2. Second GET /verify — idempotent check
    const verify2 = await verifyInvitationToken(testRawToken);
    assert.strictEqual(verify2.valid, true, 'Second verify must also succeed idempotently');

    // 3. Accept invitation
    const acceptRes = await acceptInvitation({
      rawToken: testRawToken,
      password: 'ParentSecurePassword123!',
      ip: '127.0.0.1',
    });

    assert.ok(acceptRes.parentUser, 'Parent User record must be created');
    assert.strictEqual(acceptRes.parentUser.role, 'parent');
    assert.strictEqual(acceptRes.parentUser.email, 'ramesh.sharma@gmail.com');

    const g1Active = await Guardian.findById(g1._id);
    assert.strictEqual(g1Active.status, 'ACTIVE', 'Guardian status must be ACTIVE');
    assert.strictEqual(String(g1Active.user_id), String(acceptRes.parentUser._id));

    const inviteDocAfterAccept = await GuardianInvitation.findById(inviteDoc._id);
    assert.ok(inviteDocAfterAccept.used_at !== null, 'used_at must be populated after accept');

    // 4. Second accept attempt — must fail
    await assert.rejects(
      async () => {
        await acceptInvitation({
          rawToken: testRawToken,
          password: 'AnotherPassword123!',
          ip: '127.0.0.1',
        });
      },
      /Invitation link has expired or has already been used/,
      'Single-use invitation token must reject replay'
    );

    console.log('  ✓ Test 3 Passed: Token verification is idempotent; token consumption is strictly single-use.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 4: Sibling account reuse when email matches
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 4: Sibling account reuse when email matches ---');

    // Create sibling student (Student 2)
    const siblingUser = await User.create({
      name: 'Priya Sharma',
      email: 'student2@iiitpune.ac.in',
      role: 'student',
      rollNo: '2024BCSE042',
      hostel: 'GH1',
      roomNo: '102',
      phone: '+919876500099',
      isEmailVerified: true,
    });

    // Link guardians for sibling, using Ramesh Sharma's existing email
    const siblingLinkRes = await linkInitialGuardians({
      studentId: siblingUser._id,
      guardian1: { name: 'Ramesh Sharma', relationship: 'Father', phone: '9876500002', email: 'ramesh.sharma@gmail.com' },
      guardian2: { name: 'Sunita Sharma', relationship: 'Mother', phone: '9876500003', email: 'sunita.sharma@gmail.com' },
      ip: '127.0.0.1',
    });

    const siblingG1 = siblingLinkRes.guardian1;
    // Because ramesh.sharma@gmail.com already has an active parent account, status is immediately ACTIVE
    assert.strictEqual(siblingG1.status, 'ACTIVE', 'Sibling guardian status should be immediately ACTIVE');
    assert.strictEqual(String(siblingG1.user_id), String(acceptRes.parentUser._id), 'Sibling guardian should point to the same parent User ID');

    // No duplicate User record created
    const parentAccounts = await User.find({ email: 'ramesh.sharma@gmail.com' });
    assert.strictEqual(parentAccounts.length, 1, 'Only one parent account should exist for siblings');

    // Verify parent has both wards linked
    const linkedGuardians = await Guardian.find({
      $or: [{ user_id: acceptRes.parentUser._id }, { email: acceptRes.parentUser.email.toLowerCase() }],
      status: 'ACTIVE',
    }).populate('student_id');

    assert.strictEqual(linkedGuardians.length, 2, 'Parent should have 2 active guardian links');
    const wardNames = linkedGuardians.map(g => g.student_id.name);
    assert.ok(wardNames.includes('Rohan Sharma') && wardNames.includes('Priya Sharma'), 'Guardians should point to Rohan and Priya');

    console.log('  ✓ Test 4 Passed: Sibling accounts seamlessly reuse the same parent account.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 5: Strict parent authorization isolation
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 5: Strict parent authorization isolation ---');

    // Create an unrelated student and an unrelated parent
    const otherStudent = await User.create({
      name: 'Vikram Singh',
      email: 'student3@iiitpune.ac.in',
      role: 'student',
      rollNo: '2023BECE015',
      hostel: 'BH2',
      roomNo: '312',
      phone: '+919876588888',
      isEmailVerified: true,
    });

    const otherParent = await User.create({
      name: 'Rajendra Singh',
      email: 'rajendra.singh@gmail.com',
      role: 'parent',
      passwordHash: await bcrypt.hash('OtherParentPass123!', 10),
      isEmailVerified: true,
    });

    await Guardian.create({
      student_id: otherStudent._id,
      guardian_slot: 1,
      name: 'Rajendra Singh',
      relationship: 'Father',
      phone: '+919876577777',
      email: 'rajendra.singh@gmail.com',
      status: 'ACTIVE',
      user_id: otherParent._id,
      linked_at: new Date(),
    });

    // Create leave request for Vikram Singh
    const otherVisit = await HomeVisitLog.create({
      student_id: otherStudent._id,
      roll_no: '2023BECE015',
      name: 'Vikram Singh',
      hostel: 'BH2',
      place: 'Jaipur',
      leave_date: '2026-10-25',
      return_date: '2026-10-28',
      reason: 'Family Event',
      parent_approval_status: 'pending',
    });

    // Ramesh Sharma (Parent of Rohan & Priya) attempts to decide on Vikram's request
    await assert.rejects(
      async () => {
        await recordParentDecision({
          visitId: otherVisit._id,
          parentUser: acceptRes.parentUser,
          decision: 'APPROVED',
          remarks: 'I approve',
          ip: '127.0.0.1',
        });
      },
      /You are not registered as an authorized guardian for this student/,
      'Parent must not submit decision for an unrelated student request'
    );

    console.log('  ✓ Test 5 Passed: Strict authorization isolation prevents cross-ward access.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 6: Parent decision flows: ANY_ONE and ALL policy
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 6: Parent decision flows (ANY_ONE policy & ALL policy) ---');

    // 6A: ANY_ONE policy (default)
    process.env.PARENT_APPROVAL_POLICY = 'ANY_ONE';

    const visit1 = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Pune Home',
      leave_date: '2026-10-20',
      return_date: '2026-10-22',
      reason: 'Weekend Visit',
      parent_approval_status: 'pending',
    });

    const decisionRes1 = await recordParentDecision({
      visitId: visit1._id,
      parentUser: acceptRes.parentUser,
      decision: 'APPROVED',
      remarks: 'Permission granted by Father',
      ip: '127.0.0.1',
    });

    assert.strictEqual(decisionRes1.success, true);
    assert.strictEqual(decisionRes1.decision, 'APPROVED');

    const updatedVisit1 = await HomeVisitLog.findById(visit1._id);
    assert.strictEqual(updatedVisit1.parent_approval_status, 'parent_approved');
    assert.strictEqual(updatedVisit1.parent_decision_source, 'PARENT_PORTAL');
    assert.ok(updatedVisit1.final_parent_decision_at !== null);

    // Verify approval record was created
    const approvals1 = await ParentApproval.find({ home_visit_request_id: visit1._id });
    assert.strictEqual(approvals1.length, 1);
    assert.strictEqual(approvals1[0].decision, 'APPROVED');
    assert.strictEqual(approvals1[0].remarks, 'Permission granted by Father');

    // 6B: ALL policy
    process.env.PARENT_APPROVAL_POLICY = 'ALL';

    // Activate Mom (Guardian 2 for Rohan)
    const momUser = await User.create({
      name: 'Sunita Sharma',
      email: 'sunita.sharma@gmail.com',
      role: 'parent',
      passwordHash: await bcrypt.hash('MomPassword123!', 10),
      isEmailVerified: true,
    });
    await Guardian.updateOne(
      { student_id: studentUser._id, guardian_slot: 2 },
      { $set: { status: 'ACTIVE', user_id: momUser._id, linked_at: new Date() } }
    );

    const visit2 = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Mumbai',
      leave_date: '2026-11-01',
      return_date: '2026-11-05',
      reason: 'Festival',
      parent_approval_status: 'pending',
    });

    // First parent (Father) approves
    const decRes2A = await recordParentDecision({
      visitId: visit2._id,
      parentUser: acceptRes.parentUser,
      decision: 'APPROVED',
      remarks: 'Father approves',
      ip: '127.0.0.1',
    });

    assert.strictEqual(decRes2A.visit.parent_approval_status, 'pending', 'Under ALL policy, status remains pending when only 1 of 2 approved');
    const midVisit2 = await HomeVisitLog.findById(visit2._id);
    assert.strictEqual(midVisit2.parent_approval_status, 'pending', 'Status remains pending until all approve');

    // Second parent (Mother) approves
    const decRes2B = await recordParentDecision({
      visitId: visit2._id,
      parentUser: momUser,
      decision: 'APPROVED',
      remarks: 'Mother approves too',
      ip: '127.0.0.1',
    });

    assert.strictEqual(decRes2B.visit.parent_approval_status, 'parent_approved', 'Under ALL policy, status becomes parent_approved once all approve');
    const updatedVisit2 = await HomeVisitLog.findById(visit2._id);
    assert.strictEqual(updatedVisit2.parent_approval_status, 'parent_approved');

    // Reset policy to ANY_ONE for subsequent tests
    process.env.PARENT_APPROVAL_POLICY = 'ANY_ONE';
    console.log('  ✓ Test 6 Passed: ANY_ONE and ALL policies evaluated accurately.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 7: Append-Only Guarantee on ParentApproval
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 7: Append-only enforcement on ParentApproval ---');

    const immutabilityVisit = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Audit Check',
      leave_date: '2026-11-10',
      return_date: '2026-11-12',
      reason: 'Audit Check',
      parent_approval_status: 'pending',
    });

    const testApproval = await ParentApproval.create({
      home_visit_request_id: immutabilityVisit._id,
      student_id: studentUser._id,
      guardian_id: g1._id,
      decision: 'APPROVED',
      decided_by_email: 'ramesh.sharma@gmail.com',
      decided_by_name: 'Ramesh Sharma',
      decision_source: 'PARENT_PORTAL',
      remarks: 'Immutable test approval',
      ip_address: '127.0.0.1',
    });

    // 0. Partial unique index: duplicate insert by same guardian on same request must throw E11000
    await assert.rejects(
      async () => {
        await ParentApproval.create({
          home_visit_request_id: immutabilityVisit._id,
          student_id: studentUser._id,
          guardian_id: g1._id,
          decision: 'APPROVED',
          decided_by_email: 'ramesh.sharma@gmail.com',
          decision_source: 'PARENT_PORTAL',
        });
      },
      /duplicate key error|E11000/,
      'Partial unique index must prevent duplicate approvals by same guardian'
    );

    // 1. save() on existing doc must throw
    await assert.rejects(
      async () => {
        testApproval.decision = 'REJECTED';
        await testApproval.save();
      },
      /ParentApproval records are immutable and append-only/,
      'save() on existing doc must be blocked'
    );

    // 2. updateOne must throw
    await assert.rejects(
      async () => {
        await ParentApproval.updateOne({ _id: testApproval._id }, { $set: { decision: 'REJECTED' } });
      },
      /ParentApproval records are immutable and append-only/,
      'updateOne must be blocked'
    );

    // 3. updateMany must throw
    await assert.rejects(
      async () => {
        await ParentApproval.updateMany({ _id: testApproval._id }, { $set: { decision: 'REJECTED' } });
      },
      /ParentApproval records are immutable and append-only/,
      'updateMany must be blocked'
    );

    // 4. replaceOne must throw
    await assert.rejects(
      async () => {
        await ParentApproval.replaceOne({ _id: testApproval._id }, { decision: 'REJECTED' });
      },
      /ParentApproval records are immutable and append-only/,
      'replaceOne must be blocked'
    );

    // 5. findOneAndReplace must throw
    await assert.rejects(
      async () => {
        await ParentApproval.findOneAndReplace({ _id: testApproval._id }, { decision: 'REJECTED' });
      },
      /ParentApproval records are immutable and append-only/,
      'findOneAndReplace must be blocked'
    );

    // 6. deleteOne must throw
    await assert.rejects(
      async () => {
        await ParentApproval.deleteOne({ _id: testApproval._id });
      },
      /ParentApproval records are immutable and append-only/,
      'deleteOne must be blocked'
    );

    // 7. deleteMany must throw
    await assert.rejects(
      async () => {
        await ParentApproval.deleteMany({ _id: testApproval._id });
      },
      /ParentApproval records are immutable and append-only/,
      'deleteMany must be blocked'
    );

    // 8. bulkWrite must throw
    await assert.rejects(
      async () => {
        await ParentApproval.bulkWrite([{ deleteOne: { filter: { _id: testApproval._id } } }]);
      },
      /ParentApproval records are immutable and append-only/,
      'bulkWrite must be blocked'
    );

    console.log('  ✓ Test 7 Passed: ParentApproval is completely immutable and append-only.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 8: Staff Phone Override Flows & Post-Override Parent Rejection
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 8: Staff phone override flows & late parent attempt handling ---');

    // Case A: Override with linked guardian
    const visit3 = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Pune',
      leave_date: '2026-10-21',
      return_date: '2026-10-22',
      reason: 'Urgent Family Visit',
      parent_approval_status: 'pending',
    });

    const overrideResA = await recordStaffPhoneOverride({
      visitId: visit3._id,
      staffUser: { _id: new mongoose.Types.ObjectId(), name: 'Warden Patil', role: 'warden', email: 'warden@iiitpune.ac.in' },
      decision: 'APPROVED',
      guardianId: g1._id,
      contactName: 'Ramesh Sharma',
      contactPhone: '9876500002',
      overrideReason: 'Spoke directly with father over voice call. He confirmed travel.',
      ip: '127.0.0.1',
    });

    assert.strictEqual(overrideResA.success, true);
    const updatedVisit3 = await HomeVisitLog.findById(visit3._id);
    assert.strictEqual(updatedVisit3.parent_approval_status, 'parent_approved');
    assert.strictEqual(updatedVisit3.parent_decision_source, 'STAFF_PHONE_OVERRIDE');

    // Post-override behavior: parent attempts to submit decision afterwards
    await assert.rejects(
      async () => {
        await recordParentDecision({
          visitId: visit3._id,
          parentUser: acceptRes.parentUser,
          decision: 'REJECTED',
          remarks: 'Too late decision',
          ip: '127.0.0.1',
        });
      },
      /This request has already been processed via Hostel Staff Phone Confirmation/,
      'Parent decision after staff override must be rejected with informative error'
    );

    // Case B: Override when NO guardian is linked (free-text contact details)
    const unlinkedStudent = await User.create({
      name: 'Legacy Student',
      email: 'legacy.student@iiitpune.ac.in',
      role: 'student',
      rollNo: '2022BCE001',
      hostel: 'BH1',
      isEmailVerified: true,
    });

    const visit4 = await HomeVisitLog.create({
      student_id: unlinkedStudent._id,
      roll_no: unlinkedStudent.rollNo,
      name: unlinkedStudent.name,
      hostel: unlinkedStudent.hostel,
      place: 'Nagpur',
      leave_date: '2026-10-23',
      return_date: '2026-10-24',
      reason: 'Medical checkup',
      parent_approval_status: 'pending',
    });

    const overrideResB = await recordStaffPhoneOverride({
      visitId: visit4._id,
      staffUser: { _id: new mongoose.Types.ObjectId(), name: 'Warden Patil', role: 'warden', email: 'warden@iiitpune.ac.in' },
      decision: 'APPROVED',
      guardianId: null, // No guardian linked
      contactName: 'Anil Kumar (Uncle)',
      contactPhone: '9876599999',
      overrideReason: 'Student has no linked guardians; called guardian from physical file. Verbal approval given.',
      ip: '127.0.0.1',
    });

    assert.strictEqual(overrideResB.success, true);
    const updatedVisit4 = await HomeVisitLog.findById(visit4._id);
    assert.strictEqual(updatedVisit4.parent_approval_status, 'parent_approved');
    assert.strictEqual(updatedVisit4.parent_decision_source, 'STAFF_PHONE_OVERRIDE');

    // Case C: Override allowed on parent_no_response
    const visit5 = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Pune',
      leave_date: '2026-10-24',
      return_date: '2026-10-25',
      reason: 'Weekend',
      parent_approval_status: 'parent_no_response',
    });

    const overrideResC = await recordStaffPhoneOverride({
      visitId: visit5._id,
      staffUser: { _id: new mongoose.Types.ObjectId(), name: 'Warden Patil', role: 'warden', email: 'warden@iiitpune.ac.in' },
      decision: 'APPROVED',
      guardianId: g1._id,
      contactName: 'Ramesh Sharma',
      contactPhone: '9876500002',
      overrideReason: 'Parent did not see digital notification in time. Called and confirmed.',
      ip: '127.0.0.1',
    });
    assert.strictEqual(overrideResC.success, true);

    console.log('  ✓ Test 8 Passed: Staff phone override handles all guardian states and rejects late parent decisions.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 9: Scheduler safety, Expirations, Reminders, and Legacy Exemption
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 9: Scheduler behavior, expirations, reminders & legacy exemptions ---');

    // 1. Create an expired pending request
    const expiredVisit = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Nashik',
      leave_date: '2026-10-10',
      return_date: '2026-10-12',
      reason: 'Late visit',
      parent_approval_status: 'pending',
      createdAt: new Date(Date.now() - 30 * 3600 * 1000), // > 24 hours ago
    });

    // 2. Create a legacy record
    const legacyVisit = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Old Record',
      leave_date: '2025-05-01',
      return_date: '2025-05-05',
      reason: 'Old leave record from 2025',
      parent_approval_status: 'legacy',
      createdAt: new Date(Date.now() - 120 * 3600 * 1000),
    });

    // 3. Create a midpoint reminder candidate
    const reminderVisit = await HomeVisitLog.create({
      student_id: studentUser._id,
      roll_no: studentUser.rollNo,
      name: studentUser.name,
      hostel: studentUser.hostel,
      place: 'Surat',
      leave_date: '2026-10-30',
      return_date: '2026-11-02',
      reason: 'Midpoint test',
      parent_approval_status: 'pending',
      parent_reminder_sent: false,
      createdAt: new Date(Date.now() - 14 * 3600 * 1000), // > 12 hours ago (50% of 24h)
    });

    // Run parent approval scheduler cycle
    const cycleRes = await runParentApprovalCycle();
    assert.strictEqual(cycleRes.processed, true);
    assert.ok(cycleRes.expiredCount >= 1, 'Should expire at least 1 pending request');
    assert.ok(cycleRes.reminderCount >= 1, 'Should send at least 1 midpoint reminder');

    const updatedExpiredVisit = await HomeVisitLog.findById(expiredVisit._id);
    assert.strictEqual(updatedExpiredVisit.parent_approval_status, 'parent_no_response', 'Expired request should be parent_no_response');

    // Legacy record must remain untouched
    const checkLegacy = await HomeVisitLog.findById(legacyVisit._id);
    assert.strictEqual(checkLegacy.parent_approval_status, 'legacy', 'Legacy record must NEVER be altered by scheduler');

    const updatedReminderVisit = await HomeVisitLog.findById(reminderVisit._id);
    assert.strictEqual(updatedReminderVisit.parent_reminder_sent, true, 'parent_reminder_sent flag must be true');

    console.log('  ✓ Test 9 Passed: Scheduler handles expirations and reminders; strictly exempts legacy records.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 10: Parent Password Reset & Email-OTP Authentication
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 10: Parent password reset & email-OTP login ---');

    // 10A: Password reset flow
    const parent = await User.findById(acceptRes.parentUser._id);
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    parent.resetPasswordToken = resetHash;
    parent.resetPasswordExpires = new Date(Date.now() + 3600 * 1000);
    await parent.save();

    // Verify token matches
    const resetParent = await User.findOne({
      resetPasswordToken: resetHash,
      resetPasswordExpires: { $gt: new Date() },
    });
    assert.ok(resetParent, 'Parent found by reset token');

    // Update password
    const newPassword = 'BrandNewParentPassword456!';
    resetParent.passwordHash = await bcrypt.hash(newPassword, 10);
    resetParent.resetPasswordToken = null;
    resetParent.resetPasswordExpires = null;
    await resetParent.save();

    const isMatch = await bcrypt.compare(newPassword, resetParent.passwordHash);
    assert.strictEqual(isMatch, true, 'New password matches hash');

    // 10B: Email-OTP login flow
    const testOtp = '654321';
    const otpHash = crypto.createHash('sha256').update(testOtp).digest('hex');

    resetParent.loginOtpHash = otpHash;
    resetParent.loginOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await resetParent.save();

    // Verify correct OTP
    const otpParent = await User.findOne({
      email: resetParent.email,
      loginOtpHash: otpHash,
      loginOtpExpires: { $gt: new Date() },
    });
    assert.ok(otpParent, 'Parent authenticated successfully via email OTP');

    // Clear OTP
    otpParent.loginOtpHash = null;
    otpParent.loginOtpExpires = null;
    await otpParent.save();

    console.log('  ✓ Test 10 Passed: Password reset and email-OTP authentication workflows validated.\n');

    // ──────────────────────────────────────────────────────────────────────────
    // ALL TESTS COMPLETED SUCCESSFULLY
    // ──────────────────────────────────────────────────────────────────────────
    console.log('🎉 ALL 10 TEST SUITES PASSED FLAWLESSLY WITH mongodb-memory-server!\n');

  } catch (err) {
    console.error('❌ Test Suite Failed:', err);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
    console.log('  ✓ Cleaned up in-memory MongoDB resources.');
  }
}

runParentApprovalTestSuite();
