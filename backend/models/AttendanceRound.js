/**
 * AttendanceRound Model
 * Represents an active or completed room-by-room round conducted by staff on a floor.
 */

const mongoose = require('mongoose');

const attendanceRoundSchema = new mongoose.Schema(
  {
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    session_name: {
      type: String,
      default: 'Night Attendance',
      trim: true,
    },
    hostel: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    floor: {
      type: String, // e.g. "1", "2", "Ground"
      required: true,
      trim: true,
    },
    staff_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    window_start: {
      type: Date,
      default: Date.now,
    },
    window_end: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'expired', 'abandoned'],
      default: 'active',
    },
    started_at: {
      type: Date,
      default: Date.now,
    },
    completed_at: {
      type: Date,
      default: null,
    },
    completed_summary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

attendanceRoundSchema.index({ date: 1, session_name: 1, hostel: 1, floor: 1 });
attendanceRoundSchema.index({ staff_id: 1, status: 1, date: 1 });
attendanceRoundSchema.index({ status: 1, hostel: 1, floor: 1 });

module.exports = mongoose.model('AttendanceRound', attendanceRoundSchema);
