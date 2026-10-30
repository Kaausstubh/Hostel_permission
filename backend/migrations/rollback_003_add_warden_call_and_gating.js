/**
 * Rollback Migration: rollback_003_add_warden_call_and_gating.js
 * Unsets warden_flow_version and warden call fields on HomeVisitLog documents.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const HomeVisitLog = require('../models/HomeVisitLog');

async function runRollback() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  console.log('Rolling back HomeVisitLog warden call fields...');
  const result = await HomeVisitLog.updateMany(
    {},
    {
      $unset: {
        warden_flow_version: '',
        warden_call_logged: '',
        first_call_at: '',
        warden_decision: '',
        warden_decided_by: '',
        warden_decided_at: '',
        warden_decision_note: '',
        warden_spoke_with_guardian_id: '',
        qr_generated_at: '',
      },
    }
  );
  console.log(`✔ Unset warden call fields on ${result.modifiedCount} records.`);

  console.log('\nRollback 003 completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  runRollback().catch((err) => {
    console.error('Rollback 003 failed:', err);
    process.exit(1);
  });
}

module.exports = runRollback;
