/**
 * HostelRoom Model
 * Represents a room within a hostel floor, its capacity, and availability status.
 */

const mongoose = require('mongoose');

const hostelRoomSchema = new mongoose.Schema(
  {
    hostel_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: [true, 'Hostel ID is required'],
      index: true,
    },
    floor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelFloor',
      required: [true, 'Floor ID is required'],
      index: true,
    },
    room_number: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true,
      uppercase: true,
    },
    capacity: {
      type: Number,
      required: [true, 'Capacity is required'],
      default: 4,
      min: [1, 'Capacity must be at least 1'],
    },
    room_type: {
      type: String,
      default: 'Standard',
      trim: true,
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'full', 'maintenance', 'blocked'],
      default: 'available',
      index: true,
    },
    remarks: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Room number must be unique within a hostel
hostelRoomSchema.index({ hostel_id: 1, room_number: 1 }, { unique: true });
hostelRoomSchema.index({ floor_id: 1, room_number: 1 });
hostelRoomSchema.index({ hostel_id: 1, status: 1 });

module.exports = mongoose.model('HostelRoom', hostelRoomSchema);
