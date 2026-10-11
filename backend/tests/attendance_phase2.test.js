/**
 * Attendance Module Phase 2 Verification Test Suite
 * Tests models, schema validations, geofence math, and device binding.
 */

const assert = require('assert');
const mongoose = require('mongoose');

const HostelGeofence = require('../models/HostelGeofence');
const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const StudentDevice = require('../models/StudentDevice');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');

const {
  isPointInPolygon,
  distanceToPolygonMeters,
  verifyHostelGeofence,
} = require('../services/geofenceService');

async function runTests() {
  console.log('🧪 Starting Attendance Module Phase 2 Test Suite...\n');

  // ── 1. Geofence Geometry Tests ──────────────────────────────────────────────
  const testPolygon = [
    { lat: 18.53050, lng: 73.85600 },
    { lat: 18.53120, lng: 73.85600 },
    { lat: 18.53120, lng: 73.85680 },
    { lat: 18.53050, lng: 73.85680 },
  ];

  // Point inside the box
  const insidePt = { lat: 18.53085, lng: 73.85640 };
  assert.strictEqual(isPointInPolygon(insidePt, testPolygon), true, 'Point should be inside polygon');
  console.log('✅ Test 1a: Point-in-polygon correctly detects interior point');

  // Point outside the box
  const outsidePt = { lat: 18.53500, lng: 73.86000 };
  assert.strictEqual(isPointInPolygon(outsidePt, testPolygon), false, 'Point should be outside polygon');
  console.log('✅ Test 1b: Point-in-polygon correctly detects exterior point');

  // Point 10 meters outside the east edge
  // At lat 18.53085, 1 deg lng is approx 105,440m. 10m is approx 0.000095 deg
  const driftPt = { lat: 18.53085, lng: 73.85688 };
  const distDrift = distanceToPolygonMeters(driftPt, testPolygon);
  assert(distDrift > 0 && distDrift < 20, `Drift distance should be approx 8-12m, got ${distDrift}`);
  console.log(`✅ Test 1c: Distance to polygon perimeter calculated accurately (${distDrift.toFixed(1)}m)`);

  // ── 2. Model Schema Validations ─────────────────────────────────────────────
  const studentId = new mongoose.Types.ObjectId();
  const staffId = new mongoose.Types.ObjectId();

  // HostelGeofence validation (minimum 3 vertices)
  const badGf = new HostelGeofence({
    hostel: 'BH1',
    polygon: [{ lat: 18.1, lng: 73.1 }], // only 1 vertex
  });
  const gfErr = badGf.validateSync();
  assert(gfErr && gfErr.errors['polygon'], 'HostelGeofence must require >= 3 vertices');
  console.log('✅ Test 2a: HostelGeofence rejects invalid polygons with < 3 vertices');

  // AttendanceRound validation
  const round = new AttendanceRound({
    date: '2026-10-08',
    hostel: 'BH1',
    floor: '2',
    staff_id: staffId,
  });
  assert(!round.validateSync(), 'Valid AttendanceRound should pass schema validation');
  console.log('✅ Test 2b: AttendanceRound schema validates cleanly');

  // RoomAttendanceRequest validation
  const reqDoc = new RoomAttendanceRequest({
    round_id: round._id,
    hostel: 'BH1',
    roomNo: '204',
    staff_id: staffId,
    expires_at: new Date(Date.now() + 90000),
    nonce: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  });
  assert(!reqDoc.validateSync(), 'Valid RoomAttendanceRequest should pass schema validation');
  console.log('✅ Test 2c: RoomAttendanceRequest schema validates cleanly');

  // RequestResponse validation
  const respDoc = new RequestResponse({
    request_id: reqDoc._id,
    student_id: studentId,
    status: 'approved',
    inside_geofence: true,
  });
  assert(!respDoc.validateSync(), 'Valid RequestResponse should pass validation');
  console.log('✅ Test 2d: RequestResponse schema validates cleanly');

  // AttendanceRecord validation
  const recDoc = new AttendanceRecord({
    student_id: studentId,
    date: '2026-10-08',
    session: 'Night Attendance',
    hostel: 'BH1',
    roomNo: '204',
    status: 'present',
    method: 'self_approved',
    verified_by: staffId,
  });
  assert(!recDoc.validateSync(), 'Valid AttendanceRecord should pass validation');
  console.log('✅ Test 2e: AttendanceRecord schema validates cleanly');

  // StudentDevice validation (requires credential_id and consent)
  const devDoc = new StudentDevice({
    student_id: studentId,
    device_id: 'dev_mock_123',
    credential_id: 'cred_mock_webauthn_xyz',
    public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...',
    consent_given: true,
    consent_at: new Date(),
  });
  assert(!devDoc.validateSync(), 'Valid StudentDevice should pass validation');
  console.log('✅ Test 2f: StudentDevice schema validates cleanly');

  // AttendanceAuditLog requires mandatory reason
  const badAudit = new AttendanceAuditLog({
    actor_id: staffId,
    actor_role: 'warden',
    action: 'MANUAL_OVERRIDE',
    entity: 'RequestResponse',
    entity_id: respDoc._id.toString(),
    // reason missing!
  });
  const auditErr = badAudit.validateSync();
  assert(auditErr && auditErr.errors['reason'], 'Audit log must enforce mandatory reason');
  console.log('✅ Test 2g: AttendanceAuditLog strictly enforces mandatory reason');

  console.log('\n🎉 All Phase 2 unit & schema integrity tests PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Phase 2 test suite failed:', err);
  process.exit(1);
});
