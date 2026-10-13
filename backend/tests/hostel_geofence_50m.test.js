/**
 * Geofence Verification Tests for BH2, BH1, and GH Hostels
 * Validates:
 * - Authoritative coordinates
 * - 50m radius boundary limit
 * - Rejection of coordinates outside 50m
 * - Rejection when accuracy > 50m
 * - Cross-hostel rejection
 */

const assert = require('assert');
const mongoose = require('mongoose');
const { verifyHostelGeofence, haversineDistanceMeters } = require('../services/geofenceService');

const HOSTELS = {
  BH2: { lat: 18.7630833, lng: 73.6993611 },
  BH1: { lat: 18.7641111, lng: 73.6992778 },
  GH: { lat: 18.7651111, lng: 73.6991111 },
};

function offsetCoords(center, distanceMeters) {
  // Approximate offset north in latitude
  // 1 degree lat ~ 111,320 meters
  const dLat = distanceMeters / 111320;
  return {
    lat: center.lat + dLat,
    lng: center.lng,
  };
}

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function runTests() {
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
      console.log('Connected to MongoDB. Running geofence tests...');
    } catch {
      console.log('MongoDB not reachable. Running geofence tests against authoritative constants...');
    }
  } else {
    console.log('Running geofence tests against authoritative constants...');
  }

  for (const [code, center] of Object.entries(HOSTELS)) {
    console.log(`\nTesting ${code} at (${center.lat}, ${center.lng}):`);

    // 1. Center (0m away)
    const resCenter = await verifyHostelGeofence(code, {
      lat: center.lat,
      lng: center.lng,
      accuracy: 10,
    });
    assert.strictEqual(resCenter.valid, true, `${code} at center should be valid`);
    assert.strictEqual(resCenter.strictlyInside, true, `${code} at center should be strictly inside`);
    console.log(`  ✔ Exact Center (0m): VALID`);

    // 2. 15m away (inside 22m building radius)
    const p15 = offsetCoords(center, 15);
    const res15 = await verifyHostelGeofence(code, {
      lat: p15.lat,
      lng: p15.lng,
      accuracy: 15,
    });
    assert.strictEqual(res15.valid, true, `${code} at 15m should be valid`);
    console.log(`  ✔ 15m away: VALID`);

    // 3. 26m away (outside 22m building radius)
    const p26 = offsetCoords(center, 26);
    const res26 = await verifyHostelGeofence(code, {
      lat: p26.lat,
      lng: p26.lng,
      accuracy: 10,
    });
    assert.strictEqual(res26.valid, false, `${code} at 26m should be invalid`);
    assert.strictEqual(res26.reason, 'OUTSIDE_GEOFENCE', `${code} reason should be OUTSIDE_GEOFENCE`);
    console.log(`  ✔ 26m away: REJECTED (OUTSIDE_GEOFENCE)`);

    // 4. 55m away (outside geofence radius)
    const p55 = offsetCoords(center, 55);
    const res55 = await verifyHostelGeofence(code, {
      lat: p55.lat,
      lng: p55.lng,
      accuracy: 10,
    });
    assert.strictEqual(res55.valid, false, `${code} at 55m should be invalid`);
    assert.strictEqual(res55.reason, 'OUTSIDE_GEOFENCE', `${code} reason should be OUTSIDE_GEOFENCE`);
    console.log(`  ✔ 55m away: REJECTED (OUTSIDE_GEOFENCE)`);

    // 5. Accuracy > 25m threshold
    const resInacc = await verifyHostelGeofence(code, {
      lat: center.lat,
      lng: center.lng,
      accuracy: 35,
    });
    assert.strictEqual(resInacc.valid, false, `${code} with accuracy 35m should be rejected`);
    assert.strictEqual(resInacc.reason, 'LOW_GPS_ACCURACY', `${code} reason should be LOW_GPS_ACCURACY`);
    console.log(`  ✔ Poor GPS Accuracy (35m): REJECTED (LOW_GPS_ACCURACY)`);
  }

  // Cross-hostel tests
  console.log('\nTesting Cross-Hostel Geo Isolation:');
  const bh2Center = HOSTELS.BH2;
  const bh1Center = HOSTELS.BH1;
  const ghCenter = HOSTELS.GH;

  // Student assigned to BH2 standing at BH1 (~115m away)
  const resBH2atBH1 = await verifyHostelGeofence('BH2', {
    lat: bh1Center.lat,
    lng: bh1Center.lng,
    accuracy: 10,
  });
  assert.strictEqual(resBH2atBH1.valid, false, 'Student at BH1 cannot pass BH2 check');
  assert.strictEqual(resBH2atBH1.reason, 'OUTSIDE_GEOFENCE');
  console.log('  ✔ Student at BH1 attempting BH2 approval: REJECTED');

  // Student assigned to BH1 standing at GH (~106m away)
  const resBH1atGH = await verifyHostelGeofence('BH1', {
    lat: ghCenter.lat,
    lng: ghCenter.lng,
    accuracy: 10,
  });
  assert.strictEqual(resBH1atGH.valid, false, 'Student at GH cannot pass BH1 check');
  assert.strictEqual(resBH1atGH.reason, 'OUTSIDE_GEOFENCE');
  console.log('  ✔ Student at GH attempting BH1 approval: REJECTED');

  // Student assigned to GH standing at BH2 (~220m away)
  const resGHatBH2 = await verifyHostelGeofence('GH', {
    lat: bh2Center.lat,
    lng: bh2Center.lng,
    accuracy: 10,
  });
  assert.strictEqual(resGHatBH2.valid, false, 'Student at BH2 cannot pass GH check');
  assert.strictEqual(resGHatBH2.reason, 'OUTSIDE_GEOFENCE');
  console.log('  ✔ Student at BH2 attempting GH approval: REJECTED');

  console.log('\nALL 18 GEOFENCE TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
