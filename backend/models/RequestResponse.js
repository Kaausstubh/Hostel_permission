/**
 * RequestResponse Model
 * Records each student's response state, biometric proof, and GPS verification for a room request.
 */

const mongoose = require('mongoose');

const requestResponseSchema = new mongoose.Schema(
  {
    request_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomAttendanceRequest',
      required: true,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    allocation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RoomAllocation',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: [
        'pending',
        'approved',
        'absent',
        'timeout',
        'flagged',
        'on_leave',
        'manual_present',
        'manual_absent',
        'manual_on_leave',
      ],
      default: 'pending',
    },
    approved_at: {
      type: Date,
      default: null,
    },
    device_id: {
      type: String,
      default: null,
    },
    credential_id: {
      type: String,
      default: null,
    },
    signature: {
      type: String,
      default: null,
    },
    gps_lat: {
      type: Number,
      default: null,
    },
    gps_lng: {
      type: Number,
      default: null,
    },
    gps_accuracy: {
      type: Number,
      default: null,
    },
    inside_geofence: {
      type: Boolean,
      default: null,
    },
    flags: {
      type: [String],
      default: [],
    },
    remark: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index so a student cannot have multiple responses per request
requestResponseSchema.index({ request_id: 1, student_id: 1 }, { unique: true });
requestResponseSchema.index({ student_id: 1, createdAt: -1 });

module.exports = mongoose.model('RequestResponse', requestResponseSchema);
