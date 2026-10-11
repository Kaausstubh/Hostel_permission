/**
 * RoomAllocationAudit Model
 * Immutable audit trail tracking every allocate, transfer, vacate, and bulk import event.
 */

const mongoose = require('mongoose');

const roomAllocationAuditSchema = new mongoose.Schema(
  {
    allocation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomAllocation',
      default: null,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['ALLOCATE', 'TRANSFER', 'VACATE', 'BULK_IMPORT'],
      required: true,
      index: true,
    },
    old_room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelRoom',
      default: null,
    },
    new_room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelRoom',
      default: null,
    },
    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actor_role: {
      type: String,
      default: 'warden',
    },
    reason: {
      type: String,
      required: [true, 'Reason is required for allocation audit logging'],
      trim: true,
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

roomAllocationAuditSchema.index({ student_id: 1, createdAt: -1 });
roomAllocationAuditSchema.index({ old_room_id: 1, createdAt: -1 });
roomAllocationAuditSchema.index({ new_room_id: 1, createdAt: -1 });
roomAllocationAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('RoomAllocationAudit', roomAllocationAuditSchema);
