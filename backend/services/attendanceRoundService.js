/**
 * Attendance Round Service
 * Orchestrates staff rounds, room lists, student rosters, requests, skip/reopen, and round completion.
 */

const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const HomeVisitLog = require('../models/HomeVisitLog');
const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceAttempt = require('../models/AttendanceAttempt');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');
const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const { getIO } = require('./socketService');
const { finalizeExpiredNightAttendance } = require('./nightAttendanceService');
const logger = require('../utils/logger');

const DEFAULT_TTL_SECONDS = parseInt(process.env.ATTENDANCE_REQUEST_TTL_SECONDS || '300', 10);
const NIGHT_ATTENDANCE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Extract floor identifier from room number string.
 * Examples:
 *   "B01", "B13" -> "Basement / Wing B"
 *   "2", "30" -> "Ground Floor"
 *   "101", "102" -> "1st Floor"
 *   "204", "215" -> "2nd Floor"
 *   "301", "303" -> "3rd Floor"
 */
const parseFloorFromRoom = (roomNo) => {
  if (!roomNo) return '1';
  const clean = String(roomNo).trim().toUpperCase();

  if (clean.startsWith('GF') || clean.startsWith('G-') || clean === 'G' || /^G\d+$/.test(clean)) {
    return 'Ground';
  }

  // Wing prefix with hyphen, e.g. B-302, A-415
  if (/^[A-Z]-\d+$/.test(clean)) {
    const numPart = parseInt(clean.split('-')[1], 10);
    if (!isNaN(numPart)) {
      if (numPart < 100) return 'Ground';
      return String(Math.floor(numPart / 100));
    }
  }

  // Basement rooms like B01, B13, BASEMENT
  if (clean.startsWith('BASEMENT') || /^B\d+$/.test(clean)) {
    return 'Basement';
  }

  const num = parseInt(clean.replace(/\D/g, ''), 10);
  if (!isNaN(num)) {
    if (num < 100) return 'Ground';
    return String(Math.floor(num / 100));
  }

  return '1';
};

const normalizeFloor = (floor) => {
  if (!floor) return '';
  const s = String(floor).trim().toLowerCase();
  if (s.includes('all')) return 'all';
  if (s.includes('ground') || s === 'g' || s === 'gf' || s === '0') return 'ground';
  if (s.includes('basement') || s.includes('base') || s === 'b' || s === '-1') return 'basement';
  const match = s.match(/\d+/);
  if (match) return match[0];
  return s;
};

const getTodayDateStr = () => {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
};

const studentIsInRoundFloor = (student, floor) => {
  const normFloor = normalizeFloor(floor);
  if (normFloor === 'all' || !normFloor) return true;
  return normalizeFloor(parseFloorFromRoom(student?.roomNo)) === normFloor;
};

const getStudentHostelFilter = (hostel) =>
  hostel === 'GH1' ? { $in: ['GH1', 'GH'] } : hostel;

/**
 * A night-attendance session is opened only by staff.  Student dashboard
 * reads can recover a missing attempt document, but cannot create a new
 * window because the authoritative start/end timestamps belong to this round.
 */
const initializeNightAttendanceAttempts = async (round) => {
  const studentHostel = getStudentHostelFilter(round.hostel);
  const students = await User.find({
    role: 'student',
    isActive: true,
    hostel: studentHostel,
  }).select('_id hostel roomNo').lean();

  const eligibleStudents = students.filter((student) => studentIsInRoundFloor(student, round.floor));
  if (!eligibleStudents.length) return { eligibleStudents: 0, initializedStudents: 0 };

  // Recover only legacy/unbound documents that have never used a valid GPS
  // check. This prevents an old dashboard read from blocking the staff-owned
  // session, without resetting an in-progress or finalized verification.
  const studentIds = eligibleStudents.map((student) => student._id);
  const rebound = await AttendanceAttempt.updateMany(
    {
      student_id: { $in: studentIds },
      date: round.date,
      session: 'Night Attendance',
      round_id: null,
      status: 'pending',
      attemptsCount: 0,
    },
    {
      $set: {
        round_id: round._id,
        hostel: round.hostel,
        session_start: round.window_start,
        expires_at: round.window_end,
        locationStatus: 'NOT CHECKED',
      },
    }
  );

  const operations = eligibleStudents.map((student) => ({
    updateOne: {
      filter: {
        student_id: student._id,
        date: round.date,
        session: 'Night Attendance',
      },
      update: {
        $setOnInsert: {
          student_id: student._id,
          date: round.date,
          session: 'Night Attendance',
          round_id: round._id,
          hostel: round.hostel,
          attemptsCount: 0,
          maxAttempts: 3,
          session_start: round.window_start,
          expires_at: round.window_end,
          status: 'pending',
          locationStatus: 'NOT CHECKED',
          attempts: [],
        },
      },
      upsert: true,
    },
  }));

  const result = await AttendanceAttempt.bulkWrite(operations, { ordered: false });
  return {
    eligibleStudents: eligibleStudents.length,
    initializedStudents: (result.upsertedCount || 0) + (rebound.modifiedCount || 0),
  };
};

/**
 * Check if a student is on an approved active leave for the target date.
 */
const isStudentOnActiveLeave = async (studentId, targetDate = getTodayDateStr()) => {
  const leave = await HomeVisitLog.findOne({
    student_id: studentId,
    overall_status: 'approved',
    leave_date: { $lte: targetDate },
    return_date: { $gte: targetDate },
    qr_used_in: { $ne: true },
  }).lean();

  return Boolean(leave);
};

