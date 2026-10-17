/**
 * ApprovalAuditLog Model
 * Complete immutable event trail for the parent approval lifecycle.
 */

const mongoose = require('mongoose');

const approvalAuditLogSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      enum: [
        'INVITE_SENT',
        'INVITE_OPENED',
        'PARENT_ACTIVATED',
        'REQUEST_NOTIFIED',
        'REMINDER_SENT',
        'DECISION_MADE',
        'EXPIRED',
        'OVERRIDE_USED',
        'GUARDIAN_UPDATED',
        'INVITE_RESENT',
        'PASSWORD_RESET',
        'LOGIN_OTP_SENT',
      ],
      required: true,
      index: true,
    },
    home_visit_request_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HomeVisitLog',
      default: null,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    guardian_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guardian',
      default: null,
      index: true,
    },
    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actor_role: {
      type: String,
      default: null,
    },
    actor_email: {
      type: String,
      default: null,
      trim: true,
    },
    ip_address: {
      type: String,
      default: '',
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

approvalAuditLogSchema.index({ event: 1, timestamp: -1 });
approvalAuditLogSchema.index({ home_visit_request_id: 1, timestamp: -1 });
approvalAuditLogSchema.index({ student_id: 1, timestamp: -1 });

module.exports = mongoose.model('ApprovalAuditLog', approvalAuditLogSchema);
