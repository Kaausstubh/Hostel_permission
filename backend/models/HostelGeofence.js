/**
 * HostelGeofence Model
 * Stores geofence boundary polygons for hostels to verify student presence.
 */

const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { _id: false }
);

const hostelGeofenceSchema = new mongoose.Schema(
  {
    hostel: {
      type: String,
      required: [true, 'Hostel identifier is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    // Optional center coordinate for radial geofence
    center: {
      type: pointSchema,
      default: null,
    },
    // Circular geofence radius in meters (default 50m)
    radius_m: {
      type: Number,
      default: 50,
      min: 10,
      max: 500,
    },
    // Array of {lat, lng} vertices defining the perimeter polygon
    polygon: {
      type: [pointSchema],
      required: false,
      default: [],
    },

    // Buffer in meters to absorb GPS drift indoors (default 0m)
    buffer_m: {
      type: Number,
      default: 0,
      min: 0,
      max: 200,
    },
    // Maximum acceptable GPS accuracy in meters (default 50m)
    accuracy_threshold_m: {
      type: Number,
      default: 50,
      min: 5,
      max: 500,
    },
    active: {
      type: Boolean,
      default: true,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

hostelGeofenceSchema.index({ active: 1 });

module.exports = mongoose.model('HostelGeofence', hostelGeofenceSchema);
