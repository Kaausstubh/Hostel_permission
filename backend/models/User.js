/**
 * User Model
 * Roles: student | warden | security
 *
 * Students MUST register with college email (@iiitpune.ac.in)
 * and a unique MIS roll number.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    rollNo: {
      // MIS / Roll Number — REQUIRED & UNIQUE for students
      type: String,
      trim: true,
      // IMPORTANT: must be undefined (field absent) for sparse unique index to work.
      // If set to null, MongoDB may treat multiple nulls as duplicates on a unique index.
      default: undefined,
      // Uniqueness enforced via sparse index below
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
      // Stored as E.164, e.g. "+919876543210"
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false, // Never returned in queries by default
    },
    role: {
      type: String,
      enum: ['student', 'warden', 'security'],
      default: 'student',
    },
    hostel: {
      // Applicable to students: BH1 | BH2 | GH
      type: String,
      enum: ['BH1', 'BH2', 'GH', null],
      default: null,
    },
    parentPhone: {
      // Student's parent WhatsApp number (E.164 format)
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Sparse unique index on rollNo — enforces uniqueness only when rollNo is set
userSchema.index({ rollNo: 1 }, { unique: true, sparse: true });
// Fast login lookup index on email
userSchema.index({ email: 1 });
// Fast phone lookup index
userSchema.index({ phone: 1 });

// ── Hooks ──────────────────────────────────────────────────────────────────────
// Hash password before saving
// Salt rounds: 10 is OWASP-compliant and ~4x faster than 12 on low-CPU hosts
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ── Methods ───────────────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
