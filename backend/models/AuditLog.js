/**
 * AuditLog Model
 * Operational audit logging for data archival and historical retrieval events.
 */

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      enum: [
        'ARCHIVE_STARTED',
        'ARCHIVE_UPLOADED',
        'ARCHIVE_VERIFIED',
        'ARCHIVE_DELETE_STARTED',
        'ARCHIVE_DELETE_COMPLETED',
        'ARCHIVE_COMPLETED',
        'ARCHIVE_FAILED',
        'ARCHIVE_RETRIEVED',
      ],
      required: true,
    },
    archiveId: {
      type: String,
      default: null,
    },
    collectionName: {
      type: String,
      default: null,
    },
    recordCount: {
      type: Number,
      default: 0,
    },
    result: {
      type: String,
      default: 'SUCCESS',
    },
    error: {
      type: String,
      default: null,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ event: 1, timestamp: -1 });
auditLogSchema.index({ archiveId: 1, timestamp: -1 });
auditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
