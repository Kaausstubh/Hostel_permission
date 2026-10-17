/**
 * Rollback Migration: rollback_002_create_parent_approval_system.js
 * Drops newly created parent approval collections and cleans up backfilled fields.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function runRollback() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  console.log('Rolling back Parent Approval collections...');
  const collections = ['guardians', 'guardianinvitations', 'parentapprovals', 'approvalauditlogs', 'pendingregistrations'];

  for (const collName of collections) {
    try {
      await db.dropCollection(collName);
      console.log(`✔ Dropped collection ${collName}`);
    } catch (err) {
      console.log(`ℹ Collection ${collName} did not exist or already dropped`);
    }
  }

  // Revert legacy marker on HomeVisitLog
  const HomeVisitLog = require('../models/HomeVisitLog');
  const res = await HomeVisitLog.updateMany(
    { parent_approval_status: 'legacy' },
    { $unset: { parent_approval_status: '', final_parent_decision_at: '', parent_reminder_sent: '', parent_decision_source: '' } }
  );
  console.log(`✔ Unset parent approval fields from ${res.modifiedCount} records.`);

  console.log('\nRollback 002 completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  runRollback().catch((err) => {
    console.error('Rollback 002 failed:', err);
    process.exit(1);
  });
}

module.exports = runRollback;
