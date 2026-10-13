/**
 * Seed & Update Hostel Geofences
 * Applies the authoritative hostel coordinates provided by admin:
 * - BH2: (18.763092, 73.699231), 50m radius
 * - BH1: (18.764126, 73.699223), 50m radius
 * - GH:  (18.765075, 73.699101), 50m radius
 */

require('dotenv').config();
const mongoose = require('mongoose');
const HostelGeofence = require('../models/HostelGeofence');

// Helper to generate a 16-sided polygon representing the 50m circular perimeter
function generateCirclePolygon(centerLat, centerLng, radiusMeters, points = 16) {
  const coords = [];
  const earthRadius = 6371000;
  for (let i = 0; i < points; i++) {
    const angle = (i * 2 * Math.PI) / points;
    const dLat = (radiusMeters * Math.cos(angle)) / earthRadius;
    const dLng = (radiusMeters * Math.sin(angle)) / (earthRadius * Math.cos((centerLat * Math.PI) / 180));
    coords.push({
      lat: centerLat + (dLat * 180) / Math.PI,
      lng: centerLng + (dLng * 180) / Math.PI,
    });
  }
  return coords;
}

const HOSTEL_COORDINATES = [
  {
    hostel: 'BH2',
    name: "Boys' Hostel 2 (Krishna)",
    // 18°45'47.1"N 73°41'57.7"E
    center: { lat: 18.7630833, lng: 73.6993611 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  {
    hostel: 'BH1',
    name: "Boys' Hostel 1 (Brahmaputra)",
    // 18°45'50.8"N 73°41'57.4"E
    center: { lat: 18.7641111, lng: 73.6992778 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  {
    hostel: 'GH',
    name: "Girls' Hostel (GH)",
    // 18°45'54.4"N 73°41'56.8"E
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  {
    hostel: 'GH1',
    name: "Girls' Hostel 1 (Indrayani)",
    // 18°45'54.4"N 73°41'56.8"E
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
  {
    hostel: 'GH2',
    name: "Girls' Hostel 2 (Sindhu)",
    // 18°45'54.4"N 73°41'56.8"E
    center: { lat: 18.7651111, lng: 73.6991111 },
    radius_m: 22,
    buffer_m: 0,
    accuracy_threshold_m: 25,
    auto_attendance: true,
  },
];

async function seedGeofences() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`Connecting to MongoDB at: ${uri}`);
  await mongoose.connect(uri);

  for (const item of HOSTEL_COORDINATES) {
    const polygon = generateCirclePolygon(item.center.lat, item.center.lng, item.radius_m);

    const doc = await HostelGeofence.findOneAndUpdate(
      { hostel: item.hostel },
      {
        $set: {
          name: item.name,
          center: item.center,
          radius_m: item.radius_m,
          buffer_m: item.buffer_m,
          accuracy_threshold_m: item.accuracy_threshold_m,
          polygon,
          active: true,
        },
      },
      { upsert: true, new: true }
    );

    console.log(`✔ Configured geofence for ${item.hostel}: center=(${item.center.lat}, ${item.center.lng}), radius=${item.radius_m}m (id=${doc._id})`);
  }

  console.log('\nAll hostel geofences successfully updated!');
  await mongoose.disconnect();
}

if (require.main === module) {
  seedGeofences().catch((err) => {
    console.error('Failed to seed geofences:', err);
    process.exit(1);
  });
}

module.exports = seedGeofences;
