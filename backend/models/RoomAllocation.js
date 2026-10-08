/**
 * RoomAllocation Model
 * Manages the assignment of students to specific rooms in a hostel.
 * Enforces one active allocation per student via partial unique index.
 */

const mongoose = require('mongoose');

const roomAllocationSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student ID is required'],
      index: true,
    },
    room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelRoom',
      required: [true, 'Room ID is required'],
      index: true,
    },
    bed_number: {
      type: String,
      default: null,
      trim: true,
    },
    allocated_on: {
      type: Date,
      default: Date.now,
      required: true,
    },
    vacated_on: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'vacated', 'transferred'],
      default: 'active',
      index: true,
    },
    allocated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    remarks: {
      type: String,
      default: '',
      trim: true,
    },
    source: {
      type: String,
      enum: ['pdf_import', 'manual', 'transfer'],
      default: 'manual',
    },
  },
  {
    timestamps: true,
  }
);

// Crucial: Partial unique index to enforce exactly ONE active allocation per student
roomAllocationSchema.index(
  { student_id: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_allocation_per_student',
  }
);

// Performance indexes for attendance roster lookups and history
roomAllocationSchema.index({ room_id: 1, status: 1 });
roomAllocationSchema.index({ student_id: 1, allocated_on: -1 });

module.exports = mongoose.model('RoomAllocation', roomAllocationSchema);
