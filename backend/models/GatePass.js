/**
 * GatePass Model
 * Persistent MongoDB source of truth for active student gate passes (Daily In/Out and Home Visit).
 * Survives logins, browser refreshes, restarts, and multi-day movements until student returns to campus.
 */

const mongoose = require('mongoose');

const gatePassSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    pass_type: {
      type: String,
      enum: ['IN_OUT', 'HOME_VISIT'],
      default: 'IN_OUT',
      required: true,
      index: true,
    },
    home_visit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HomeVisitLog',
      default: null,
      index: true,
    },
    qr_token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'OUTSIDE', 'COMPLETED', 'CANCELLED'],
      default: 'PENDING',
      required: true,
      index: true,
    },
    place: {
      type: String,
      default: '',
      trim: true,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
    out_time: {
      type: Date,
      default: null,
    },
    in_time: {
      type: Date,
      default: null,
    },
    completed_at: {
      type: Date,
      default: null,
    },
    scanned_by_out: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    scanned_by_in: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    scanned_by_name: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast lookups & concurrency protection
gatePassSchema.index({ student_id: 1, status: 1 });
gatePassSchema.index({ student_id: 1, pass_type: 1, status: 1 });
gatePassSchema.index({ qr_token: 1, status: 1 });
gatePassSchema.index({ createdAt: -1 });

module.exports = mongoose.model('GatePass', gatePassSchema);
