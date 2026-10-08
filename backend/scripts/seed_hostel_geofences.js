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
    name: 'Boys Hostel 2',
    center: { lat: 18.763092, lng: 73.699231 },
    radius_m: 50,
    buffer_m: 0,
    accuracy_threshold_m: 50,
  },
  {
    hostel: 'BH1',
    name: 'Boys Hostel 1',
    center: { lat: 18.764126, lng: 73.699223 },
    radius_m: 50,
    buffer_m: 0,
    accuracy_threshold_m: 50,
  },
  {
    hostel: 'GH',
    name: 'Girls Hostel',
    center: { lat: 18.765075, lng: 73.699101 },
    radius_m: 50,
    buffer_m: 0,
    accuracy_threshold_m: 50,
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
