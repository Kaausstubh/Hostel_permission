/**
 * Guardian Model
 * Tracks parental / guardian information linked to each student.
 * Supports sibling linking: multiple guardians can point to the same parent User account.
 */

const mongoose = require('mongoose');

const guardianSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    guardian_slot: {
      type: Number,
      enum: [1, 2],
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    relationship: {
      type: String,
      enum: ['Father', 'Mother', 'Guardian'],
      required: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['INVITED', 'ACTIVE', 'REVOKED'],
      default: 'INVITED',
      index: true,
    },
    invited_at: {
      type: Date,
      default: Date.now,
    },
    linked_at: {
      type: Date,
      default: null,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    last_invite_sent_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Unique slot per student (only one guardian_slot=1 and one guardian_slot=2 per student)
guardianSchema.index({ student_id: 1, guardian_slot: 1 }, { unique: true });
// Unique email per student (the two parent emails for a student must be distinct)
guardianSchema.index({ student_id: 1, email: 1 }, { unique: true });
guardianSchema.index({ email: 1, status: 1 });
guardianSchema.index({ user_id: 1, status: 1 });

module.exports = mongoose.model('Guardian', guardianSchema);
