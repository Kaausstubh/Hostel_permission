/**
 * User Model
 * Roles: student | warden | security
 *
 * Authentication is handled via OAuth (Google / Microsoft).
 * No password field — identity is fully delegated to the OAuth provider.
 *
 * Student domain restriction is enforced in config/oauth.js.
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },

    // ── OAuth Fields ──────────────────────────────────────────────────────────
    oauthProvider: {
      // Which OAuth provider authenticated this user
      type: String,
      enum: ['google'],
      required: [true, 'OAuth provider is required'],
    },
    oauthId: {
      // The provider's unique user ID (stable identifier)
      type: String,
      required: [true, 'OAuth ID is required'],
      trim: true,
    },
    picture: {
      // Profile photo URL from OAuth provider (may be null)
      type: String,
      default: null,
    },
    lastLoginAt: {
      // Timestamp of most recent successful OAuth login
      type: Date,
      default: null,
    },

    // ── Role & Status ─────────────────────────────────────────────────────────
    role: {
      type: String,
      enum: ['student', 'warden', 'security', 'admin'],
      default: 'student',
    },
    isActive: {
      type: Boolean,
      default: true,
    },

    // ── Student-only Fields ───────────────────────────────────────────────────
    rollNo: {
      // MIS / Roll Number — optional, only used for students
      // IMPORTANT: must be undefined (field absent) for sparse unique index to work.
      // If set to null, MongoDB may treat multiple nulls as duplicates on a unique index.
      type: String,
      trim: true,
      default: undefined,
    },
    hostel: {
      // Applicable to students: BH1 | BH2 | GH
      type: String,
      enum: ['BH1', 'BH2', 'GH', null],
      default: null,
    },
    phone: {
      // Optional — OAuth providers don't always return a phone number
      // Stored as E.164, e.g. "+919876543210"
      type: String,
      default: null,
    },
    parentPhone: {
      // Student's parent WhatsApp number (E.164 format)
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
// Fast OAuth login lookup (primary auth path)
userSchema.index({ oauthId: 1, oauthProvider: 1 }, { unique: true });
// Fast roll number lookup — sparse so null values don't conflict
userSchema.index({ rollNo: 1 }, { unique: true, sparse: true });
// Fast role-based queries (dashboard counts, lists)
userSchema.index({ role: 1 });
// Note: email already has a unique index from { unique: true } in the schema field definition.

module.exports = mongoose.model('User', userSchema);
