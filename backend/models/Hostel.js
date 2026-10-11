/**
 * Hostel Model
 * Represents a hostel building (e.g. BH2) in the campus management system.
 */

const mongoose = require('mongoose');

const hostelSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Hostel code is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, 'Hostel name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['boys', 'girls', 'co-ed'],
      default: 'boys',
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Hostel', hostelSchema);
