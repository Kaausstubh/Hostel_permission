/**
 * Rollback: rollback_001_create_room_allocation_tables.js
 * Safely removes room allocation module indexes and clean up test data if needed.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function runRollback() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  const db = mongoose.connection.db;

  console.log('Rolling back Room Allocation tables...');
  const collections = ['roomallocations', 'roomallocationaudits', 'hostelrooms', 'hostelfloors', 'hostels'];

  for (const colName of collections) {
    const list = await db.listCollections({ name: colName }).toArray();
    if (list.length > 0) {
      console.log(`Dropping collection ${colName}...`);
      await db.collection(colName).drop();
    }
  }

  console.log('Rollback completed.');
  await mongoose.disconnect();
}

if (require.main === module) {
  runRollback().catch((err) => {
    console.error('Rollback failed:', err);
    process.exit(1);
  });
}

module.exports = runRollback;
