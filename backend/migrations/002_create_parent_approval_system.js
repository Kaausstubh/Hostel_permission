/**
 * Migration: 002_create_parent_approval_system.js
 * 1. Synchronizes indexes for Guardian, GuardianInvitation, ParentApproval, ApprovalAuditLog, and PendingRegistration.
 * 2. Backfills all existing HomeVisitLog documents with parent_approval_status = 'legacy'.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Guardian = require('../models/Guardian');
const GuardianInvitation = require('../models/GuardianInvitation');
const ParentApproval = require('../models/ParentApproval');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const PendingRegistration = require('../models/PendingRegistration');
const HomeVisitLog = require('../models/HomeVisitLog');
const User = require('../models/User');

async function runMigration() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  console.log('Ensuring indexes for Parent Approval module...');
  await Guardian.syncIndexes();
  console.log('✔ Guardian indexes synced.');

  await GuardianInvitation.syncIndexes();
  console.log('✔ GuardianInvitation indexes synced.');

  await ParentApproval.syncIndexes();
  console.log('✔ ParentApproval partial unique & audit indexes synced.');

  await ApprovalAuditLog.syncIndexes();
  console.log('✔ ApprovalAuditLog indexes synced.');

  await PendingRegistration.syncIndexes();
  console.log('✔ PendingRegistration TTL indexes synced.');

  await HomeVisitLog.syncIndexes();
  console.log('✔ HomeVisitLog indexes synced.');

  await User.syncIndexes();
  console.log('✔ User indexes synced.');

  // Backfill existing HomeVisitLog records without parent_approval_status or set to null/empty
  console.log('Backfilling existing HomeVisitLog records as parent_approval_status: "legacy"...');
  const result = await HomeVisitLog.updateMany(
    {
      $or: [
        { parent_approval_status: { $exists: false } },
        { parent_approval_status: null },
      ],
    },
    {
      $set: { parent_approval_status: 'legacy' },
    }
  );
  console.log(`✔ Backfilled ${result.modifiedCount} existing home-visit records as 'legacy'.`);

  console.log('\nMigration 002 completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  runMigration().catch((err) => {
    console.error('Migration 002 failed:', err);
    process.exit(1);
  });
}

module.exports = runMigration;