/**
 * Helper to resolve hostel and floor rooms using Hostel structure models
 */
const resolveFloorRooms = async (hostelCode, floorStr) => {
  const hostel = await Hostel.findOne({ code: (hostelCode || '').toUpperCase() });
  if (!hostel) return null;

  const allFloors = await HostelFloor.find({ hostel_id: hostel._id, active: true }).sort({ floor_number: 1 });
  const cleanStr = String(floorStr || '').trim().toLowerCase();

  // If All Floors is selected, return all rooms across all floors for this hostel
  if (cleanStr.includes('all')) {
    const rooms = await HostelRoom.find({ hostel_id: hostel._id })
      .sort({ room_number: 1 })
      .lean();
    return {
      hostel,
      floorDoc: { label: 'All Floors', floor_number: 99 },
      rooms,
      isAllFloors: true,
    };
  }

  let floorDoc = allFloors.find(
    (f) =>
      f.label.toLowerCase() === cleanStr ||
      String(f.floor_number) === cleanStr ||
      (cleanStr.includes('base') && f.floor_number === -1) ||
      (cleanStr.includes('ground') && f.floor_number === 0) ||
      (cleanStr === '1' && f.floor_number === 1) ||
      (cleanStr.includes('1st') && f.floor_number === 1) ||
      (cleanStr === '2' && f.floor_number === 2) ||
      (cleanStr.includes('2nd') && f.floor_number === 2) ||
      (cleanStr === '3' && f.floor_number === 3) ||
      (cleanStr.includes('3rd') && f.floor_number === 3)
  );

  if (!floorDoc) {
    const num = parseInt(cleanStr, 10);
    if (!isNaN(num)) {
      floorDoc = allFloors.find((f) => f.floor_number === num);
    }
  }

  if (!floorDoc) return null;

  const rooms = await HostelRoom.find({ hostel_id: hostel._id, floor_id: floorDoc._id })
    .sort({ room_number: 1 })
    .lean();

  return {
    hostel,
    floorDoc,
    rooms,
  };
};

/**
 * Get distinct hostels and their floors using Room Allocation as the single source of truth.
 */
