const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Guardian = require('../models/Guardian');
const GuardianInvitation = require('../models/GuardianInvitation');
const HomeVisitLog = require('../models/HomeVisitLog');
const { linkInitialGuardians } = require('../services/guardianService');

async function runTests() {
  console.log('========================================================================');
  console.log('   EMAIL DEDUPLICATION & TOKEN VALIDITY TESTS                           ');
  console.log('========================================================================');

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI is missing');
  await mongoose.connect(mongoUri);

  const testStudentEmail = `test.student.dedup.${Date.now()}@iiitpune.ac.in`;
  const fatherEmail = `father.dedup.${Date.now()}@gmail.com`;
  const motherEmail = `mother.dedup.${Date.now()}@gmail.com`;

  // 1. Create a test student
  const student = await User.create({
    name: 'Dedup Test Student',
    email: testStudentEmail,
    role: 'student',
    rollNo: `T${Date.now().toString().slice(-7)}`,
    phone: '+919876543210',
    isActive: true,
  });

  console.log(`\n[Test 1] Initial guardian linking for student ${student.name}...`);
  const result1 = await linkInitialGuardians({
    studentId: student._id,
    guardian1: { name: 'Father Test', relationship: 'Father', email: fatherEmail, phone: '+919876543211' },
    guardian2: { name: 'Mother Test', relationship: 'Mother', email: motherEmail, phone: '+919876543212' },
  });

  const invitations1 = await GuardianInvitation.find({
    guardian_id: { $in: [result1.guardian1._id, result1.guardian2._id] },
    used_at: null,
  });

  console.log(`  ✓ Generated invitations count: ${invitations1.length} (Expected: 2)`);
  if (invitations1.length !== 2) throw new Error('Expected exactly 2 invitations generated');

  const token1Father = invitations1.find(i => i.guardian_id.toString() === result1.guardian1._id.toString())?.token_hash;
  console.log(`  ✓ Father invitation token hash: ${token1Father.slice(0, 12)}...`);

  console.log('\n[Test 2] Rapid re-submission (e.g. StudentGuardianPrompt re-trigger or double submit)...');
  const result2 = await linkInitialGuardians({
    studentId: student._id,
    guardian1: { name: 'Father Test', relationship: 'Father', email: fatherEmail, phone: '+919876543211' },
    guardian2: { name: 'Mother Test', relationship: 'Mother', email: motherEmail, phone: '+919876543212' },
  });

  console.log(`  ✓ Idempotency flagged: alreadyInvited = ${result2.alreadyInvited}`);
  if (!result2.alreadyInvited) throw new Error('Expected alreadyInvited to be true on rapid re-submission');

  const invitations2 = await GuardianInvitation.find({
    guardian_id: { $in: [result1.guardian1._id, result1.guardian2._id] },
    used_at: null,
  });

  console.log(`  ✓ Active invitations count after 2nd submission: ${invitations2.length} (Expected: 2, not wiped)`);
  if (invitations2.length !== 2) throw new Error('Invitations should NOT have been deleted on re-submission');

  const token1FatherAfter = invitations2.find(i => i.guardian_id.toString() === result1.guardian1._id.toString())?.token_hash;
  console.log(`  ✓ Verified: Token remains unchanged and valid: ${token1Father === token1FatherAfter}`);
  if (token1Father !== token1FatherAfter) throw new Error('Token hash changed unexpectedly; link would be invalidated!');

  console.log('\n[Test 3] Validation enforces distinct emails between Guardian 1 and 2...');
  let distinctCheckPassed = false;
  try {
    await linkInitialGuardians({
      studentId: student._id,
      guardian1: { name: 'Father Shared', relationship: 'Father', email: fatherEmail, phone: '+919876543221' },
      guardian2: { name: 'Mother Shared', relationship: 'Mother', email: fatherEmail, phone: '+919876543222' },
    });
  } catch (err) {
    if (err.message.includes('must be distinct')) {
      distinctCheckPassed = true;
    }
  }
  console.log(`  ✓ Distinct email constraint enforced: ${distinctCheckPassed}`);
  if (!distinctCheckPassed) throw new Error('Expected validation error for duplicate guardian email');

  // Cleanup test documents
  await User.deleteMany({ _id: student._id });
  await Guardian.deleteMany({ student_id: student._id });
  await GuardianInvitation.deleteMany({ guardian_id: { $in: [result1.guardian1._id, result1.guardian2._id] } });

  console.log('\n========================================================================');
  console.log('   🎉 ALL EMAIL DEDUPLICATION & TOKEN VALIDITY CHECKS PASSED!         ');
  console.log('========================================================================\n');

  await mongoose.disconnect();
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
