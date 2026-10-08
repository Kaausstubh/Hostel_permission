/**
 * Attendance Module Database Initialization & Migration Script
 *
 * 1. Creates all collections and indexes for:
 *    - HostelGeofence
 *    - AttendanceRound
 *    - RoomAttendanceRequest
 *    - RequestResponse
 *    - AttendanceRecord
 *    - StudentDevice
 *    - AttendanceAuditLog
 *
 * 2. Seeds initial geofence boundaries for hostels (BH1, BH2, GH) with 25m buffer.
 * 3. Supports clean rollback via `--rollback` without affecting any legacy tables.
 *
 * Usage:
 *   node backend/scripts/initAttendanceModule.js
 *   node backend/scripts/initAttendanceModule.js --rollback
 */

require('dotenv').config();
const mongoose = require('mongoose');

const HostelGeofence = require('../models/HostelGeofence');
const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const StudentDevice = require('../models/StudentDevice');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');

// Realistic campus hostel geofence polygons (approx. 60m x 40m bounding quadrilaterals)
const DEFAULT_GEOFENCES = [
  {
    hostel: 'BH1',
    name: "Boys' Hostel 1 (BH1)",
    polygon: [
      { lat: 18.53050, lng: 73.85600 },
      { lat: 18.53120, lng: 73.85600 },
      { lat: 18.53120, lng: 73.85680 },
      { lat: 18.53050, lng: 73.85680 },
    ],
    buffer_m: 25,
    accuracy_threshold_m: 50,
    active: true,
  },
  {
    hostel: 'BH2',
    name: "Boys' Hostel 2 (BH2)",
    polygon: [
      { lat: 18.53150, lng: 73.85600 },
      { lat: 18.53220, lng: 73.85600 },
      { lat: 18.53220, lng: 73.85680 },
      { lat: 18.53150, lng: 73.85680 },
    ],
    buffer_m: 25,
    accuracy_threshold_m: 50,
    active: true,
  },
  {
    hostel: 'GH',
    name: "Girls' Hostel (GH)",
    polygon: [
      { lat: 18.53050, lng: 73.85720 },
      { lat: 18.53120, lng: 73.85720 },
      { lat: 18.53120, lng: 73.85800 },
      { lat: 18.53050, lng: 73.85800 },
    ],
    buffer_m: 25,
    accuracy_threshold_m: 50,
    active: true,
  },
];

async function run() {
  const isRollback = process.argv.includes('--rollback');
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';

  console.log(`📡 Connecting to MongoDB: ${mongoUri.replace(/:[^:]*@/, ':****@')}`);
  await mongoose.connect(mongoUri);

  if (isRollback) {
    console.log('\n⚠️  ROLLBACK REQUESTED: Dropping attendance collections...');
    const collections = [
      'hostelgeofences',
      'attendancerounds',
      'roomattendancerequests',
      'requestresponses',
      'attendancerecords',
      'studentdevices',
      'attendanceauditlogs',
    ];

    for (const colName of collections) {
      try {
        await mongoose.connection.collection(colName).drop();
        console.log(`  Dropped collection: ${colName}`);
      } catch (err) {
        if (err.code === 26) {
          // NamespaceNotFound (collection doesn't exist)
          console.log(`  Collection ${colName} does not exist (skipped)`);
        } else {
          console.warn(`  Warning dropping ${colName}:`, err.message);
        }
      }
    }

    console.log('✅ Rollback complete. Existing legacy collections untouched.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n🚀 Initializing Attendance Module schemas and indexes...');

  // Ensure indexes on all models
  await HostelGeofence.init();
  console.log('  ✅ HostelGeofence indexes verified');

  await AttendanceRound.init();
  console.log('  ✅ AttendanceRound indexes verified');

  await RoomAttendanceRequest.init();
  console.log('  ✅ RoomAttendanceRequest indexes verified');

  await RequestResponse.init();
  console.log('  ✅ RequestResponse indexes verified');

  await AttendanceRecord.init();
  console.log('  ✅ AttendanceRecord indexes verified');

  await StudentDevice.init();
  console.log('  ✅ StudentDevice indexes verified');

  await AttendanceAuditLog.init();
  console.log('  ✅ AttendanceAuditLog indexes verified');

  // Seed default Geofences
  console.log('\n📍 Seeding initial hostel geofence boundaries...');
  for (const gf of DEFAULT_GEOFENCES) {
    const existing = await HostelGeofence.findOne({ hostel: gf.hostel });
    if (!existing) {
      await HostelGeofence.create(gf);
      console.log(`  ➕ Created geofence for ${gf.hostel} (${gf.name}) with buffer ${gf.buffer_m}m`);
    } else {
      console.log(`  ℹ️ Geofence for ${gf.hostel} already exists (skipping overwrite)`);
    }
  }

  console.log('\n🎉 Attendance Module database initialization completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { run, DEFAULT_GEOFENCES };
