/**
 * ArchiveJob Model
 * Manifest document for long-term historical archives.
 *
 * Status lifecycle:
 *  PENDING -> PROCESSING -> UPLOADED -> VERIFIED -> DELETING -> COMPLETED (or FAILED)
 */

const mongoose = require('mongoose');

const archiveJobSchema = new mongoose.Schema(
  {
    archiveId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    collectionName: {
      type: String,
      enum: ['InOutLog', 'HomeVisitLog', 'Complaint'],
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        'PENDING',
        'PROCESSING',
        'UPLOADED',
        'VERIFIED',
        'DELETING',
        'COMPLETED',
        'FAILED',
      ],
      default: 'PENDING',
      required: true,
    },
    recordCount: {
      type: Number,
      default: 0,
    },
    compressedSize: {
      type: Number,
      default: 0, // bytes
    },
    checksum: {
      type: String,
      default: null, // SHA-256 hex string
    },
    storageKey: {
      type: String,
      required: true, // e.g. 2026/01/inout-logs-2026-01.json.gz
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    deletedCount: {
      type: Number,
      default: 0,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

archiveJobSchema.index({ collectionName: 1, periodStart: 1, periodEnd: 1 });
archiveJobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ArchiveJob', archiveJobSchema);
