/**
 * AttendanceAttempt Model
 * Authoritative server-side tracker for student attendance verification attempts.
 * Enforces maximum of TWO attempts per student per session/date.
 */

const mongoose = require('mongoose');

const attemptDetailSchema = new mongoose.Schema(
  {
    attemptNumber: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    accuracy: {
      type: Number,
      default: null,
    },
    distanceMeters: {
      type: Number,
      default: null,
    },
    radiusMeters: {
      type: Number,
      default: null,
    },
    success: {
      type: Boolean,
      required: true,
    },
    reason: {
      type: String,
      default: null,
    },
    errorCode: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const attendanceAttemptSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD (IST)
      required: true,
      index: true,
    },
    session: {
      type: String,
      default: 'Night Attendance',
      required: true,
      trim: true,
    },
    hostel: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    attemptsCount: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 2,
    },
    status: {
      type: String,
      enum: ['pending', 'present', 'absent'],
      default: 'pending',
    },
    attempts: [attemptDetailSchema],
    finalizedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index: only 1 attempt document per student per date per session
attendanceAttemptSchema.index({ student_id: 1, date: 1, session: 1 }, { unique: true });
attendanceAttemptSchema.index({ date: 1, hostel: 1, status: 1 });

module.exports = mongoose.model('AttendanceAttempt', attendanceAttemptSchema);
