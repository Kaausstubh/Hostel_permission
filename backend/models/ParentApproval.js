/**
 * ParentApproval Model
 * Append-only audit record for all digital parent decisions and staff phone overrides.
 *
 * Immutability Guarantee:
 * - Records are strictly write-once.
 * - Mongoose pre-hooks actively reject update, replace, and delete operations.
 * - Partial unique index prevents a guardian from submitting duplicate decisions for the same request,
 *   while cleanly allowing staff phone overrides even when no guardian record exists.
 */

const mongoose = require('mongoose');

const parentApprovalSchema = new mongoose.Schema(
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
    decision: {
      type: String,
      enum: ['APPROVED', 'REJECTED'],
      required: true,
    },
    decided_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
    decided_by_email: {
      type: String,
      required: true,
      trim: true,
    },
    decided_by_name: {
      type: String,
      default: '',
      trim: true,
    },
    decided_by_phone: {
      type: String,
      default: '',
      trim: true,
    },
    remarks: {
      type: String,
      maxlength: 500,
      default: '',
      trim: true,
    },
    decision_source: {
      type: String,
      enum: ['PARENT_PORTAL', 'STAFF_PHONE_OVERRIDE'],
      required: true,
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
    staff_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    override_reason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// ── Partial Unique Index ───────────────────────────────────────────────────────
// Enforces that a specific guardian can submit at most one decision per home-visit request.
// Partial filter ensures staff phone overrides (where guardian_id may be null) do not conflict.
parentApprovalSchema.index(
  { home_visit_request_id: 1, guardian_id: 1 },
  {
    unique: true,
    partialFilterExpression: { guardian_id: { $exists: true, $type: 'objectId' } },
  }
);

parentApprovalSchema.index({ student_id: 1, decided_at: -1 });
parentApprovalSchema.index({ decided_at: -1 });

// ── Append-Only Enforcement Hooks ──────────────────────────────────────────────

// Document middleware: disallow re-saving an existing document
parentApprovalSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('ParentApproval records are immutable and append-only. Modification is forbidden.'));
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
  parentApprovalSchema.pre(op, function () {
    throw new Error(`ParentApproval records are immutable and append-only. Operation '${op}' is strictly forbidden.`);
  });
});

// Also disallow bulkWrite updates/deletes if called on model
parentApprovalSchema.pre('bulkWrite', function () {
  throw new Error("ParentApproval records are immutable and append-only. 'bulkWrite' is strictly forbidden.");
});

module.exports = mongoose.model('ParentApproval', parentApprovalSchema);
