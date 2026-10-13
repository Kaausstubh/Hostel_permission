const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Room = require('../models/Room');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const { invalidateLogsCache } = require('../services/logsCache');

// Helper: Determine Floor from Room Number
function getFloorForRoom(roomNumber) {
  if (!roomNumber) return 'Unassigned';
  const r = String(roomNumber).trim().toUpperCase();
  if (r.startsWith('B')) return 'Basement';
  const digitsMatch = r.match(/\d+/);
  if (!digitsMatch) return 'General';
  const num = parseInt(digitsMatch[0], 10);
  if (num < 100) return 'Ground Floor';
  if (num >= 100 && num < 200) return '1st Floor';
  if (num >= 200 && num < 300) return '2nd Floor';
  if (num >= 300 && num < 400) return '3rd Floor';
  if (num >= 400 && num < 500) return '4th Floor';
  return 'General';
}

// Floor sorting weight
const FLOOR_ORDER = {
  'Basement': 0,
  'Ground Floor': 1,
  '1st Floor': 2,
  '2nd Floor': 3,
  '3rd Floor': 4,
  '4th Floor': 5,
  'General': 6,
  'Unassigned': 7,
};

// Natural sort for room numbers (B01..B13, 2, 15, 24..30, 101..132, 201..234, 301..321)
function compareRooms(a, b) {
  const floorA = FLOOR_ORDER[a.floor] ?? 99;
  const floorB = FLOOR_ORDER[b.floor] ?? 99;
  if (floorA !== floorB) return floorA - floorB;

  const numA = a.roomNumber.toUpperCase();
  const numB = b.roomNumber.toUpperCase();

  // If both basement
  if (numA.startsWith('B') && numB.startsWith('B')) {
    const valA = parseInt(numA.replace(/\D/g, ''), 10) || 0;
    const valB = parseInt(numB.replace(/\D/g, ''), 10) || 0;
    return valA - valB;
  }

  const valA = parseInt(numA.replace(/\D/g, ''), 10) || 0;
  const valB = parseInt(numB.replace(/\D/g, ''), 10) || 0;
  if (valA !== valB) return valA - valB;
  return numA.localeCompare(numB);
}

/**
 * Helper: Sync / Seed initial PDF data for BH-2 (Krishna Hostel)
 */