const getHostelsAndFloors = async (staffUser = null) => {
  // Ensure default campus hostel entries exist in database
  try {
    const campusHostelsToEnsure = [
      { code: 'BH1', name: "Boys' Hostel 1 (BH1)", type: 'boys' },
      { code: 'BH2', name: "Boys' Hostel 2 (BH2)", type: 'boys' },
      { code: 'GH1', name: "Girls' Hostel 1 (GH1)", type: 'girls' },
      { code: 'GH2', name: "Girls' Hostel 2 (GH2)", type: 'girls' },
    ];
    for (const ch of campusHostelsToEnsure) {
      const exists = await Hostel.findOne({ code: ch.code });
      if (!exists) {
        await Hostel.create({
          code: ch.code,
          name: ch.name,
          type: ch.type,
          active: true,
          description: `${ch.name} campus building`,
        }).catch(() => {});
      }
    }
  } catch (e) {
    logger.warn('[Attendance] Auto-ensure hostels error: ' + e.message);
  }

  const standardConfigs = [
    {
      code: 'BH1',
      name: "Boys' Hostel 1 (BH1)",
      floors: ['All Floors', 'Basement / Wing B', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
    },
    {
      code: 'BH2',
      name: "Boys' Hostel 2 (BH2)",
      floors: ['All Floors', 'Basement / Wing B', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
    },
    {
      code: 'GH1',
      name: "Girls' Hostel 1 (GH1)",
      floors: ['All Floors', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
    },
    {
      code: 'GH2',
      name: "Girls' Hostel 2 (GH2)",
      floors: ['All Floors', 'Ground Floor', '1st Floor', '2nd Floor', '3rd Floor'],
    },
  ];

  // Check defined hostels in DB
  const definedHostels = await Hostel.find({ active: true, code: { $not: /^test/i } }).sort({ code: 1 }).lean();
  const hostelMap = new Map();

  for (const h of definedHostels) {
    if (h.code === 'GH') continue; // Legacy GH skipped in favor of GH1 & GH2

    const floors = await HostelFloor.find({ hostel_id: h._id, active: true })
      .sort({ floor_number: 1 })
      .lean();

    const rooms = await HostelRoom.find({ hostel_id: h._id }).select('_id');
    const roomIds = rooms.map((r) => r._id);
    const allocCount = await RoomAllocation.countDocuments({
      room_id: { $in: roomIds },
      status: 'active',
    });

    let userCount = 0;
    if (h.code === 'GH1') {
      userCount = await User.countDocuments({ role: 'student', hostel: { $in: ['GH1', 'GH'] }, isActive: true });
    } else {
      userCount = await User.countDocuments({ role: 'student', hostel: h.code, isActive: true });
    }

    const matchedConfig = standardConfigs.find((c) => c.code === h.code);
    const dbFloorLabels = floors.map((f) => f.label || (f.floor_number === 0 ? 'Ground Floor' : f.floor_number === -1 ? 'Basement / Wing B' : `${f.floor_number} Floor`));
    const combinedFloors = Array.from(new Set(['All Floors', ...dbFloorLabels, ...(matchedConfig?.floors || [])]));

    hostelMap.set(h.code, {
      hostel: h.code,
      name: matchedConfig?.name || `${h.name} (${h.code})`,
      studentCount: Math.max(allocCount, userCount),
      floors: combinedFloors,
    });
  }

  // Ensure all 4 standard hostels exist in response
  for (const sc of standardConfigs) {
    if (!hostelMap.has(sc.code)) {
      let userCount = 0;
      if (sc.code === 'GH1') {
        userCount = await User.countDocuments({ role: 'student', hostel: { $in: ['GH1', 'GH'] }, isActive: true });
      } else {
        userCount = await User.countDocuments({ role: 'student', hostel: sc.code, isActive: true });
      }

      hostelMap.set(sc.code, {
        hostel: sc.code,
        name: sc.name,
        studentCount: userCount,
        floors: sc.floors,
      });
    }
  }

  // Consistent campus order: BH1, BH2, GH1, GH2
  const order = { BH1: 1, BH2: 2, GH1: 3, GH2: 4 };
  return Array.from(hostelMap.values()).sort(
    (a, b) => (order[a.hostel] || 99) - (order[b.hostel] || 99)
  );
};


/**
 * Start or resume an attendance round for a given hostel and floor.
 */
const startOrResumeRound = async ({ hostel, floor, session_name = 'Night Attendance', staffUser }) => {
  const date = getTodayDateStr();
  const now = new Date();
  const cleanHostel = hostel.toUpperCase();
  const cleanFloor = String(floor).trim();
  const permanentSession = 'Night Attendance'; // Fixed permanent session

  // 1. Look for existing active round for this staff/hostel/floor/session/date
  // An expired round is not resumable. Finalize its pending students before a
  // subsequent staff click opens a fresh two-hour window.
  await finalizeExpiredNightAttendance(now);

  let existingRound = await AttendanceRound.findOne({
    date,
    session_name: permanentSession,
    hostel: cleanHostel,
    floor: cleanFloor,
    status: 'active',
    window_end: { $gt: now },
  });

  if (existingRound) {
    const initialization = await initializeNightAttendanceAttempts(existingRound);
    return { round: existingRound, resumed: true, ...initialization };
  }

  // 2. Create new round
  const newRound = await AttendanceRound.create({
    date,
    session_name: permanentSession,
    hostel: cleanHostel,
    floor: cleanFloor,
    staff_id: staffUser._id,
    window_start: now,
    window_end: new Date(now.getTime() + NIGHT_ATTENDANCE_WINDOW_MS),
    status: 'active',
  });

  await AttendanceAuditLog.create({
    actor_id: staffUser._id,
    actor_role: staffUser.role,
    actor_name: staffUser.name,
    action: 'ROUND_STARTED',
    entity: 'AttendanceRound',
    entity_id: newRound._id.toString(),
    old_value: null,
    new_value: { hostel: cleanHostel, floor: cleanFloor, session: session_name, date },
    reason: `Staff started attendance round for Floor ${cleanFloor}`,
  });

  const initialization = await initializeNightAttendanceAttempts(newRound);
  return { round: newRound, resumed: false, ...initialization };
};

/**
 * Get room list for a round with status chips and approval progress.
 */
const getRoundRoomsSummary = async (roundId) => {
  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');

  // Try resolving floor structure from authoritative Hostel/HostelRoom/RoomAllocation models
  const floorData = await resolveFloorRooms(round.hostel, round.floor);
  const roomsMap = new Map();

  if (floorData && floorData.rooms && floorData.rooms.length > 0) {
    const roomIds = floorData.rooms.map((r) => r._id);
    const allocations = await RoomAllocation.find({
      room_id: { $in: roomIds },
      status: 'active',
    })
      .populate('student_id', '_id name rollNo roomNo studentPhoto picture phone isActive')
      .lean();

    const allocsByRoomId = new Map();
    for (const alloc of allocations) {
      const k = alloc.room_id.toString();
      if (!allocsByRoomId.has(k)) allocsByRoomId.set(k, []);
      if (alloc.student_id && alloc.student_id.isActive !== false) {
        allocsByRoomId.get(k).push(alloc.student_id);
      }
    }

    for (const roomDoc of floorData.rooms) {
      const occupants = allocsByRoomId.get(roomDoc._id.toString()) || [];
      roomsMap.set(roomDoc.room_number.trim().toUpperCase(), occupants);
    }

    // Some older student records predate RoomAllocation.  They still carry a
    // valid hostel and room number, so use them only for rooms with no active
    // allocation.  Active allocations remain authoritative when present.
    const roomsWithoutAllocations = Array.from(roomsMap.entries())
      .filter(([, occupants]) => occupants.length === 0)
      .map(([roomNo]) => roomNo);

    if (roomsWithoutAllocations.length > 0) {
      const roomVariants = new Set(roomsWithoutAllocations);
      for (const rNo of roomsWithoutAllocations) {
        const digits = rNo.replace(/\D+/g, '');
        if (digits) {
          roomVariants.add(digits);
          roomVariants.add(`B${digits}`);
          roomVariants.add(`A${digits}`);
          roomVariants.add(`C${digits}`);
        }
      }

      const legacyStudents = await User.find({
        role: 'student',
        isActive: true,
        hostel: getStudentHostelFilter(round.hostel),
        roomNo: { $in: Array.from(roomVariants) },
      })
        .select('_id name rollNo hostel roomNo studentPhoto picture phone')
        .lean();

      for (const student of legacyStudents) {
        const rawR = (student.roomNo || '').trim().toUpperCase();
        const digits = rawR.replace(/\D+/g, '');
        for (const [targetRoomNo] of roomsMap.entries()) {
          const targetDigits = targetRoomNo.replace(/\D+/g, '');
          if (targetRoomNo === rawR || (digits && targetDigits === digits)) {
            if (!roomsMap.get(targetRoomNo).some((existing) => String(existing._id) === String(student._id))) {
              roomsMap.get(targetRoomNo).push(student);
            }
          }
        }
      }
    }
  } else {
    // Fallback to User query
    const studentHostelFilter = getStudentHostelFilter(round.hostel);

    const students = await User.find({
      role: 'student',
      isActive: true,
      hostel: studentHostelFilter,
    })
      .select('_id name rollNo roomNo studentPhoto picture phone')
      .lean();

    const isAllFloors = String(round.floor || '').trim().toLowerCase().includes('all');
    const floorStudents = isAllFloors
      ? students
      : students.filter((s) => studentIsInRoundFloor(s, round.floor));
    for (const s of floorStudents) {
      const rNo = (s.roomNo || '').trim().toUpperCase();
      if (!rNo) continue;
      if (!roomsMap.has(rNo)) roomsMap.set(rNo, []);
      roomsMap.get(rNo).push(s);
    }
  }

  // Fetch all room requests for this round
  const requests = await RoomAttendanceRequest.find({ round_id: round._id }).lean();
  const requestByRoom = new Map(requests.map((r) => [r.roomNo, r]));

  // Fetch all responses for these requests
  const requestIds = requests.map((r) => r._id);
  const responses = await RequestResponse.find({ request_id: { $in: requestIds } }).lean();
  const responsesByRequest = new Map();
  for (const resp of responses) {
    const k = resp.request_id.toString();
    if (!responsesByRequest.has(k)) responsesByRequest.set(k, []);
    responsesByRequest.get(k).push(resp);
  }

  const now = Date.now();
  const roomRows = [];

  let completedRoomsCount = 0;
  let skippedRoomsCount = 0;

  for (const [roomNo, studentList] of roomsMap.entries()) {
    const activeReq = requestByRoom.get(roomNo);
    const reqResponses = activeReq ? (responsesByRequest.get(activeReq._id.toString()) || []) : [];

    // Calculate room status
    let status = 'Not started'; // default
    let approvedCount = 0;
    let flaggedCount = 0;
    let onLeaveCount = 0;
    let totalOccupants = studentList.length;

    if (totalOccupants === 0) {
      roomRows.push({
        roomNo,
        occupantCount: 0,
        status: 'Vacant',
        approvedCount: 0,
        onLeaveCount: 0,
        summaryText: 'Vacant (0 occupants)',
        requestId: null,
        requestStatus: null,
        remainingSeconds: 0,
        skipReason: null,
        isVacant: true,
      });
      continue;
    }

    if (activeReq?.status === 'skipped') {
      status = 'Skipped';
      skippedRoomsCount += 1;
    } else if (activeReq) {
      // Analyze student response states
      for (const st of studentList) {
        const resp = reqResponses.find((r) => r.student_id.toString() === st._id.toString());
        if (resp) {
          if (['approved', 'manual_present'].includes(resp.status)) approvedCount += 1;
          if (resp.status === 'on_leave') onLeaveCount += 1;
          if (resp.status === 'flagged') flaggedCount += 1;
        }
      }

      const allResolved =
        reqResponses.length >= totalOccupants &&
        reqResponses.every((r) =>
          ['approved', 'manual_present', 'manual_absent', 'absent', 'on_leave', 'manual_on_leave'].includes(r.status)
        );

      const isExpired = new Date(activeReq.expires_at).getTime() < now;

      if (allResolved) {
        status = 'Completed';
        completedRoomsCount += 1;
      } else if (flaggedCount > 0 || isExpired) {
        status = 'Needs review';
      } else if (activeReq.status === 'open') {
        status = 'Request sent';
      }
    }

    const remainingSeconds =
      activeReq && activeReq.status === 'open'
        ? Math.max(0, Math.round((new Date(activeReq.expires_at).getTime() - now) / 1000))
        : 0;

    roomRows.push({
      roomNo,
      occupantCount: totalOccupants,
      status,
      approvedCount,
      onLeaveCount,
      summaryText: `${approvedCount}/${totalOccupants} approved`,
      requestId: activeReq?._id || null,
      requestStatus: activeReq?.status || null,
      remainingSeconds,
      skipReason: activeReq?.skip_reason || null,
    });
  }

  // Sort rooms naturally e.g. 101, 102, 103
  roomRows.sort((a, b) => a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }));

  const totalRooms = roomRows.length;
  const progressText = `${completedRoomsCount + skippedRoomsCount} of ${totalRooms} rooms done`;

  return {
    round,
    totalRooms,
    completedRooms: completedRoomsCount,
    skippedRooms: skippedRoomsCount,
    progressText,
    rooms: roomRows,
  };
};

/**
 * Get room details including live student roster, leave status, flags, and manual override history.
 */
const getRoomDetails = async (roundId, roomNo) => {
  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');

  const cleanRoomNo = roomNo.trim().toUpperCase();

  // Find students belonging to this room using RoomAllocation as primary source of truth
  let students = [];
  const hostel = await Hostel.findOne({ code: round.hostel.toUpperCase() });
  if (hostel) {
    const roomDoc = await HostelRoom.findOne({ hostel_id: hostel._id, room_number: cleanRoomNo });
    if (roomDoc) {
      const activeAllocations = await RoomAllocation.find({
        room_id: roomDoc._id,
        status: 'active',
      })
        .populate('student_id', '_id name rollNo hostel roomNo phone email studentPhoto picture isActive')
        .lean();

      students = activeAllocations
        .map((a) => a.student_id)
        .filter((s) => s && s.isActive !== false);
    }
  }

  // Fallback if not found via RoomAllocation
  if (students.length === 0) {
    const digitsOnly = cleanRoomNo.replace(/\D+/g, '');
    const roomVariants = [cleanRoomNo];
    if (digitsOnly && digitsOnly !== cleanRoomNo) roomVariants.push(digitsOnly);
    if (digitsOnly) roomVariants.push(`B${digitsOnly}`, `A${digitsOnly}`, `C${digitsOnly}`, `D${digitsOnly}`);

    students = await User.find({
      role: 'student',
      isActive: true,
      hostel: getStudentHostelFilter(round.hostel),
      roomNo: { $in: roomVariants },
    })
      .select('_id name rollNo hostel roomNo phone email studentPhoto picture')
      .lean();
  }

  // Find active request if any
  const request = await RoomAttendanceRequest.findOne({
    round_id: round._id,
    roomNo: cleanRoomNo,
  }).lean();

  let responses = [];
  if (request) {
    responses = await RequestResponse.find({ request_id: request._id }).lean();
  }

  const todayStr = round.date || getTodayDateStr();

  // Build roster with live status
  const roster = await Promise.all(
    students.map(async (student) => {
      const resp = responses.find((r) => r.student_id.toString() === student._id.toString());
      const onLeave = await isStudentOnActiveLeave(student._id, todayStr);

      let status = 'Pending';
      if (onLeave) {
        status = 'On leave';
      } else if (resp) {
        if (resp.status === 'approved') status = 'Approved';
        else if (resp.status === 'manual_present') status = 'Present (manual)';
        else if (resp.status === 'manual_absent' || resp.status === 'absent') status = 'Absent';
        else if (resp.status === 'manual_on_leave') status = 'On leave';
        else if (resp.status === 'flagged') status = 'Flagged';
        else if (resp.status === 'timeout') status = 'Timed out';
      }

      return {
        studentId: student._id,
        name: student.name,
        rollNo: student.rollNo || 'N/A',
        phone: student.phone || null,
        photo: student.studentPhoto || student.picture || `/api/auth/student-photo/${student._id}`,
        status,
        flags: resp?.flags || [],
        approvedAt: resp?.approved_at || null,
        insideGeofence: resp?.inside_geofence ?? null,
        gpsAccuracy: resp?.gps_accuracy ?? null,
        remark: resp?.remark || null,
      };
    })
  );

  const now = Date.now();
  const remainingSeconds =
    request && request.status === 'open'
      ? Math.max(0, Math.round((new Date(request.expires_at).getTime() - now) / 1000))
      : 0;

  return {
    roundId: round._id,
    hostel: round.hostel,
    floor: round.floor,
    roomNo: cleanRoomNo,
    request: request
      ? {
          id: request._id,
          status: request.status,
          expires_at: request.expires_at,
          remainingSeconds,
          skip_reason: request.skip_reason,
        }
      : null,
    students: roster,
  };
};

/**
 * Dispatch attendance request for a room and notify eligible students.
 */
const requestRoomAttendance = async ({ roundId, roomNo, staffUser }) => {
  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');
  if (round.status !== 'active') throw new Error('Cannot request attendance on a completed round');

  const cleanRoomNo = roomNo.trim().toUpperCase();

  // Find students in room using RoomAllocation as primary source of truth
  let students = [];
  let roomDoc = null;
  const allocMap = new Map();

  const hostel = await Hostel.findOne({ code: round.hostel.toUpperCase() });
  if (hostel) {
    roomDoc = await HostelRoom.findOne({ hostel_id: hostel._id, room_number: cleanRoomNo });
    if (roomDoc) {
      const activeAllocations = await RoomAllocation.find({
        room_id: roomDoc._id,
        status: 'active',
      })
        .populate('student_id', '_id name rollNo hostel roomNo phone email studentPhoto picture isActive')
        .lean();

      for (const a of activeAllocations) {
        if (a.student_id && a.student_id.isActive !== false) {
          students.push(a.student_id);
          allocMap.set(a.student_id._id.toString(), a._id);
        }
      }
    }
  }

  // Legacy student records may have a room number but no RoomAllocation yet.
  // Fall back to that roster when this room has no active allocations.
  if (students.length === 0) {
    const digitsOnly = cleanRoomNo.replace(/\D+/g, '');
    const roomVariants = [cleanRoomNo];
    if (digitsOnly && digitsOnly !== cleanRoomNo) roomVariants.push(digitsOnly);
    if (digitsOnly) roomVariants.push(`B${digitsOnly}`, `A${digitsOnly}`, `C${digitsOnly}`, `D${digitsOnly}`);

    students = await User.find({
      role: 'student',
      isActive: true,
      hostel: getStudentHostelFilter(round.hostel),
      roomNo: { $in: roomVariants },
    }).lean();
  }

  if (students.length === 0) {
    throw new Error(`Room ${cleanRoomNo} is vacant (no students assigned)`);
  }

  // Create or refresh RoomAttendanceRequest
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000);
  const nonce = uuidv4();

  let request = await RoomAttendanceRequest.findOne({
    round_id: round._id,
    roomNo: cleanRoomNo,
  });

  if (request) {
    request.status = 'open';
    request.expires_at = expiresAt;
    request.nonce = nonce;
    request.nonce_used = false;
    request.skip_reason = null;
    request.skipped_at = null;
    request.staff_id = staffUser._id;
    if (roomDoc) request.room_id = roomDoc._id;
    await request.save();
  } else {
    request = await RoomAttendanceRequest.create({
      round_id: round._id,
      room_id: roomDoc ? roomDoc._id : undefined,
      hostel: round.hostel,
      roomNo: cleanRoomNo,
      staff_id: staffUser._id,
      status: 'open',
      expires_at: expiresAt,
      nonce,
    });
  }

  const todayStr = round.date || getTodayDateStr();
  const io = getIO();

  // Initialize/refresh RequestResponse for each student
  for (const st of students) {
    const onLeave = await isStudentOnActiveLeave(st._id, todayStr);

    let resp = await RequestResponse.findOne({
      request_id: request._id,
      student_id: st._id,
    });

    const allocId = allocMap.get(st._id.toString()) || undefined;

    if (!resp) {
      resp = await RequestResponse.create({
        request_id: request._id,
        student_id: st._id,
        allocation_id: allocId,
        status: onLeave ? 'on_leave' : 'pending',
        remark: onLeave ? 'On approved home visit leave' : null,
      });
    } else {
      if (allocId) resp.allocation_id = allocId;
      if (onLeave) {
        resp.status = 'on_leave';
        resp.remark = 'On approved home visit leave';
        await resp.save();
      } else if (resp.status !== 'approved' && resp.status !== 'manual_present') {
        resp.status = 'pending';
        await resp.save();
      }
    }

    if (!onLeave) {
      // Reset student attempt counter to give 3 fresh attempts for the new request
      await AttendanceAttempt.findOneAndUpdate(
        { student_id: st._id, date: todayStr },
        {
          $set: {
            status: 'pending',
            attemptsCount: 0,
            locationStatus: 'NOT CHECKED',
            expires_at: expiresAt,
            attempts: [],
          },
        }
      ).catch(() => {});

      // Delete any preliminary/stale absent record so student can verify freshly
      await AttendanceRecord.deleteOne({
        student_id: st._id,
        date: todayStr,
        status: 'absent',
      }).catch(() => {});
    } else {
      // Ensure on-leave student has immediate ledger record
      const stFloor = parseFloorFromRoom(cleanRoomNo);
      await AttendanceRecord.findOneAndUpdate(
        { student_id: st._id, date: todayStr, session: 'Night Attendance' },
        {
          $setOnInsert: {
            student_id: st._id,
            date: todayStr,
            session: 'Night Attendance',
            session_name: 'Night Attendance',
            hostel: round.hostel,
            floor: stFloor,
            roomNo: cleanRoomNo,
            student_name: st.name || '',
            student_rollNo: st.rollNo || '',
            status: 'on_leave',
            method: 'staff_marked',
            remark: 'On approved home visit leave',
            round_id: round._id,
            request_id: request._id,
            verification_timestamp: new Date(),
          },
        },
        { upsert: true, new: true }
      ).catch((err) => logger.warn('[AttendanceRecord] Init record warning: ' + err.message));
    }

    // Notify student instantly via Socket.IO if NOT on leave!
    if (!onLeave && io) {
      const payload = {
        requestId: request._id,
        roomNo: cleanRoomNo,
        hostel: round.hostel,
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: DEFAULT_TTL_SECONDS,
        nonce,
      };
      io.to(`student:${st._id}`).emit('attendance_requested', payload);
      io.to(`user:${st._id}`).emit('attendance_requested', payload);
    }
  }

  logger.info('[Attendance] Request dispatched for room', {
    roundId: round._id,
    roomNo: cleanRoomNo,
    studentCount: students.length,
  });

  return {
    request,
    expiresAt,
    ttlSeconds: DEFAULT_TTL_SECONDS,
  };
};

