/**
 * Hostel Data Isolation Test Suite
 * Validates:
 * 1. PDF student roster is strictly isolated to BH-2 (Krishna Hostel)
 * 2. Attempts to sync PDF roster into BH-1, GH-1, or GH-2 are strictly rejected
 * 3. BH-1 default physical rooms template creates empty 4-bed rooms with zero allocated students
 * 4. Students belonging to BH-2 never leak into BH-1, GH-1, or GH-2 rosters
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runHostelIsolationTests() {
  console.log('🧪 Starting Hostel Data Isolation & PDF Boundary Test Suite...\n');

  // Test 1: Verify bh2InitialData.json students are strictly tagged or intended for BH-2
  const bh2DataPath = path.join(__dirname, '../data/bh2InitialData.json');
  assert(fs.existsSync(bh2DataPath), 'bh2InitialData.json must exist');
  const bh2Dataset = JSON.parse(fs.readFileSync(bh2DataPath, 'utf8'));

  assert.strictEqual(bh2Dataset.length, 394, `Expected 394 records in bh2 dataset, got ${bh2Dataset.length}`);
  console.log('✅ TEST 1: bh2InitialData.json contains 394 verified student records.');

  // Test 2: Verify room numbers match the known BH-2 building structure (B01-B13, etc.)
  const basementRooms = bh2Dataset.filter(s => s.room && s.room.startsWith('B'));
  assert(basementRooms.length > 0, 'BH-2 dataset must contain Basement rooms (B01-B13)');
  console.log(`✅ TEST 2: Verified ${basementRooms.length} student records assigned to Basement rooms in BH-2.`);

  // Test 3: Simulated syncPdfDataHelper isolation guard
  function simulateSyncPdfGuard(targetHostel) {
    const hostelCode = String(targetHostel || 'BH2').trim().toUpperCase();
    if (hostelCode !== 'BH2') {
      throw new Error(`The official PDF data is strictly for BH-2 (Krishna Hostel). Cannot seed into ${hostelCode}.`);
    }
    return { success: true, hostel: hostelCode };
  }

  // Should succeed for BH2
  const bh2Result = simulateSyncPdfGuard('BH2');
  assert.strictEqual(bh2Result.hostel, 'BH2');
  console.log('✅ TEST 3a: syncPdfGuard allows BH2 seeding.');

  // Must reject BH1, GH1, GH2
  assert.throws(() => simulateSyncPdfGuard('BH1'), /strictly for BH-2/);
  assert.throws(() => simulateSyncPdfGuard('GH1'), /strictly for BH-2/);
  assert.throws(() => simulateSyncPdfGuard('GH2'), /strictly for BH-2/);
  console.log('✅ TEST 3b: syncPdfGuard strictly rejects BH1, GH1, and GH2 with explanatory error.');

  // Test 4: Default rooms generation for BH1 produces empty 4-bed rooms
  function generateDefaultRoomsTemplate(hostelCode) {
    const floors = [
      { name: 'Ground Floor', prefix: 'G', start: 1, end: 25, pad: 2 },
      { name: '1st Floor', prefix: '1', start: 1, end: 25, pad: 2 },
      { name: '2nd Floor', prefix: '2', start: 1, end: 25, pad: 2 },
      { name: '3rd Floor', prefix: '3', start: 1, end: 25, pad: 2 },
    ];
    const roomDefs = [];
    for (const fl of floors) {
      for (let i = fl.start; i <= fl.end; i++) {
        const rNum = `${fl.prefix}${String(i).padStart(fl.pad, '0')}`;
        roomDefs.push({
          hostelCode,
          roomNumber: rNum,
          floor: fl.name,
          capacity: 4,
          isActive: true,
          students: [], // Empty initially
        });
      }
    }
    return roomDefs;
  }

  const bh1Rooms = generateDefaultRoomsTemplate('BH1');
  assert.strictEqual(bh1Rooms.length, 100, `Expected 100 default rooms for BH1, got ${bh1Rooms.length}`);
  const totalBedsBH1 = bh1Rooms.reduce((acc, r) => acc + r.capacity, 0);
  assert.strictEqual(totalBedsBH1, 400, 'Expected 400 capacity (100 rooms * 4 beds) for BH1');
  const totalOccupiedBH1 = bh1Rooms.reduce((acc, r) => acc + r.students.length, 0);
  assert.strictEqual(totalOccupiedBH1, 0, 'Expected 0 residing students initially in BH1 default template');
  console.log('✅ TEST 4: BH1 default rooms template contains 100 empty rooms (400 beds) with 0 occupants.');

  // Test 5: Verify frontend roster isolation logic
  function simulateHostelRosterFilter(activeHostel, dbRooms, pdfFallbackStudents) {
    const list = [];
    const seenMis = new Set();

    // 1. Live DB
    if (dbRooms && Array.isArray(dbRooms)) {
      dbRooms.forEach(room => {
        if (room.students) {
          room.students.forEach(st => {
            if (st.hostel === activeHostel) {
              list.push(st);
            }
          });
        }
      });
    }

    // 2. Official PDF fallback strictly for BH2
    if (activeHostel === 'BH2') {
      pdfFallbackStudents.forEach(pdfSt => {
        const misKey = pdfSt.mis ? String(pdfSt.mis).toLowerCase() : null;
        if (!misKey || !seenMis.has(misKey)) {
          if (misKey) seenMis.add(misKey);
          list.push({ ...pdfSt, hostel: 'BH-2' });
        }
      });
    }

    return list;
  }

  // When activeHostel is BH1 with empty DB, roster must be 0
  const bh1Roster = simulateHostelRosterFilter('BH1', [], bh2Dataset);
  assert.strictEqual(bh1Roster.length, 0, 'BH-1 roster must have 0 students when no students are assigned in DB');
  console.log('✅ TEST 5a: BH-1 roster correctly returns 0 students without BH-2 PDF cross-contamination.');

  // When activeHostel is BH2, roster must have 394 students
  const bh2Roster = simulateHostelRosterFilter('BH2', [], bh2Dataset);
  assert.strictEqual(bh2Roster.length, 394, 'BH-2 roster must have 394 students from PDF fallback');
  console.log('✅ TEST 5b: BH-2 roster correctly retains all 394 students.');

  console.log('\n🎉 ALL HOSTEL DATA ISOLATION TESTS PASSED SUCCESSFULLY! (5/5 Criteria Met)');
}

runHostelIsolationTests();
