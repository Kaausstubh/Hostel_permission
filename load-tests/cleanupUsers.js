/**
 * Safe Synthetic Test Data Cleanup Script
 *
 * Purges ONLY documents where loadTest === true or synthetic loadtest.* emails.
 * STRICT SAFETY: Never touches real college accounts or production data.
 */

const mongoose = require('mongoose');
const config = require('./lib/config');

// Protected emails that must NEVER be touched (dynamically loaded from .env)
const PROTECTED_EMAILS = [
  ...(process.env.WARDEN_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()),
  ...(process.env.SECURITY_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()),
  'security@campus.edu',
].filter(Boolean);

async function cleanup() {
  console.log('═'.repeat(70));
  console.log('🧹 HEIMDALL SYNTHETIC TEST DATA CLEANUP');
  console.log('═'.repeat(70));

  console.log(`🔗 Connecting to MongoDB: ${config.mongoUri.replace(/:([^@]+)@/, ':***@')}...`);
  await mongoose.connect(config.mongoUri, { maxPoolSize: 20 });
  const db = mongoose.connection.db;

  const safetyCheck = await db.collection('users').find({
    email: { $in: PROTECTED_EMAILS },
  }).toArray();

  console.log(`🔒 Safety Verification: Found ${safetyCheck.length} protected real accounts.`);
  for (const acc of safetyCheck) {
    console.log(`   🛡️  Preserving: ${acc.email} (${acc.role})`);
  }

  // Purge test users
  const userResult = await db.collection('users').deleteMany({
    $and: [
      { email: { $nin: PROTECTED_EMAILS } },
      {
        $or: [
          { loadTest: true },
          { email: { $regex: /^loadtest\./i } },
        ],
      },
    ],
  });
  console.log(`🗑️  Deleted ${userResult.deletedCount} synthetic users.`);

  // Purge test InOutLogs
  const inOutResult = await db.collection('inoutlogs').deleteMany({
    $or: [
      { loadTest: true },
      { email: { $regex: /^loadtest\./i } },
      { qr_token: { $regex: /^token_loadtest_/i } },
    ],
  });
  console.log(`🗑️  Deleted ${inOutResult.deletedCount} synthetic InOutLog entries.`);

  // Purge test HomeVisitLogs
  const homeVisitResult = await db.collection('homevisitlogs').deleteMany({
    $or: [
      { loadTest: true },
      { qr_token: { $regex: /^token_loadtest_/i } },
    ],
  });
  console.log(`🗑️  Deleted ${homeVisitResult.deletedCount} synthetic HomeVisitLog entries.`);

  // Purge test Complaints
  const complaintResult = await db.collection('complaints').deleteMany({
    $or: [
      { loadTest: true },
      { complaint_text: { $regex: /\[LoadTest\]/i } },
    ],
  });
  console.log(`🗑️  Deleted ${complaintResult.deletedCount} synthetic Complaint entries.`);

  const remainingUsers = await db.collection('users').countDocuments();
  console.log(`\n✅ Cleanup complete. Remaining active real users: ${remainingUsers}`);
  console.log('═'.repeat(70));

  await mongoose.disconnect();
}

if (require.main === module) {
  cleanup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Cleanup failed:', err);
      process.exit(1);
    });
}

module.exports = cleanup;