/**
 * Resend attendance request for an active room.
 */
const resendRoomRequest = async ({ requestId, staffUser }) => {
  const request = await RoomAttendanceRequest.findById(requestId);
  if (!request) throw new Error('Attendance request not found');

  return requestRoomAttendance({
    roundId: request.round_id,
    roomNo: request.roomNo,
    staffUser,
  });
};

/**
 * Skip a room with a mandatory reason.
 */
const skipRoom = async ({ roundId, roomNo, reason, staffUser }) => {
  if (!reason || !reason.trim()) {
    throw new Error('REASON_REQUIRED: A mandatory skip reason is required (e.g. room locked, students on leave)');
  }

  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');

  const cleanRoomNo = roomNo.trim().toUpperCase();

  let request = await RoomAttendanceRequest.findOne({
    round_id: round._id,
    roomNo: cleanRoomNo,
  });

  const now = new Date();
  if (request) {
    request.status = 'skipped';
    request.skip_reason = reason.trim();
    request.skipped_at = now;
    await request.save();
  } else {
    request = await RoomAttendanceRequest.create({
      round_id: round._id,
      hostel: round.hostel,
      roomNo: cleanRoomNo,
      staff_id: staffUser._id,
      status: 'skipped',
      expires_at: now,
      nonce: uuidv4(),
      skip_reason: reason.trim(),
      skipped_at: now,
    });
  }

  await AttendanceAuditLog.create({
    actor_id: staffUser._id,
    actor_role: staffUser.role,
    actor_name: staffUser.name,
    action: 'ROOM_SKIPPED',
    entity: 'RoomAttendanceRequest',
    entity_id: request._id.toString(),
    old_value: null,
    new_value: { roomNo: cleanRoomNo, skip_reason: reason.trim() },
    reason: reason.trim(),
  });

  return request;
};

