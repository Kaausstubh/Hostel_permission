/**
 * HomeVisitLog Model
 * Tracks student home visit requests with multi-level approvals.
 * Student info denormalized for readable historical records.
 */

const mongoose = require('mongoose');

const homeVisitLogSchema = new mongoose.Schema(
  {
    // ── Reference ────────────────────────────────────────────────────────────
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Denormalized student info ─────────────────────────────────────────────
    name:   { type: String, default: '' },
    rollNo: { type: String, default: '' },

    // ── Parent contact snapshot (for warden call) ─────────────────────────────
    parent_phone: { type: String, default: null }, // E.164, e.g. +9198...

    // ── Warden call confirmation ──────────────────────────────────────────────
    parent_call_confirmed: { type: Boolean, default: false },
    parent_call_confirmed_at: { type: Date, default: null },
    parent_call_confirmed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ── Request details ───────────────────────────────────────────────────────
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    leave_date: {
      // Planned departure (YYYY-MM-DD)
      type: String,
      required: true,
    },
    return_date: {
      // Planned return (YYYY-MM-DD)
      type: String,
      required: true,
    },

    // ── Actual gate times (set via QR scan) ───────────────────────────────────
    // `actual_out_time`/`actual_in_time` are the fields used by the current
    // scan flow. Keep the legacy `actual_out`/`actual_in` fields as well so we
    // do not break older documents or any historical reads.
    actual_out: {
      type: Date,
      default: null,
    },
    actual_in: {
      type: Date,
      default: null,
    },
    actual_out_time: {
      type: Date,
      default: null,
    },
    actual_in_time: {
      type: Date,
      default: null,
    },

    // ── Legacy parent workflow fields (kept for backward compatibility) ──────
    // Not used in the "warden calls parent" flow, but left to avoid breaking
    // existing documents/routes.
    parent_status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    parent_response_time: { type: Date, default: null },
    warden_status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    warden_response_time: {
      type: Date,
      default: null,
    },

    // ── QR ────────────────────────────────────────────────────────────────────
    qr_token:    { type: String, default: null },
    qr_used_out: { type: Boolean, default: false },
    qr_used_in:  { type: Boolean, default: false },

    // ── Overall status ────────────────────────────────────────────────────────
    overall_status: {
      type: String,
      enum: ['pending', 'parent_approved', 'approved', 'rejected', 'completed'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

homeVisitLogSchema.index({ student_id: 1, createdAt: -1 });
homeVisitLogSchema.index({ overall_status: 1, createdAt: -1 });
homeVisitLogSchema.index({ warden_status: 1, parent_call_confirmed: 1, createdAt: -1 });
homeVisitLogSchema.index({ leave_date: 1, return_date: 1 });
homeVisitLogSchema.index({ student_id: 1, overall_status: 1, leave_date: 1, return_date: 1 });

module.exports = mongoose.model('HomeVisitLog', homeVisitLogSchema);
