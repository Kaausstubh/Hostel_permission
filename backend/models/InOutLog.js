/**
 * InOutLog Model
 * Tracks daily gate entry/exit of students.
 * Student info is DENORMALIZED (copied from User at scan time)
 * so logs remain readable even if the user record changes later.
 */

const mongoose = require('mongoose');

const inOutLogSchema = new mongoose.Schema(
  {
    // ── Reference ────────────────────────────────────────────────────────────
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Denormalized student info (auto-populated on scan) ────────────────────
    name:        { type: String, default: '' },
    rollNo:      { type: String, default: '' },
    email:       { type: String, default: '' },
    phone:       { type: String, default: '' },
    parentPhone: { type: String, default: '' },
    hostel:      { type: String, default: '' },

    // ── QR & Status ───────────────────────────────────────────────────────────
    qr_token: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['IN', 'OUT'],
      required: true,
    },
    out_time: {
      // First scan time (OUT)
      type: Date,
      default: null,
    },
    in_time: {
      // Second scan time (IN)
      type: Date,
      default: null,
    },
    timestamp: {
      // Last scan time (OUT or IN)
      type: Date,
      default: Date.now,
    },
    date: {
      // YYYY-MM-DD string for easy daily queries
      type: String,
      required: true,
    },
    returned: {
      // true = student came back IN, false = still OUT
      type: Boolean,
      default: false,
    },
    scannedBy: {
      // Security guard who processed the scan
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    alertSent: {
      // Was the 11:59 PM not-returned alert sent?
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Composite index for fast daily not-returned queries
inOutLogSchema.index({ status: 1, returned: 1, date: 1 });
inOutLogSchema.index({ student_id: 1, date: -1, timestamp: -1 });
inOutLogSchema.index({ qr_token: 1 }, { unique: true });
inOutLogSchema.index({ date: -1, timestamp: -1 });

module.exports = mongoose.model('InOutLog', inOutLogSchema);