async function syncPdfDataHelper(targetHostel = 'BH2') {
  const hostelCode = String(targetHostel || 'BH2').trim().toUpperCase();
  if (hostelCode !== 'BH2') {
    throw new Error(`The official PDF data is strictly for BH-2 (Krishna Hostel). Cannot seed into ${hostelCode}.`);
  }
  const filePath = path.join(__dirname, '../data/bh2InitialData.json');
  if (!fs.existsSync(filePath)) {
    throw new Error('Hostel student allocation data file not found at ' + filePath);
  }
  const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const roomMap = new Map();
  const reviewList = [];
  let totalRead = 0;
  let studentsAllocated = 0;
  let studentsUpdated = 0;
  let studentsAlreadyPresent = 0;

  // 1. Group records by room, preserving exact PDF order
  for (const item of rawData) {
    if (!item.mis && !item.name) continue;
    totalRead++;
    const mis = item.mis ? String(item.mis).trim() : '';
    const name = item.name ? String(item.name).trim() : '';
    const rawRoom = item.room ? String(item.room).trim() : null;
    const year = item.year || (mis.startsWith('1124') ? '3rd Year' : '2nd Year');

    if (!rawRoom) {
      // Flag record with missing room for manual review (e.g. Krunal Vasoya)
      reviewList.push({
        name,
        rollNo: mis,
        year,
        originalRoom: null,
        reason: 'No room assigned in PDF. Added to Unassigned Review list.',
      });
      continue;
    }

    if (!roomMap.has(rawRoom)) {
      roomMap.set(rawRoom, []);
    }
    roomMap.get(rawRoom).push({ name, mis, year, rawRoom });
  }

  const allRooms = Array.from(roomMap.keys());

  // Clean up any legacy dummy rooms for this hostel that are not in the official PDF list
  await Room.deleteMany({
    hostelCode,
    roomNumber: { $nin: allRooms },
  }).catch(() => {});

  // 2. Process each room, enforcing strict 4-bed limit
  for (const rNum of allRooms) {
    const floor = getFloorForRoom(rNum);

    // Ensure Room record in DB with strict capacity: 4
    await Room.findOneAndUpdate(
      { hostelCode, roomNumber: rNum },
      {
        $set: {
          hostelCode,
          roomNumber: rNum,
          floor,
          capacity: 4,
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );

    const candidates = roomMap.get(rNum);
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const email = cand.mis
        ? `${cand.mis}@cse.iiitp.ac.in`
        : `${cand.name.toLowerCase().replace(/\s+/g, '')}@student.iiitp.ac.in`;

      if (i < 4) {
        // Beds 1 to 4: Allocate student to this room
        const existing = await User.findOne({
          $or: [{ rollNo: cand.mis }, { email }],
        });

        if (existing) {
          if (existing.hostel === hostelCode && existing.roomNo === rNum && existing.name === cand.name) {
            studentsAlreadyPresent++;
          } else {
            studentsUpdated++;
          }
        }

        await User.findOneAndUpdate(
          { $or: [{ rollNo: cand.mis }, { email }] },
          {
            $set: {
              name: cand.name,
              rollNo: cand.mis || undefined,
              email,
              hostel: hostelCode,
              roomNo: rNum,
              role: 'student',
              isActive: true,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        studentsAllocated++;
      } else {
        // Exceeds 4 beds (e.g. Room 30 listed with 6 occupants in PDF)
        // Store in DB as unassigned student in hostel and flag for review
        reviewList.push({
          name: cand.name,
          rollNo: cand.mis,
          year: cand.year,
          originalRoom: rNum,
          reason: `Room ${rNum} capacity exceeded (listed 6 students in PDF for a 4-bed room). Beds 1-4 filled; placed in Unassigned Review list for reallocation.`,
        });

        await User.findOneAndUpdate(
          { $or: [{ rollNo: cand.mis }, { email }] },
          {
            $set: {
              name: cand.name,
              rollNo: cand.mis || undefined,
              email,
              hostel: hostelCode,
              roomNo: null,
              role: 'student',
              isActive: true,
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    }
  }

  // Also upsert any students in reviewList that had no room
  for (const unassignedItem of reviewList) {
    if (!unassignedItem.originalRoom) {
      const email = unassignedItem.rollNo
        ? `${unassignedItem.rollNo}@cse.iiitp.ac.in`
        : `${unassignedItem.name.toLowerCase().replace(/\s+/g, '')}@student.iiitp.ac.in`;

      await User.findOneAndUpdate(
        { $or: [{ rollNo: unassignedItem.rollNo }, { email }] },
        {
          $set: {
            name: unassignedItem.name,
            rollNo: unassignedItem.rollNo || undefined,
            email,
            hostel: hostelCode,
            roomNo: null,
            role: 'student',
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  }

  await invalidateLogsCache();

  const totalCapacity = roomMap.size * 4;
  const availableBeds = totalCapacity - studentsAllocated;

  return {
    totalRead,
    imported: studentsAllocated,
    updated: studentsUpdated,
    alreadyPresent: studentsAlreadyPresent,
    duplicates: 0,
    requiresReview: reviewList.length,
    reviewList,
    rejected: 0,
    roomsCreatedOrUpdated: roomMap.size,
    allocatedHostel: hostelCode,
    allocated: studentsAllocated,
    totalCapacity,
    availableBeds,
  };
}

/**
 * Helper: Ensure standard campus rooms exist for BH1, BH2, GH1, or GH2 if not yet configured
 */
async function ensureDefaultRoomsForHostel(hostelCode) {
  try {
    if (hostelCode === 'BH2') {
      await syncPdfDataHelper('BH2');
      return;
    }

    // Default physical rooms template for campus hostels (BH1, GH1, GH2)
    // 25 rooms per floor across Ground (G01-G25), 1st (101-125), 2nd (201-225), 3rd (301-325)
    // All created with capacity 4 beds and 0 occupants, awaiting allocation.
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
        });
      }
    }

    if (roomDefs.length > 0) {
      await Room.insertMany(roomDefs, { ordered: false }).catch(() => {});
    }
  } catch (err) {
    logger.warn(`[Rooms API] ensureDefaultRoomsForHostel warning for ${hostelCode}: ${err.message}`);
  }
}

// ─── POST /api/rooms/sync-pdf ─────────────────────────────────────────────────
// Warden/Admin/Hostel Staff endpoint to import/sync all PDF data into BH-2 (Krishna Hostel)
router.post('/sync-pdf', protect, authorize('warden', 'admin', 'hostel_staff'), async (req, res) => {
  try {
    const targetHostel = String(req.body.hostel || req.query.hostel || 'BH2').trim().toUpperCase();
    if (targetHostel !== 'BH2') {
      return res.status(400).json({
        success: false,
        message: 'The official PDF roster is exclusively for BH-2 (Krishna Hostel). Other hostels (BH-1, GH-1, GH-2) have their own separate rosters and cannot be overwritten with BH-2 students.',
      });
    }
    const result = await syncPdfDataHelper('BH2');
    res.json({
      success: true,
      message: `Successfully synced ${result.allocated} students into BH-2 across ${result.roomsCreatedOrUpdated} verified rooms. (${result.requiresReview} records flagged for review).`,
      summary: result,
    });
  } catch (error) {
    logger.error('[Rooms API] Sync PDF error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── GET /api/rooms ───────────────────────────────────────────────────────────
// Get 3D Room Grid and student occupancy for hostel (defaults to BH2)
router.get('/', protect, authorize('warden', 'admin', 'security', 'hostel_staff', 'student'), async (req, res) => {
  try {
    const hostel = String(req.query.hostel || 'BH2').trim().toUpperCase();
    const floorFilter = req.query.floor ? String(req.query.floor).trim() : 'All';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const statusFilter = req.query.status ? String(req.query.status).trim().toLowerCase() : 'all';

    // Auto-seed ONLY BH-2 from the Krishna PDF list if not fully populated
    if (hostel === 'BH2') {
      const roomsCount = await Room.countDocuments({ hostelCode: 'BH2' });
      const studentCount = await User.countDocuments({ hostel: 'BH2', role: 'student', roomNo: { $ne: null } });
      if (roomsCount < 100 || studentCount < 300) {
        try {
          await syncPdfDataHelper('BH2');
        } catch (e) {
          logger.warn(`[Rooms API] Auto-sync initial data warning for BH2: ` + e.message);
        }
      }
    } else {
      // For BH1, GH1, GH2: Ensure default rooms exist if not yet configured (empty rooms, 0 students)
      const existingRoomsCount = await Room.countDocuments({ hostelCode: hostel });
      if (existingRoomsCount === 0) {
        await ensureDefaultRoomsForHostel(hostel);
      }
    }

    // 1. Fetch configured Rooms for this hostel
    const configuredRooms = await Room.find({ hostelCode: hostel, isActive: true }).lean();
    const roomConfigMap = new Map();
    configuredRooms.forEach((r) => {
      roomConfigMap.set(r.roomNumber, r);
    });

    // 2. Fetch all students in this hostel
    const studentQuery = { hostel, role: 'student', isActive: true };
    const students = await User.find(studentQuery)
      .select('name rollNo email phone roomNo studentPhoto picture createdAt')
      .sort({ roomNo: 1, name: 1 })
      .lean();

    // 3. Map students into rooms
    const roomStudentsMap = new Map();
    const unassignedStudents = [];

    students.forEach((s) => {
      const rNum = s.roomNo ? String(s.roomNo).trim() : null;
      if (!rNum || rNum === 'null' || rNum === 'undefined') {
        unassignedStudents.push({
          _id: s._id,
          name: s.name,
          rollNo: s.rollNo || '',
          email: s.email || '',
          phone: s.phone || '',
          studentPhoto: s.studentPhoto || s.picture || null,
        });
      } else {
        if (!roomStudentsMap.has(rNum)) {
          roomStudentsMap.set(rNum, []);
        }
        roomStudentsMap.get(rNum).push({
          _id: s._id,
          name: s.name,
          rollNo: s.rollNo || '',
          email: s.email || '',
          phone: s.phone || '',
          studentPhoto: s.studentPhoto || s.picture || null,
        });
      }
    });

    // 4. Combine all known rooms (from Room collection + any roomNo assigned to students)
    const allRoomNumbers = new Set([
      ...roomConfigMap.keys(),
      ...roomStudentsMap.keys(),
    ]);

    let roomList = [];
    let totalCapacity = 0;
    let totalOccupied = 0;
    let totalVacancies = 0;
    let fullRoomsCount = 0;
    let availableRoomsCount = 0;
    let emptyRoomsCount = 0;

    const floorStatsMap = {};

    allRoomNumbers.forEach((rNum) => {
      const config = roomConfigMap.get(rNum);
      const residing = roomStudentsMap.get(rNum) || [];
      const floor = config?.floor || getFloorForRoom(rNum);
      
      // Standard room capacity is strictly 4 students for BH-2
      const capacity = hostel === 'BH2' ? 4 : (config?.capacity || 4);
      const occupancy = residing.length;
      const vacancies = Math.max(0, capacity - occupancy);

      totalCapacity += capacity;
      totalOccupied += occupancy;
      totalVacancies += vacancies;

      let status = 'AVAILABLE';
      if (occupancy >= capacity) {
        status = 'FULL';
        fullRoomsCount++;
      } else if (occupancy === 0) {
        status = 'EMPTY';
        emptyRoomsCount++;
        availableRoomsCount++;
      } else {
        status = 'PARTIAL';
        availableRoomsCount++;
      }

      // Track floor stats
      if (!floorStatsMap[floor]) {
        floorStatsMap[floor] = { floor, rooms: 0, capacity: 0, occupied: 0, vacancies: 0 };
      }
      floorStatsMap[floor].rooms++;
      floorStatsMap[floor].capacity += capacity;
      floorStatsMap[floor].occupied += occupancy;
      floorStatsMap[floor].vacancies += vacancies;

      // Assign bed index (1..capacity) to students
      const studentsWithBeds = residing.map((st, idx) => ({
        ...st,
        bedIndex: idx + 1,
      }));

      // Generate explicit 4 bed slots (Bed 1 to Bed 4)
      const beds = [];
      for (let b = 1; b <= capacity; b++) {
        const student = residing[b - 1] || null;
        beds.push({
          bedNumber: b,
          status: student ? 'OCCUPIED' : 'VACANT',
          student: student
            ? {
                _id: student._id,
                name: student.name,
                rollNo: student.rollNo || '',
                email: student.email || '',
                phone: student.phone || '',
                studentPhoto: student.studentPhoto || null,
              }
            : null,
        });
      }

      roomList.push({
        roomNumber: rNum,
        hostel,
        floor,
        capacity,
        occupancy,
        vacancies,
        status, // 'FULL', 'PARTIAL', 'EMPTY'
        isFull: occupancy >= capacity,
        hasVacancy: vacancies > 0,
        notes: config?.notes || '',
        students: studentsWithBeds,
        beds,
      });
    });

    // Sort rooms in natural floor order (Basement -> Ground -> 1st -> 2nd -> 3rd)
    roomList.sort(compareRooms);

    // Apply Filters
    let filteredRooms = roomList;

    if (floorFilter && floorFilter !== 'All') {
      filteredRooms = filteredRooms.filter((r) => r.floor === floorFilter);
    }

    if (statusFilter === 'vacant' || statusFilter === 'has_vacancy') {
      filteredRooms = filteredRooms.filter((r) => r.vacancies > 0);
    } else if (statusFilter === 'full') {
      filteredRooms = filteredRooms.filter((r) => r.isFull);
    } else if (statusFilter === 'empty') {
      filteredRooms = filteredRooms.filter((r) => r.occupancy === 0);
    }

    if (search) {
      const q = search.toLowerCase();
      filteredRooms = filteredRooms.filter(
        (r) =>
          r.roomNumber.toLowerCase().includes(q) ||
          r.floor.toLowerCase().includes(q) ||
          r.students.some(
            (s) =>
              s.name.toLowerCase().includes(q) ||
              s.rollNo.toLowerCase().includes(q) ||
              s.email.toLowerCase().includes(q)
          )
      );
    }

    const uniqueFloors = Array.from(new Set(roomList.map((r) => r.floor)))
      .sort((a, b) => (FLOOR_ORDER[a] ?? 99) - (FLOOR_ORDER[b] ?? 99));
    const availableFloors = ['All', ...(uniqueFloors.length > 0 ? uniqueFloors : ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'])];

    res.json({
      success: true,
      hostel,
      stats: {
        totalRooms: roomList.length,
        totalCapacity,
        totalOccupied,
        totalVacancies,
        fullRooms: fullRoomsCount,
        availableRooms: availableRoomsCount,
        roomsWithVacancies: availableRoomsCount,
        emptyRooms: emptyRoomsCount,
        unassignedCount: unassignedStudents.length,
        occupancyRate: totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0,
      },
      floors: availableFloors,
      floorBreakdown: Object.values(floorStatsMap).sort((a, b) => (FLOOR_ORDER[a.floor] || 99) - (FLOOR_ORDER[b.floor] || 99)),
      rooms: filteredRooms,
      unassigned: unassignedStudents,
    });
  } catch (error) {
    logger.error('[Rooms API] Fetch rooms error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST /api/rooms/:roomNumber/add-student ──────────────────────────────────
// Add / Allocate student into a specific room
router.post('/:roomNumber/add-student', protect, authorize('warden', 'admin', 'hostel_staff'), async (req, res) => {
  try {
    const roomNumber = String(req.params.roomNumber).trim();
    const hostel = String(req.body.hostel || 'BH2').trim().toUpperCase();
    const { studentId, name, rollNo, email, phone } = req.body;

    // Check room capacity (Strict 4-student limit for BH-2)
    const currentStudents = await User.find({ hostel, roomNo: roomNumber, role: 'student', isActive: true });
    const configuredRoom = await Room.findOne({ hostelCode: hostel, roomNumber });
    const capacity = hostel === 'BH2' ? 4 : (configuredRoom?.capacity || 4);

    if (currentStudents.length >= capacity) {
      return res.status(400).json({
        success: false,
        message: `Room ${roomNumber} is already at full capacity (${capacity}/${capacity} students). Adding a 5th student to a 4-bed room is rejected. Free up a bed first or choose another room.`,
      });
    }

    let targetStudent = null;

    if (studentId) {
      targetStudent = await User.findById(studentId);
    } else if (rollNo) {
      targetStudent = await User.findOne({ rollNo: String(rollNo).trim() });
    }

    if (targetStudent) {
      // Allocate existing student
      targetStudent.hostel = hostel;
      targetStudent.roomNo = roomNumber;
      if (name) targetStudent.name = String(name).trim();
      if (phone) targetStudent.phone = String(phone).trim();
      await targetStudent.save();
    } else {
      // Create and assign new student
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, message: 'Student name is required.' });
      }
      const finalRoll = rollNo ? String(rollNo).trim() : undefined;
      const finalEmail = email ? String(email).trim().toLowerCase() : (finalRoll ? `${finalRoll}@cse.iiitp.ac.in` : `${name.toLowerCase().replace(/\s+/g, '')}@student.iiitp.ac.in`);

      targetStudent = await User.create({
        name: String(name).trim(),
        rollNo: finalRoll,
        email: finalEmail,
        phone: phone ? String(phone).trim() : null,
        hostel,
        roomNo: roomNumber,
        role: 'student',
        isActive: true,
      });
    }

    // Ensure Room document exists
    if (!configuredRoom) {
      await Room.create({
        hostelCode: hostel,
        roomNumber,
        floor: getFloorForRoom(roomNumber),
        capacity: 4,
        isActive: true,
      });
    }

    await invalidateLogsCache();

    logger.info('[Rooms API] Student allocated to room', {
      warden: req.user.name,
      student: targetStudent.name,
      rollNo: targetStudent.rollNo,
      roomNumber,
      hostel,
    });

    res.json({
      success: true,
      message: `Student ${targetStudent.name} successfully assigned to Room ${roomNumber}.`,
      student: targetStudent,
    });
  } catch (error) {
    logger.error('[Rooms API] Add student error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST /api/rooms/:roomNumber/remove-student ───────────────────────────────
// Remove / Deallocate a student from a room (freeing up the vacancy)
router.post('/:roomNumber/remove-student', protect, authorize('warden', 'admin', 'hostel_staff'), async (req, res) => {
  try {
    const roomNumber = String(req.params.roomNumber).trim();
    const { studentId, rollNo } = req.body;

    let student = null;
    if (studentId) {
      student = await User.findById(studentId);
    } else if (rollNo) {
      student = await User.findOne({ rollNo: String(rollNo).trim() });
    }

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student record not found.' });
    }

    const previousRoom = student.roomNo;
    student.roomNo = null;
    await student.save();

    await invalidateLogsCache();

    logger.info('[Rooms API] Student removed from room', {
      warden: req.user.name,
      student: student.name,
      rollNo: student.rollNo,
      removedFromRoom: roomNumber,
    });

    res.json({
      success: true,
      message: `Student ${student.name} removed from Room ${previousRoom || roomNumber}. 1 bed vacancy is now available.`,
      student,
    });
  } catch (error) {
    logger.error('[Rooms API] Remove student error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST /api/rooms/transfer-student ─────────────────────────────────────────
// Move / Transfer a student from one room to another
router.post('/transfer-student', protect, authorize('warden', 'admin', 'hostel_staff'), async (req, res) => {
  try {
    const { studentId, targetRoomNumber, hostel = 'BH2' } = req.body;
    if (!studentId || !targetRoomNumber) {
      return res.status(400).json({ success: false, message: 'Student ID and Target Room Number are required.' });
    }

    const cleanTargetRoom = String(targetRoomNumber).trim();

    // Check capacity of target room (Strict 4-student limit for BH-2)
    const targetRoomOccupants = await User.countDocuments({
      hostel,
      roomNo: cleanTargetRoom,
      role: 'student',
      isActive: true,
    });
    const targetRoomConfig = await Room.findOne({ hostelCode: hostel, roomNumber: cleanTargetRoom });
    const capacity = hostel === 'BH2' ? 4 : (targetRoomConfig?.capacity || 4);

    if (targetRoomOccupants >= capacity) {
      return res.status(400).json({
        success: false,
        message: `Target Room ${cleanTargetRoom} is full (${targetRoomOccupants}/${capacity} students). Adding a 5th student to a 4-bed room is rejected. Choose a room with vacancy.`,
      });
    }

    const student = await User.findById(studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const previousRoom = student.roomNo;
    student.hostel = hostel;
    student.roomNo = cleanTargetRoom;
    await student.save();

    await invalidateLogsCache();

    res.json({
      success: true,
      message: `Transferred ${student.name} from Room ${previousRoom || 'Unassigned'} to Room ${cleanTargetRoom}.`,
      student,
    });
  } catch (error) {
    logger.error('[Rooms API] Transfer student error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── PUT /api/rooms/:roomNumber/capacity ──────────────────────────────────────
// Update room capacity
router.put('/:roomNumber/capacity', protect, authorize('warden', 'admin', 'hostel_staff'), async (req, res) => {
  try {
    const roomNumber = String(req.params.roomNumber).trim();
    const hostel = String(req.body.hostel || 'BH2').trim().toUpperCase();
    const capacity = parseInt(req.body.capacity, 10);

    if (isNaN(capacity) || capacity < 1 || capacity > 10) {
      return res.status(400).json({ success: false, message: 'Capacity must be a number between 1 and 10.' });
    }

    const floor = getFloorForRoom(roomNumber);
    const room = await Room.findOneAndUpdate(
      { hostelCode: hostel, roomNumber },
      { $set: { capacity, floor, isActive: true } },
      { upsert: true, new: true }
    );

    await invalidateLogsCache();

    res.json({
      success: true,
      message: `Room ${roomNumber} capacity updated to ${capacity} beds.`,
      room,
    });
  } catch (error) {
    logger.error('[Rooms API] Update capacity error', { error: error.message });
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
