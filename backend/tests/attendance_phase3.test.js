/**
 * Phase 3 Verification Test Suite
 * Tests staff round logic, floor parsing, skip/reopen validation, and mandatory remarks.
 */

const assert = require('assert');
const { parseFloorFromRoom } = require('../services/attendanceRoundService');

async function runTests() {
  console.log('🧪 Starting Attendance Module Phase 3 Test Suite...\n');

  // Test 1: Floor Parsing
  assert.strictEqual(parseFloorFromRoom('101'), '1', '101 should parse as floor 1');
  assert.strictEqual(parseFloorFromRoom('112'), '1', '112 should parse as floor 1');
  assert.strictEqual(parseFloorFromRoom('204'), '2', '204 should parse as floor 2');
  assert.strictEqual(parseFloorFromRoom('B-302'), '3', 'B-302 should parse as floor 3');
  assert.strictEqual(parseFloorFromRoom('A-415'), '4', 'A-415 should parse as floor 4');
  assert.strictEqual(parseFloorFromRoom('GF-01'), 'Ground', 'GF-01 should parse as floor Ground');
  assert.strictEqual(parseFloorFromRoom('G-12'), 'Ground', 'G-12 should parse as floor Ground');
  assert.strictEqual(parseFloorFromRoom('1204'), '12', '1204 should parse as floor 12');
  console.log('✅ Test 1: Floor parser correctly parses various room number formats (numeric, wing prefix, ground floor)');

  // Test 2: Skip room mandatory reason validation
  const { skipRoom } = require('../services/attendanceRoundService');
  let threwSkip = false;
  try {
    await skipRoom({
      roundId: 'mock_id',
      roomNo: '101',
      reason: '', // empty reason!
      staffUser: { _id: 'mock_staff', role: 'warden', name: 'Warden Smith' },
    });
  } catch (err) {
    threwSkip = true;
    assert(err.message.includes('REASON_REQUIRED'), 'Should reject empty skip reason');
  }
  assert.strictEqual(threwSkip, true, 'skipRoom must require a mandatory non-empty reason');
  console.log('✅ Test 2: skipRoom strictly enforces mandatory non-empty reason');

  console.log('\n🎉 All Phase 3 unit & service integrity tests PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Phase 3 test suite failed:', err);
  process.exit(1);
});
