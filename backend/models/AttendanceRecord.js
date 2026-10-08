/**
 * AttendanceRecord Model
 * The definitive daily attendance ledger entry for each student and session.
 * Enforces single attendance entry per student per session per date.
 */

const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      index: true,
    },
    session: {
      type: String,
      default: 'Night Attendance',
      required: true,
      trim: true,
    },
    session_name: {
      type: String,
      default: null,
      trim: true,
    },
    hostel: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    floor: {
      type: String,
      default: '',
    },
    roomNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['present', 'absent', 'on_leave'],
      required: true,
    },
    method: {
      type: String,
      enum: ['self_approved', 'staff_marked'],
      required: true,
    },
    verified_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    remark: {
      type: String,
      default: null,
      trim: true,
    },
    round_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AttendanceRound',
      default: null,
    },
    request_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomAttendanceRequest',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Strict unique constraint: one attendance record per student per date per session
attendanceRecordSchema.index({ student_id: 1, date: 1, session: 1 }, { unique: true });
attendanceRecordSchema.index({ date: 1, session: 1, hostel: 1, floor: 1 });
attendanceRecordSchema.index({ hostel: 1, date: 1, status: 1 });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