/**
 * Reopen a skipped room.
 */
const reopenRoom = async ({ roundId, roomNo, staffUser }) => {
  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');

  const cleanRoomNo = roomNo.trim().toUpperCase();
  const request = await RoomAttendanceRequest.findOne({
    round_id: round._id,
    roomNo: cleanRoomNo,
  });

  if (request) {
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000);
    request.status = 'open';
    request.expires_at = expiresAt;
    request.skip_reason = null;
    request.skipped_at = null;
    await request.save();

    const todayStr = round.date || getTodayDateStr();
    const responses = await RequestResponse.find({ request_id: request._id });
    const io = getIO();

    for (const resp of responses) {
      if (resp.status !== 'approved' && resp.status !== 'on_leave') {
        resp.status = 'pending';
        await resp.save();

        await AttendanceAttempt.findOneAndUpdate(
          { student_id: resp.student_id, date: todayStr },
          {
            $set: {
              status: 'pending',
              attemptsCount: 0,
              locationStatus: 'NOT CHECKED',
              expires_at: expiresAt,
              attempts: [],
            },
          }
        ).catch(() => {});

        await AttendanceRecord.deleteOne({
          student_id: resp.student_id,
          date: todayStr,
          status: 'absent',
        }).catch(() => {});

        if (io) {
          const payload = {
            requestId: request._id,
            roomNo: cleanRoomNo,
            hostel: round.hostel,
            expiresAt: expiresAt.toISOString(),
            ttlSeconds: DEFAULT_TTL_SECONDS,
            nonce: request.nonce,
          };
          io.to(`student:${resp.student_id}`).emit('attendance_requested', payload);
          io.to(`user:${resp.student_id}`).emit('attendance_requested', payload);
        }
      }
    }

    await AttendanceAuditLog.create({
      actor_id: staffUser._id,
      actor_role: staffUser.role,
      actor_name: staffUser.name,
      action: 'ROOM_REOPENED',
      entity: 'RoomAttendanceRequest',
      entity_id: request._id.toString(),
      old_value: { status: 'skipped' },
      new_value: { status: 'open' },
      reason: 'Staff reopened skipped room for attendance verification',
    });
  }

  return request;
};

