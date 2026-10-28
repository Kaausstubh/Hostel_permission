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
    name:          { type: String, default: '' },
    rollNo:        { type: String, default: '' },
    hostel:        { type: String, default: '' },
    roomNo:        { type: String, default: '' },
    student_photo: { type: String, default: null },

    // ── Parent contact snapshot (for warden call) ─────────────────────────────
    parent_phone: { type: String, default: null }, // E.164, e.g. +9198...
    parent_phone_alt: { type: String, default: null }, // Second parent number

    // ── Warden call confirmation ──────────────────────────────────────────────
    parent_call_confirmed: { type: Boolean, default: false },
    parent_call_confirmed_at: { type: Date, default: null },
    parent_call_confirmed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ── Request details ───────────────────────────────────────────────────────
    place: {
      type: String,
      default: '',
      trim: true,
    },
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

    // ── Security Guard who performed gate scan ───────────────────────────────
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
    scannedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    scanned_by_name: {
      type: String,
      default: '',
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
      enum: ['pending', 'parent_approved', 'approved', 'rejected', 'completed', 'parent_no_response'],
      default: 'pending',
    },

    // ── Digital Parent Approval Workflow ──────────────────────────────────────
    parent_approval_status: {
      type: String,
      enum: ['legacy', 'pending', 'parent_approved', 'parent_rejected', 'parent_no_response'],
      default: 'pending',
      index: true,
    },
    parent_email: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    guardian_emails: [{
      type: String,
      lowercase: true,
      trim: true,
    }],
    parent_name: {
      type: String,
      default: '',
      trim: true,
    },
    departure_time: {
      type: String,
      default: '09:00 AM',
      trim: true,
    },
    return_time: {
      type: String,
      default: '08:00 PM',
      trim: true,
    },
    parent_token_hash: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    parent_token_expires_at: {
      type: Date,
      default: null,
      index: true,
    },
    parent_decision_at: {
      type: Date,
      default: null,
    },
    parent_decision_ip: {
      type: String,
      default: null,
    },
    parent_decision_remarks: {
      type: String,
      default: '',
      trim: true,
    },
    final_parent_decision_at: {
      type: Date,
      default: null,
    },
    parent_reminder_sent: {
      type: Boolean,
      default: false,
    },
    parent_decision_source: {
      type: String,
      enum: ['PARENT_PORTAL', 'PARENT_EMAIL_LINK', 'STAFF_PHONE_OVERRIDE', null],
      default: null,
    },
    accompanying: {
      type: String,
      default: '',
      trim: true,
    },

    // ── Email Notification Status via Google Apps Script / Free Tier ──────────
    email_notification_status: {
      type: String,
      enum: ['PENDING', 'SUBMITTED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    email_sent_at: {
      type: Date,
      default: null,
    },
    email_failure_reason: {
      type: String,
      default: null,
    },
    email_idempotency_key: {
      type: String,
      default: null,
      index: true,
      sparse: true,
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
homeVisitLogSchema.index({ qr_token: 1 }, { sparse: true });
homeVisitLogSchema.index({ overall_status: 1, qr_used_out: 1, qr_used_in: 1 });
homeVisitLogSchema.index({ createdAt: -1 });
homeVisitLogSchema.index({ actual_out_time: -1 });
homeVisitLogSchema.index({ actual_in_time: -1 });
homeVisitLogSchema.index({ rollNo: 1, createdAt: -1 });
homeVisitLogSchema.index({ name: 1, createdAt: -1 });
homeVisitLogSchema.index({ student_id: 1, overall_status: 1, createdAt: -1 });
homeVisitLogSchema.index({ overall_status: 1, leave_date: 1, return_date: 1 });
homeVisitLogSchema.index({ overall_status: 1, qr_used_in: 1, createdAt: -1 });
homeVisitLogSchema.index({ student_id: 1, overall_status: 1, leave_date: -1, createdAt: -1 });

module.exports = mongoose.model('HomeVisitLog', homeVisitLogSchema);
