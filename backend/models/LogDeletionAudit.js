/**
 * LogDeletionAudit Model
 * Records an immutable audit log whenever gate scan or home visit logs
 * are deleted or purged by hostel staff / warden / admin.
 */
const mongoose = require('mongoose');

const logDeletionAuditSchema = new mongoose.Schema(
  {
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    deletedByName: {
      type: String,
      required: true,
      default: 'Authorized Staff',
    },
    deletedByEmail: {
      type: String,
      default: '',
    },
    deletedByRole: {
      type: String,
      default: 'warden',
    },
    action: {
      type: String,
      enum: [
        'DELETE_SINGLE_GATE',
        'DELETE_ALL_GATE',
        'DELETE_SINGLE_HOME',
        'DELETE_ALL_HOME',
        'PURGE_GATE',
        'PURGE_HOME',
        'PURGE_ALL',
        'WIPE_LOGS',
      ],
      required: true,
    },
    targetType: {
      type: String,
      enum: ['GATE_INOUT', 'HOME_VISIT', 'ALL_LOGS'],
      required: true,
    },
    deletedCount: {
      type: Number,
      required: true,
      default: 1,
    },
    description: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

logDeletionAuditSchema.index({ timestamp: -1 });
logDeletionAuditSchema.index({ targetType: 1, timestamp: -1 });
logDeletionAuditSchema.index({ deletedBy: 1, timestamp: -1 });

module.exports = mongoose.model('LogDeletionAudit', logDeletionAuditSchema);