/**
 * Complete and lock a round after verifying all rooms are Completed or Skipped.
 */
const completeRound = async ({ roundId, staffUser }) => {
  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');
  if (round.status === 'completed') throw new Error('Round is already completed and locked');

  const summary = await getRoundRoomsSummary(round._id);

  // Check if every room is either Completed, Skipped, or Vacant
  const incompleteRooms = summary.rooms.filter(
    (r) => r.status !== 'Completed' && r.status !== 'Skipped' && r.status !== 'Vacant'
  );

  if (incompleteRooms.length > 0) {
    throw new Error(
      `CANNOT_COMPLETE: ${incompleteRooms.length} rooms are not completed or skipped yet (e.g. Room ${incompleteRooms[0].roomNo}). All rooms must be completed or skipped before finalizing round.`
    );
  }

  // Calculate stats & write official AttendanceRecords
  let presentCount = 0;
  let absentCount = 0;
  let onLeaveCount = 0;
  let manualCount = 0;
  let flaggedCount = 0;

  for (const r of summary.rooms) {
    const details = await getRoomDetails(round._id, r.roomNo);
    for (const st of details.students) {
      let finalStatus = 'absent';
      let method = 'staff_marked';

      if (['Approved', 'Present (manual)'].includes(st.status)) {
        finalStatus = 'present';
        presentCount += 1;
        if (st.status === 'Present (manual)') manualCount += 1;
        if (st.status === 'Approved') method = 'self_approved';
      } else if (st.status === 'On leave') {
        finalStatus = 'on_leave';
        onLeaveCount += 1;
      } else {
        absentCount += 1;
      }

      if (st.flags && st.flags.length > 0) flaggedCount += 1;

      // Upsert AttendanceRecord
      await AttendanceRecord.findOneAndUpdate(
        {
          student_id: st.studentId,
          date: round.date,
          session: round.session_name,
        },
        {
          student_id: st.studentId,
          date: round.date,
          session: round.session_name,
          session_name: round.session_name,
          hostel: round.hostel,
          floor: round.floor,
          roomNo: r.roomNo,
          student_name: st.name || '',
          student_rollNo: st.rollNo || '',
          status: finalStatus,
          method,
          verified_by: staffUser._id,
          remark: st.remark || null,
          round_id: round._id,
          verification_timestamp: new Date(),
        },
        { upsert: true, new: true }
      );
    }
  }

  const completedSummary = {
    total_rooms: summary.totalRooms,
    completed_rooms: summary.completedRooms,
    skipped_rooms: summary.skippedRooms,
    present_students: presentCount,
    absent_students: absentCount,
    on_leave_students: onLeaveCount,
    manual_marked: manualCount,
    flagged_students: flaggedCount,
    completed_at: new Date(),
  };

  round.status = 'completed';
  round.completed_at = new Date();
  round.completed_summary = completedSummary;
  await round.save();

  await AttendanceAuditLog.create({
    actor_id: staffUser._id,
    actor_role: staffUser.role,
    actor_name: staffUser.name,
    action: 'ROUND_COMPLETED',
    entity: 'AttendanceRound',
    entity_id: round._id.toString(),
    old_value: { status: 'active' },
    new_value: completedSummary,
    reason: `Staff finalized attendance round with ${summary.completedRooms} completed rooms and ${summary.skippedRooms} skipped rooms`,
  });

  const io = getIO();
  if (io) {
    io.of('/dashboard').emit('round_completed', {
      roundId: round._id,
      completedSummary,
    });
    io.emit('round_completed', {
      roundId: round._id,
      completedSummary,
    });
  }

  return { round, completedSummary };
};

