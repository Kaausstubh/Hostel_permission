/**
 * Complaint Model
 * Student hostel complaints with warden resolution workflow.
 * Student info denormalized for clean reporting.
 */

const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema(
  {
    // ── Reference ────────────────────────────────────────────────────────────
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // ── Denormalized student info ─────────────────────────────────────────────
    name:   { type: String, default: '' },
    rollNo: { type: String, default: '' },

    // ── Complaint details ─────────────────────────────────────────────────────
    hostel: {
      type: String,
      enum: ['BH1', 'BH2', 'GH'],
      required: true,
    },
    complaint_text: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'resolved'],
      default: 'pending',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },

    // ── Resolution ────────────────────────────────────────────────────────────
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolutionNote: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

complaintSchema.index({ hostel: 1, status: 1 });
complaintSchema.index({ student_id: 1 });
complaintSchema.index({ student_id: 1, timestamp: -1 });
complaintSchema.index({ status: 1, timestamp: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
