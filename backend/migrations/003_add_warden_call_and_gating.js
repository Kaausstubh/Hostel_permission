/**
 * Migration: 003_add_warden_call_and_gating.js
 * 1. Synchronizes indexes for WardenCallLog, HomeVisitLog, and ApprovalAuditLog.
 * 2. Backfills all pre-existing HomeVisitLog documents with warden_flow_version = 1 (legacy flow exemption)
 *    so existing requests and passes keep working without disruption.
 * 3. All new requests created after this migration default to warden_flow_version = 2 (warden call & final approve gating).
 */

require('dotenv').config();
const mongoose = require('mongoose');

const WardenCallLog = require('../models/WardenCallLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');

async function runMigration() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  console.log('Ensuring indexes for Warden Call & Gating module...');
  await WardenCallLog.syncIndexes();
  console.log('✔ WardenCallLog indexes synced.');

  await HomeVisitLog.syncIndexes();
  console.log('✔ HomeVisitLog indexes synced.');

  await ApprovalAuditLog.syncIndexes();
  console.log('✔ ApprovalAuditLog indexes synced.');

  // Backfill existing HomeVisitLog records without warden_flow_version
  console.log('Backfilling pre-existing HomeVisitLog records with warden_flow_version: 1 (legacy flow exemption)...');
  const result = await HomeVisitLog.updateMany(
    {
      $or: [
        { warden_flow_version: { $exists: false } },
        { warden_flow_version: null },
      ],
    },
    {
      $set: {
        warden_flow_version: 1,
        warden_call_logged: false,
        first_call_at: null,
        warden_decision: null,
        warden_decided_by: null,
        warden_decided_at: null,
        warden_decision_note: '',
        warden_spoke_with_guardian_id: null,
      },
    }
  );
  console.log(`✔ Backfilled ${result.modifiedCount} pre-existing records as warden_flow_version: 1.`);

  // Mark already-approved legacy records with warden_decision: 'approved'
  const approvedResult = await HomeVisitLog.updateMany(
    {
      warden_flow_version: 1,
      overall_status: 'approved',
      warden_decision: null,
    },
    {
      $set: { warden_decision: 'approved' },
    }
  );
  console.log(`✔ Updated ${approvedResult.modifiedCount} approved legacy records with warden_decision: 'approved'.`);

  // Mark already-rejected legacy records with warden_decision: 'rejected'
  const rejectedResult = await HomeVisitLog.updateMany(
    {
      warden_flow_version: 1,
      overall_status: 'rejected',
      warden_decision: null,
    },
    {
      $set: { warden_decision: 'rejected' },
    }
  );
  console.log(`✔ Updated ${rejectedResult.modifiedCount} rejected legacy records with warden_decision: 'rejected'.`);

  console.log('\nMigration 003 completed successfully!');
  await mongoose.disconnect();
}

if (require.main === module) {
  runMigration().catch((err) => {
    console.error('Migration 003 failed:', err);
    process.exit(1);
  });
}

module.exports = runMigration;
