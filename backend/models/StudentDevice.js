/**
 * StudentDevice Model
 * Secure binding between a student and their biometric-enabled hardware/authenticator.
 * One active registered device per student.
 */

const mongoose = require('mongoose');

const studentDeviceSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    device_id: {
      type: String,
      required: true,
      trim: true,
    },
    // WebAuthn platform authenticator credential ID
    credential_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    // Public key (COSE / PEM string / base64)
    public_key: {
      type: String,
      required: true,
    },
    algorithm: {
      type: String,
      default: 'ES256',
    },
    counter: {
      type: Number,
      default: 0,
    },
    device_model: {
      type: String,
      default: '',
      trim: true,
    },
    registered_at: {
      type: Date,
      default: Date.now,
    },
    // Staff/admin who verified enrollment in person
    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approved_at: {
      type: Date,
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Consent tracking
    consent_given: {
      type: Boolean,
      default: false,
    },
    consent_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

studentDeviceSchema.index({ student_id: 1, active: 1 });
studentDeviceSchema.index({ device_id: 1 });

module.exports = mongoose.model('StudentDevice', studentDeviceSchema);
