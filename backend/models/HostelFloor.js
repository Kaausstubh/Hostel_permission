/**
 * HostelFloor Model
 * Represents a floor within a hostel (e.g., Basement Wing B, Ground Floor, 1st Floor, etc.).
 */

const mongoose = require('mongoose');

const hostelFloorSchema = new mongoose.Schema(
  {
    hostel_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hostel',
      required: [true, 'Hostel ID is required'],
      index: true,
    },
    floor_number: {
      type: Number,
      required: [true, 'Floor number is required'],
    },
    label: {
      type: String,
      required: [true, 'Floor label is required'],
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Unique floor per hostel
hostelFloorSchema.index({ hostel_id: 1, floor_number: 1 }, { unique: true });

module.exports = mongoose.model('HostelFloor', hostelFloorSchema);