/**
 * Request attendance for ALL occupied rooms in a round in 1 click.
 */
const requestAllRoomsInRound = async ({ roundId, staffUser }) => {
  const round = await AttendanceRound.findById(roundId);
  if (!round) throw new Error('Attendance round not found');
  if (round.status !== 'active') throw new Error('Cannot request attendance on a completed round');

  const summary = await getRoundRoomsSummary(roundId);
  // Eligible rooms: non-vacant, occupantCount > 0, and not skipped
  const eligibleRooms = (summary.rooms || []).filter(
    (r) => !r.isVacant && r.occupantCount > 0 && r.status !== 'Skipped'
  );

  if (eligibleRooms.length === 0) {
    return {
      roundId: round._id,
      totalRoomsTargeted: 0,
      requestedRoomsCount: 0,
      totalStudentsNotified: 0,
      message: 'No occupied rooms found on this floor to request attendance for',
      results: [],
    };
  }

  const results = await Promise.all(
    eligibleRooms.map(async (r) => {
      try {
        await requestRoomAttendance({
          roundId: round._id,
          roomNo: r.roomNo,
          staffUser,
        });
        return { roomNo: r.roomNo, success: true, count: r.occupantCount };
      } catch (err) {
        logger.warn(`[Attendance] Auto-request room ${r.roomNo} skipped: ${err.message}`);
        return { roomNo: r.roomNo, success: false, error: err.message };
      }
    })
  );

  const successfulRooms = results.filter((r) => r.success);
  const totalStudentsNotified = successfulRooms.reduce((sum, r) => sum + (r.count || 0), 0);

  const io = getIO();
  if (io) {
    io.of('/dashboard').emit('room_attendance_updated', {
      roundId: round._id,
      allRequested: true,
      successfulRoomsCount: successfulRooms.length,
    });
  }

  logger.info('[Attendance] 1-Click requested all rooms on floor round', {
    roundId: round._id,
    floor: round.floor,
    hostel: round.hostel,
    successfulRooms: successfulRooms.length,
    totalStudentsNotified,
  });

  return {
    roundId: round._id,
    totalRoomsTargeted: eligibleRooms.length,
    requestedRoomsCount: successfulRooms.length,
    totalStudentsNotified,
    results,
  };
};

