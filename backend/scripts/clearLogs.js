/**
 * Clear ONLY In/Out Logs Script
 *
 * Deletes ONLY daily In/Out records and gate passes (InOutLog).
 * Keeps Home Visit passes (HomeVisitLog), Complaints, and ALL student accounts & face photos (User) 100% INTACT.
 *
 * Usage:
 *   npm run clear:logs
 *   (or: node scripts/clearLogs.js)
 *   (or: node scripts/clearLogs.js "mongodb+srv://<user>:<pass>@cluster...")
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const User = require('../models/User');

async function main() {
  const uri = process.argv[2] || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log('Connecting to database...');
  await mongoose.connect(uri);

  const inoutCountBefore = await InOutLog.countDocuments();
  const homeCount = await HomeVisitLog.countDocuments();
  const userCount = await User.countDocuments();

  console.log(`Current state:`);
  console.log(` - In/Out records:      ${inoutCountBefore} (will be deleted)`);
  console.log(` - Home Visit records:  ${homeCount} (SAFE - will NOT be touched)`);
  console.log(` - Student/User accounts: ${userCount} (SAFE - will NOT be touched)`);

  console.log('\nDeleting ONLY In/Out records...');
  const inoutRes = await InOutLog.deleteMany({});

  const inoutCountAfter = await InOutLog.countDocuments();
  const homeCountAfter = await HomeVisitLog.countDocuments();
  const userCountAfter = await User.countDocuments();

  console.log('\n✅ Completed successfully:');
  console.log(` - Deleted ${inoutRes.deletedCount} In/Out records (remaining: ${inoutCountAfter})`);
  console.log(` - Home Visit records remaining: ${homeCountAfter} (untouched)`);
  console.log(` - Student accounts remaining:   ${userCountAfter} (untouched)`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error clearing In/Out logs:', err.message);
  process.exit(1);
});
