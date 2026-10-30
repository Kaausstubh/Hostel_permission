/**
 * AttendanceAuditLog Model
 * Tamper-evident audit logging for overrides, skip actions, and administrative approvals.
 */

const mongoose = require('mongoose');

const attendanceAuditLogSchema = new mongoose.Schema(
  {
    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actor_role: {
      type: String,
      required: true,
    },
    actor_name: {
      type: String,
      default: '',
    },
    action: {
      type: String,
      required: true,
      index: true,
      enum: [
        'ROOM_SKIPPED',
        'ROOM_REOPENED',
        'MANUAL_OVERRIDE',
        'ROUND_STARTED',
        'ROUND_COMPLETED',
        'ROUND_REOPENED',
        'AUTO_ATTENDANCE_MARKED',
        'DEVICE_REGISTERED',
        'DEVICE_APPROVED',
        'DEVICE_REVOKED',
        'GEOFENCE_UPDATED',
        'ATTENDANCE_RECORD_DELETED',
        'ATTENDANCE_RECORDS_CLEARED',
      ],
    },
    entity: {
      type: String,
      required: true,
    },
    entity_id: {
      type: String,
      required: true,
      index: true,
    },
    old_value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    new_value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      required: [true, 'A reason is mandatory for audit trail'],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

attendanceAuditLogSchema.index({ entity: 1, entity_id: 1, createdAt: -1 });
attendanceAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AttendanceAuditLog', attendanceAuditLogSchema);
