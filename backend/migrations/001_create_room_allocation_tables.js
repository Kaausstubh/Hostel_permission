/**
 * Migration: 001_create_room_allocation_tables.js
 * Creates indexes for Hostel, HostelFloor, HostelRoom, RoomAllocation, and RoomAllocationAudit.
 * Ensures the unique and partial filter constraints are applied in MongoDB.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const RoomAllocationAudit = require('../models/RoomAllocationAudit');

async function runMigration() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  console.log('Ensuring indexes for Room Allocation module...');
  await Hostel.syncIndexes();
  console.log('✔ Hostel indexes synced.');

  await HostelFloor.syncIndexes();
  console.log('✔ HostelFloor indexes synced.');

  await HostelRoom.syncIndexes();
  console.log('✔ HostelRoom indexes synced.');

  await RoomAllocation.syncIndexes();
  console.log('✔ RoomAllocation partial unique & performance indexes synced.');

  await RoomAllocationAudit.syncIndexes();
  console.log('✔ RoomAllocationAudit indexes synced.');

  // Purge any test hostels
  await Hostel.deleteMany({ code: /^test/i });

  // Floors for BH1 and BH2:
  // -1: Basement / Wing B
  //  0: Ground Floor
  //  1: 1st Floor
  //  2: 2nd Floor
  //  3: 3rd Floor
  const floorsData = [
    { floor_number: -1, label: 'Basement / Wing B' },
    { floor_number: 0, label: 'Ground Floor' },
    { floor_number: 1, label: '1st Floor' },
    { floor_number: 2, label: '2nd Floor' },
    { floor_number: 3, label: '3rd Floor' },
  ];

  const hostelConfigs = [
    { code: 'BH1', name: "Boys' Hostel 1", type: 'boys', description: 'Hostel BH1 structure for students' },
    { code: 'BH2', name: 'Boys Hostel 2', type: 'boys', description: 'Hostel BH2 structure for students' },
  ];

  for (const hc of hostelConfigs) {
    let hostel = await Hostel.findOne({ code: hc.code });
    if (!hostel) {
      hostel = await Hostel.create({
        code: hc.code,
        name: hc.name,
        type: hc.type,
        active: true,
        description: hc.description,
      });
      console.log(`✔ Initialized ${hc.code} Hostel entry.`);
    } else {
      console.log(`ℹ ${hc.code} Hostel entry already exists.`);
    }

    for (const f of floorsData) {
      await HostelFloor.findOneAndUpdate(
        { hostel_id: hostel._id, floor_number: f.floor_number },
        { $setOnInsert: { label: f.label, active: true } },
        { upsert: true, new: true }
      );
    }
    console.log(`✔ ${hc.code} Floor structure initialized (-1: Basement, 0: Ground, 1: 1st, 2: 2nd, 3: 3rd).`);
  }

  console.log('\nMigration 001 completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  runMigration().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = runMigration;