/**
 * Request attendance for the ENTIRE hostel (all floors) in 1 click.
 */
const requestEntireHostelAttendance = async ({ hostel, sessionName, staffUser }) => {
  const normHostel = hostel ? hostel.trim().toUpperCase() : 'BH1';
  const allHostels = await getHostelsAndFloors(staffUser);
  const targetHostel = allHostels.find((h) => h.hostel.toUpperCase() === normHostel);
  const floors = targetHostel?.floors || ['1', '2', '3', '4'];

  const floorResults = [];
  let totalRooms = 0;
  let totalStudents = 0;

  for (const fl of floors) {
    try {
      const { round } = await startOrResumeRound({
        hostel: normHostel,
        floor: fl,
        sessionName: sessionName || 'Night Attendance',
        staffUser,
      });

      const res = await requestAllRoomsInRound({
        roundId: round._id,
        staffUser,
      });

      floorResults.push({
        floor: fl,
        roundId: round._id,
        success: true,
        roomsCount: res.requestedRoomsCount,
        studentsCount: res.totalStudentsNotified,
      });

      totalRooms += res.requestedRoomsCount;
      totalStudents += res.totalStudentsNotified;
    } catch (err) {
      logger.warn(`[Attendance] 1-Click entire hostel round request error on floor ${fl}: ${err.message}`);
      floorResults.push({
        floor: fl,
        success: false,
        error: err.message,
      });
    }
  }

  return {
    hostel: normHostel,
    floorsTargeted: floors.length,
    totalRoomsRequested: totalRooms,
    totalStudentsNotified: totalStudents,
    floorResults,
  };
};

module.exports = {
  parseFloorFromRoom,
  normalizeFloor,
  studentIsInRoundFloor,
  getHostelsAndFloors,
  startOrResumeRound,
  getRoundRoomsSummary,
  getRoomDetails,
  requestRoomAttendance,
  resendRoomRequest,
  requestAllRoomsInRound,
  requestEntireHostelAttendance,
  skipRoom,
  reopenRoom,
  completeRound,
};
