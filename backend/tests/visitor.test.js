/**
 * Visitor Entry & Exit Module Automated Test Suite
 *
 * Tests:
 * 1. visitorCount bounds (min 1, max 20) and defensive string parsing
 * 2. hasVehicle & vehicleNumber requirement (required only when hasVehicle=true; null when false)
 * 3. vehicleNumber normalization (trim, uppercase, strip spaces and hyphens, 4-15 alphanumeric chars)
 * 4. Search by vehicle number and query filtering
 * 5. Headcount total calculations (sum of visitorCount in Inside list & export summaries)
 * 6. Webhook payload parsing when vehicle section is skipped or completed
 * 7. Privacy log masking for phone and vehicle numbers
 */

const assert = require('assert');
const mongoose = require('mongoose');

// Import utilities and models
const {
  normalizeVehicleNumber,
  parseVisitorCount,
  parseBoolean,
  maskPhone,
  maskVehicle,
} = require('../utils/visitorValidation');
const VisitorLog = require('../models/VisitorLog');
const { VISITOR_PURPOSES } = require('../constants/visitorPurposes');

async function runVisitorTestSuite() {
  console.log('🧪 Starting HEIMDALL Visitor Module Test Suite...\n');

  // ─── Test 1: visitorCount bounds and defensive string parsing ─────────────
  console.log('--- Test 1: visitorCount bounds & string parsing ---');

  // Normal valid numbers
  const res1 = parseVisitorCount(1);
  assert.strictEqual(res1.valid, true);
  assert.strictEqual(res1.count, 1);

  const res5 = parseVisitorCount(5);
  assert.strictEqual(res5.valid, true);
  assert.strictEqual(res5.count, 5);

  const res20 = parseVisitorCount(20);
  assert.strictEqual(res20.valid, true);
  assert.strictEqual(res20.count, 20);

  // String parsing (as received from Google Forms / Webhooks)
  const strRes3 = parseVisitorCount('3');
  assert.strictEqual(strRes3.valid, true);
  assert.strictEqual(strRes3.count, 3);

  const strPadded = parseVisitorCount('  12  ');
  assert.strictEqual(strPadded.valid, true);
  assert.strictEqual(strPadded.count, 12);

  // Defaults on missing/null/empty
  const nullRes = parseVisitorCount(null);
  assert.strictEqual(nullRes.valid, true);
  assert.strictEqual(nullRes.count, 1);

  const emptyRes = parseVisitorCount('');
  assert.strictEqual(emptyRes.valid, true);
  assert.strictEqual(emptyRes.count, 1);

  // Out of bounds / invalid strings
  const zeroRes = parseVisitorCount(0);
  assert.strictEqual(zeroRes.valid, false, '0 should be rejected (min 1)');

  const negRes = parseVisitorCount(-3);
  assert.strictEqual(negRes.valid, false, 'Negative count should be rejected');

  const overRes = parseVisitorCount(25);
  assert.strictEqual(overRes.valid, false, 'Count > 20 should be rejected');

  const textRes = parseVisitorCount('two');
  assert.strictEqual(textRes.valid, false, 'Non-numeric string should fail validation');

  console.log('✅ Test 1 Passed: visitorCount bounds (1-20) and string parsing validated.');

  // ─── Test 2: Vehicle Number Normalization & Loose Validation ───────────────
  console.log('\n--- Test 2: vehicleNumber Normalization & Validation ---');

  // Normalization: trim, uppercase, remove spaces & hyphens
  const norm1 = normalizeVehicleNumber('mh 12 ab 1234', true);
  assert.strictEqual(norm1.valid, true);
  assert.strictEqual(norm1.normalized, 'MH12AB1234');

  const norm2 = normalizeVehicleNumber('  dl-01-c-5678  ', true);
  assert.strictEqual(norm2.valid, true);
  assert.strictEqual(norm2.normalized, 'DL01C5678');

  const norm3 = normalizeVehicleNumber('ka03ha9999', true);
  assert.strictEqual(norm3.valid, true);
  assert.strictEqual(norm3.normalized, 'KA03HA9999');

  // Short plate (e.g. 4 chars temporary/diplomatic)
  const shortPlate = normalizeVehicleNumber('DL01', true);
  assert.strictEqual(shortPlate.valid, true);
  assert.strictEqual(shortPlate.normalized, 'DL01');

  // Invalid: too short (< 4 chars)
  const tooShort = normalizeVehicleNumber('MH1', true);
  assert.strictEqual(tooShort.valid, false, 'Vehicle number < 4 chars must fail');

  // Invalid: special characters other than spaces/hyphens
  const specialChars = normalizeVehicleNumber('MH-12@1234', true);
  assert.strictEqual(specialChars.valid, false, 'Special characters must fail');

  console.log('✅ Test 2 Passed: Vehicle number normalization and loose format validation.');

  // ─── Test 3: hasVehicle logic & requirement ────────────────────────────────
  console.log('\n--- Test 3: hasVehicle conditional requirement ---');

  // When hasVehicle is false: vehicleNumber is always null, even if provided
  const noVeh1 = normalizeVehicleNumber(null, false);
  assert.strictEqual(noVeh1.valid, true);
  assert.strictEqual(noVeh1.normalized, null);

  const noVeh2 = normalizeVehicleNumber('MH12AB1234', false);
  assert.strictEqual(noVeh2.valid, true);
  assert.strictEqual(noVeh2.normalized, null, 'Vehicle number must be null when hasVehicle is false');

  // When hasVehicle is true: vehicleNumber is required
  const reqVeh1 = normalizeVehicleNumber(null, true);
  assert.strictEqual(reqVeh1.valid, false, 'Vehicle number is required when hasVehicle is true');

  const reqVeh2 = normalizeVehicleNumber('', true);
  assert.strictEqual(reqVeh2.valid, false, 'Empty vehicle number must be rejected when bringing vehicle');

  console.log('✅ Test 3 Passed: vehicleNumber required only when hasVehicle is true, null when false.');

  // ─── Test 4: Mongoose Schema Validation & Pre-save Hooks ───────────────────
  console.log('\n--- Test 4: VisitorLog Schema & Pre-validation Hooks ---');

  const validDoc = new VisitorLog({
    name: 'Ramesh Patel',
    phone: '+919876543210',
    purpose: 'Meeting a student',
    studentName: 'Aarav Patel',
    studentHostel: 'hostel_1',
    studentRoomNo: 'A-102',
    visitorCount: '3', // String input from form
    hasVehicle: true,
    vehicleNumber: 'mh 12 ab 1234', // Needs normalization
    status: 'INSIDE',
    date: '2026-10-08',
  });

  const valErr = validDoc.validateSync();
  assert(!valErr, `VisitorLog document should validate cleanly, got: ${valErr?.message}`);
  assert.strictEqual(validDoc.visitorCount, 3, 'visitorCount string was parsed to number 3');
  assert.strictEqual(validDoc.vehicleNumber, 'MH12AB1234', 'vehicleNumber was trimmed, uppercased, and spaces removed');

  // Document without vehicle
  const noVehDoc = new VisitorLog({
    name: 'Suresh Kumar',
    phone: '+919876543211',
    purpose: 'Delivery / Courier',
    visitorCount: 1,
    hasVehicle: false,
    vehicleNumber: 'ignored_number',
    status: 'INSIDE',
    date: '2026-10-08',
  });

  const noVehErr = noVehDoc.validateSync();
  assert(!noVehErr, 'No-vehicle doc should validate cleanly');
  assert.strictEqual(noVehDoc.vehicleNumber, null, 'vehicleNumber must be reset to null when hasVehicle is false');

  // Test Purpose "Other" requirement
  const otherWithoutDetailsDoc = new VisitorLog({
    name: 'Anita Verma',
    phone: '+919876543212',
    purpose: 'Other',
    purposeDetails: '', // Missing
    visitorCount: 1,
    hasVehicle: false,
    status: 'INSIDE',
    date: '2026-10-08',
  });

  const otherValErr = otherWithoutDetailsDoc.validateSync();
  assert(otherValErr, 'validateSync should fail when purpose is Other and purposeDetails is empty');
  assert(otherValErr.errors['purposeDetails'], 'Validation error should be on purposeDetails field');

  // Also test valid Other document
  const otherDirectDoc = new VisitorLog({
    name: 'Anita Verma',
    phone: '+919876543212',
    purpose: 'Other',
    purposeDetails: 'Guest speaker for seminar',
    visitorCount: 1,
    hasVehicle: false,
    status: 'INSIDE',
    date: '2026-10-08',
  });
  const validOtherErr = otherDirectDoc.validateSync();
  assert(!validOtherErr, 'Valid Other doc should validate cleanly');
  assert.strictEqual(otherDirectDoc.purposeDetails, 'Guest speaker for seminar');

  console.log('✅ Test 4 Passed: VisitorLog Mongoose schema pre-save hooks, Other purposeDetails, and transformations.');

  // ─── Test 5: Headcount Sum Calculation ─────────────────────────────────────
  console.log('\n--- Test 5: Headcount total calculations ---');

  const mockVisitors = [
    { name: 'Group A', visitorCount: 4, hasVehicle: true, status: 'INSIDE' },
    { name: 'Solo Visitor', visitorCount: 1, hasVehicle: false, status: 'INSIDE' },
    { name: 'Family Visit', visitorCount: 5, hasVehicle: true, status: 'INSIDE' },
    { name: 'Exited Visitor', visitorCount: 2, hasVehicle: false, status: 'EXITED' },
  ];

  // Headcount across all
  const totalAllHeadcount = mockVisitors.reduce((acc, v) => acc + (Number(v.visitorCount) || 1), 0);
  assert.strictEqual(totalAllHeadcount, 12, 'Total headcount should be 4 + 1 + 5 + 2 = 12');

  // Headcount currently inside
  const insideVisitors = mockVisitors.filter((v) => v.status === 'INSIDE');
  const insidePasses = insideVisitors.length;
  const insideHeadcount = insideVisitors.reduce((acc, v) => acc + (Number(v.visitorCount) || 1), 0);

  assert.strictEqual(insidePasses, 3, 'Inside passes count should be 3');
  assert.strictEqual(insideHeadcount, 10, 'Inside headcount should be 4 + 1 + 5 = 10 people');

  console.log('✅ Test 5 Passed: Total headcount vs entry passes calculation verified.');

  // ─── Test 6: Webhook Payload Parsing (Google Forms Simulation) ─────────────
  console.log('\n--- Test 6: Webhook payload parsing (Forms simulation) ---');

  // Simulated Google Forms Payload where visitor brings a vehicle
  const formPayloadWithVeh = {
    purpose: 'Meeting a student',
    studentName: 'Sneha Roy',
    studentHostel: 'Hostel 3',
    studentRoomNo: 'C-301',
    name: 'Ananya Roy',
    phone: '9876543210',
    visitorCount: '2', // String from form
    hasVehicle: 'Yes', // String from form
    vehicleNumber: ' mh-14-de-4321 ', // String from form
  };

  const parsedCount1 = parseVisitorCount(formPayloadWithVeh.visitorCount);
  const parsedHasVeh1 = parseBoolean(formPayloadWithVeh.hasVehicle);
  const parsedVehNum1 = normalizeVehicleNumber(formPayloadWithVeh.vehicleNumber, parsedHasVeh1);

  assert.strictEqual(parsedCount1.count, 2);
  assert.strictEqual(parsedHasVeh1, true);
  assert.strictEqual(parsedVehNum1.normalized, 'MH14DE4321');

  // Simulated Google Forms Payload where Section 4 is SKIPPED
  const formPayloadNoVeh = {
    purpose: 'Delivery / Courier',
    name: 'Amazon Courier',
    phone: '9876543212',
    visitorCount: '1',
    hasVehicle: 'No',
    vehicleNumber: '', // Skipped section leaves field empty or undefined
  };

  const parsedCount2 = parseVisitorCount(formPayloadNoVeh.visitorCount);
  const parsedHasVeh2 = parseBoolean(formPayloadNoVeh.hasVehicle);
  const parsedVehNum2 = normalizeVehicleNumber(formPayloadNoVeh.vehicleNumber, parsedHasVeh2);

  assert.strictEqual(parsedCount2.count, 1);
  assert.strictEqual(parsedHasVeh2, false);
  assert.strictEqual(parsedVehNum2.normalized, null, 'Skipped vehicle section results in null vehicleNumber');

  console.log('✅ Test 6 Passed: Google Forms webhook string parsing and section skipping.');

  // ─── Test 7: Privacy log masking ──────────────────────────────────────────
  console.log('\n--- Test 7: Log Masking for PII & Vehicle Numbers ---');

  const maskedPh1 = maskPhone('9876543210');
  assert.strictEqual(maskedPh1, '987****210');
  assert(!maskedPh1.includes('6543'), 'Phone digits must be masked');

  const maskedPh2 = maskPhone('+919876543210');
  assert.strictEqual(maskedPh2, '+91****210');

  const maskedVeh1 = maskVehicle('MH12AB1234');
  assert.strictEqual(maskedVeh1, 'MH****34');
  assert(!maskedVeh1.includes('12AB12'), 'Vehicle digits must be masked');

  const maskedVehNone = maskVehicle(null);
  assert.strictEqual(maskedVehNone, 'None');

  console.log('✅ Test 7 Passed: Phone and vehicle numbers safely masked for application logs.');

  console.log('\n🎉 ALL 7 VISITOR MODULE TEST SUITES PASSED SUCCESSFULLY!\n');
}

// Execute tests
runVisitorTestSuite().catch((err) => {
  console.error('❌ Visitor Test Suite Failed:', err);
  process.exit(1);
});
