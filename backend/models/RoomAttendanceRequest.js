/**
 * RoomAttendanceRequest Model
 * Tracks attendance request instances dispatched by staff for a specific room.
 */

const mongoose = require('mongoose');

const roomAttendanceRequestSchema = new mongoose.Schema(
  {
    round_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AttendanceRound',
      required: true,
      index: true,
    },
    hostel: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    roomNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    room_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HostelRoom',
      default: null,
      index: true,
    },
    staff_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'expired', 'completed', 'skipped'],
      default: 'open',
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    // Server-issued single-use challenge nonce (UUIDv4)
    nonce: {
      type: String,
      required: true,
      index: true,
    },
    nonce_used: {
      type: Boolean,
      default: false,
    },
    skip_reason: {
      type: String,
      default: null,
      trim: true,
    },
    skipped_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

roomAttendanceRequestSchema.index({ round_id: 1, roomNo: 1 });
roomAttendanceRequestSchema.index({ hostel: 1, roomNo: 1, status: 1 });
roomAttendanceRequestSchema.index({ status: 1, expires_at: 1 });

module.exports = mongoose.model('RoomAttendanceRequest', roomAttendanceRequestSchema);
