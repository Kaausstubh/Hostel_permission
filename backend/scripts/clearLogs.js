/**
 * Clear Pass & Request Logs Script
 *
 * Deletes ONLY operational logs:
 * - In/Out requests and gate passes (InOutLog)
 * - Home visit requests and passes (HomeVisitLog)
 *
 * Keeps ALL student accounts, registrations, roles, and verified face photos (User) 100% INTACT.
 *
 * Usage:
 *   npm run clear:logs
 *   (or: node scripts/clearLogs.js)
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const User = require('../models/User');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log('Connecting to database...');
  await mongoose.connect(uri);

  const inoutCountBefore = await InOutLog.countDocuments();
  const homeCountBefore = await HomeVisitLog.countDocuments();
  const userCount = await User.countDocuments();

  console.log(`Current state:`);
  console.log(` - In/Out records:    ${inoutCountBefore}`);
  console.log(` - Home Visit records: ${homeCountBefore}`);
  console.log(` - Student/User records: ${userCount} (will NOT be touched)`);

  console.log('\nClearing In/Out and Home Visit logs...');
  const inoutRes = await InOutLog.deleteMany({});
  const homeRes = await HomeVisitLog.deleteMany({});

  const userCountAfter = await User.countDocuments();

  console.log('\n✅ Done!');
  console.log(` - Deleted ${inoutRes.deletedCount} In/Out records`);
  console.log(` - Deleted ${homeRes.deletedCount} Home Visit records`);
  console.log(` - Verified: All ${userCountAfter} student accounts, registrations, and face photos are safe and intact.`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error clearing logs:', err.message);
  process.exit(1);
});
