/**
 * WardenCallLog Model
 * Append-only audit record for warden-initiated phone calls to parents/guardians.
 *
 * Immutability Guarantee:
 * - Records are strictly write-once.
 * - Mongoose pre-hooks actively reject update, replace, and delete operations.
 * - Append-only enforcement at schema level.
 */

const mongoose = require('mongoose');

const wardenCallLogSchema = new mongoose.Schema(
  {
    home_visit_request_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HomeVisitLog',
      required: true,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    guardian_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guardian',
      default: null,
      index: true,
    },
    guardian_slot: {
      type: Number,
      default: null,
    },
    guardian_relationship: {
      type: String,
      default: 'Guardian',
      trim: true,
    },
    phone_called: {
      type: String,
      required: true,
      trim: true,
    },
    warden_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    warden_name: {
      type: String,
      required: true,
      trim: true,
    },
    warden_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    initiated_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    ip_address: {
      type: String,
      default: '',
    },
    user_agent: {
      type: String,
      default: '',
    },
    source: {
      type: String,
      default: 'WARDEN_PORTAL_DIAL_BUTTON',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Compound indexes for deduplication lookups and history queries
wardenCallLogSchema.index({ home_visit_request_id: 1, initiated_at: -1 });
wardenCallLogSchema.index({ home_visit_request_id: 1, warden_user_id: 1, initiated_at: -1 });
wardenCallLogSchema.index({ student_id: 1, initiated_at: -1 });

// ── Append-Only Enforcement Hooks ──────────────────────────────────────────────

// Document middleware: disallow re-saving an existing document
wardenCallLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('WardenCallLog records are immutable and append-only. Modification is forbidden.'));
  }
  next();
});

// Query middleware: disallow all update, replace, and delete operations
const BLOCKED_QUERY_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'remove',
];

BLOCKED_QUERY_OPERATIONS.forEach((op) => {
  wardenCallLogSchema.pre(op, function () {
    throw new Error(`WardenCallLog records are immutable and append-only. Operation '${op}' is strictly forbidden.`);
  });
});

// Also disallow bulkWrite updates/deletes if called on model
wardenCallLogSchema.pre('bulkWrite', function () {
  throw new Error("WardenCallLog records are immutable and append-only. 'bulkWrite' is strictly forbidden.");
});

module.exports = mongoose.model('WardenCallLog', wardenCallLogSchema);
