/**
 * Room Model
 * Represents a physical or configured hostel room.
 *
 * Current scope: BH2 ('Krishna').
 * Designed to easily support BH1, GH1, and GH2 in future phases.
 */

const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    hostelCode: {
      type: String,
      required: [true, 'Hostel code is required'],
      uppercase: true,
      trim: true,
      enum: ['BH1', 'BH2', 'GH', 'GH1', 'GH2'],
      index: true,
    },

    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true,
    },

    floor: {
      // e.g. "Basement", "Ground", "1st Floor", "2nd Floor", "3rd Floor"
      type: String,
      trim: true,
      default: 'General',
    },

    // Configured maximum bed capacity.
    // If not configured yet, defaults to null.
    // "If room capacity has not been configured, display 'Capacity not configured' instead of assuming a capacity."
    capacity: {
      type: Number,
      min: [1, 'Capacity must be at least 1 bed'],
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: Prevent duplicate room numbers within the same hostel
roomSchema.index({ hostelCode: 1, roomNumber: 1 }, { unique: true });
roomSchema.index({ hostelCode: 1, isActive: 1 });

module.exports = mongoose.model('Room', roomSchema);
