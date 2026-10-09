/**
 * VisitorLog Model
 * Tracks visitor entry and exit at campus gates.
 *
 * Requirements:
 * 1. visitorCount: Number of people visiting together (1-20, default 1).
 * 2. hasVehicle: Boolean flag.
 * 3. vehicleNumber: Normalized (trimmed, uppercased, stripped spaces/hyphens).
 *    Indexed for fast search. Required only when hasVehicle is true.
 */

const mongoose = require('mongoose');
const {
  normalizeVehicleNumber,
  parseVisitorCount,
  parseBoolean,
} = require('../utils/visitorValidation');

const visitorLogSchema = new mongoose.Schema(
  {
    // ── Visitor Information ───────────────────────────────────────────────────
    name: {
      type: String,
      required: [true, 'Visitor name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Visitor phone number is required'],
      trim: true,
    },
    visitorCount: {
      type: Number,
      default: 1,
      min: [1, 'Visitor count must be at least 1'],
      max: [20, 'Visitor count cannot exceed 20'],
      set: (v) => {
        const res = parseVisitorCount(v);
        return res.count;
      },
    },

    // ── Vehicle Information ───────────────────────────────────────────────────
    hasVehicle: {
      type: Boolean,
      default: false,
      set: function (v) {
        const parsed = parseBoolean(v);
        if (!parsed) {
          this.vehicleNumber = null;
        }
        return parsed;
      },
    },
    vehicleNumber: {
      type: String,
      default: null,
      set: function (v) {
        if (v === null || v === undefined || String(v).trim() === '') return null;
        if (this.hasVehicle === false) return null;
        return String(v).trim().toUpperCase().replace(/[\s-]/g, '');
      },
      validate: {
        validator: function (v) {
          if (this.hasVehicle) {
            const res = normalizeVehicleNumber(v, true);
            return res.valid;
          }
          return true;
        },
        message: 'Vehicle number must be 4-15 alphanumeric characters when bringing a vehicle.',
      },
    },

    // ── Purpose & Student Reference ───────────────────────────────────────────
    purpose: {
      type: String,
      required: [true, 'Purpose of visit is required'],
      trim: true,
    },
    purposeDetails: {
      type: String,
      default: '',
      trim: true,
      validate: {
        validator: function (v) {
          if (this.purpose === 'Other' || String(this.purpose).trim().toLowerCase() === 'other') {
            return Boolean(v && String(v).trim().length > 0);
          }
          return true;
        },
        message: 'Specific reason / details is required when purpose is "Other".',
      },
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    studentName: {
      type: String,
      default: '',
      trim: true,
    },
    studentRollNo: {
      type: String,
      default: '',
      trim: true,
    },
    studentHostel: {
      type: String,
      default: '',
      trim: true,
    },
    studentRoomNo: {
      type: String,
      default: '',
      trim: true,
    },
    studentApprovalStatus: {
      type: String,
      enum: ['NA', 'PENDING', 'APPROVED', 'REJECTED'],
      default: 'NA',
    },
    studentApprovalTime: {
      type: Date,
      default: null,
    },
    studentApprovalRemarks: {
      type: String,
      default: '',
      trim: true,
    },

    // ── Gate Entry & Exit Status ──────────────────────────────────────────────
    status: {
      type: String,
      enum: ['PENDING', 'INSIDE', 'EXITED', 'REJECTED'],
      default: 'INSIDE',
      required: true,
    },
    entryTime: {
      type: Date,
      default: Date.now,
    },
    exitTime: {
      type: Date,
      default: null,
    },
    date: {
      // YYYY-MM-DD string for fast daily index queries (Asia/Kolkata)
      type: String,
      default: () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    },
    entryGate: {
      type: String,
      default: 'Main Gate',
      trim: true,
    },

    // ── Audit & Origin ────────────────────────────────────────────────────────
    loggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    logged_by_name: {
      type: String,
      default: 'Duty Guard',
    },
    source: {
      type: String,
      enum: ['MANUAL', 'GOOGLE_FORM', 'WEBHOOK'],
      default: 'MANUAL',
    },
    passNumber: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
visitorLogSchema.index({ vehicleNumber: 1 });
visitorLogSchema.index({ status: 1, date: 1 });
visitorLogSchema.index({ status: 1, entryTime: -1 });
visitorLogSchema.index({ date: -1, entryTime: -1 });
visitorLogSchema.index({ phone: 1, entryTime: -1 });
visitorLogSchema.index({ name: 1, entryTime: -1 });
visitorLogSchema.index({ studentName: 1, entryTime: -1 });
visitorLogSchema.index({ student_id: 1, studentApprovalStatus: 1 });
visitorLogSchema.index({ studentApprovalStatus: 1, date: -1 });
visitorLogSchema.index({ hasVehicle: 1, status: 1 });

// ── Pre-save Hook ─────────────────────────────────────────────────────────────
visitorLogSchema.pre('save', function (next) {
  if (this.hasVehicle) {
    const vehRes = normalizeVehicleNumber(this.vehicleNumber, true);
    if (!vehRes.valid) {
      return next(new Error(vehRes.error || 'Invalid vehicle number format'));
    }
    this.vehicleNumber = vehRes.normalized;
  } else {
    this.vehicleNumber = null;
  }

  if ((this.purpose === 'Other' || String(this.purpose).trim().toLowerCase() === 'other') && (!this.purposeDetails || !String(this.purposeDetails).trim())) {
    return next(new Error('Specific reason / details is required when purpose is "Other"'));
  }

  if (!this.date) {
    this.date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  next();
});

module.exports = mongoose.model('VisitorLog', visitorLogSchema);
