/**
 * PendingRegistration Model
 * Temporary staging table for student self-registrations awaiting email OTP verification.
 * Automatically cleaned up via MongoDB TTL index after 15 minutes.
 */

const mongoose = require('mongoose');

const pendingRegistrationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    rollNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    hostel: {
      type: String,
      default: null,
    },
    roomNo: {
      type: String,
      default: null,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    // OTP verification
    otpHash: {
      type: String,
      required: true,
    },
    otpExpiresAt: {
      type: Date,
      required: true,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    // Guardian details to be created upon successful verification
    guardian1: {
      name: { type: String, required: true, trim: true },
      relationship: { type: String, enum: ['Father', 'Mother', 'Guardian'], required: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
    },
    guardian2: {
      name: { type: String, required: true, trim: true },
      relationship: { type: String, enum: ['Father', 'Mother', 'Guardian'], required: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, required: true, lowercase: true, trim: true },
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 900, // 15 minutes TTL automatic MongoDB cleanup
    },
  },
  {
    timestamps: false,
  }
);

pendingRegistrationSchema.index({ email: 1 });
pendingRegistrationSchema.index({ rollNo: 1 });

module.exports = mongoose.model('PendingRegistration', pendingRegistrationSchema);
