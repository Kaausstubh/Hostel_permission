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
const AttendanceAuditLog = require('../models/AttendanceAuditLog');
const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const { getIO } = require('./socketService');
const logger = require('../utils/logger');

const DEFAULT_TTL_SECONDS = parseInt(process.env.ATTENDANCE_REQUEST_TTL_SECONDS || '90', 10);

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
  if (!roomNo) return '1st Floor';
  const clean = String(roomNo).trim().toUpperCase();

  if (clean.startsWith('B')) {
    return 'Basement / Wing B';
  }

  const num = parseInt(clean, 10);
  if (!isNaN(num)) {
    if (num < 100) return 'Ground Floor';
    if (num >= 100 && num < 200) return '1st Floor';
    if (num >= 200 && num < 300) return '2nd Floor';
    if (num >= 300 && num < 400) return '3rd Floor';
  }

  return '1st Floor';
};

/**
 * Get current date string in YYYY-MM-DD
 */
const getTodayDateStr = () => {
  const now = new Date();
  return now.toISOString().split('T')[0];
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
  // Check defined hostels
  const definedHostels = await Hostel.find({ active: true }).sort({ code: 1 }).lean();

  if (definedHostels.length > 0) {
    const result = [];
    for (const h of definedHostels) {
      const floors = await HostelFloor.find({ hostel_id: h._id, active: true })
        .sort({ floor_number: 1 })
        .lean();

      // Count active allocations in this hostel
      const rooms = await HostelRoom.find({ hostel_id: h._id }).select('_id');
      const roomIds = rooms.map((r) => r._id);
      const studentCount = await RoomAllocation.countDocuments({
        room_id: { $in: roomIds },
        status: 'active',
      });

      result.push({
        hostel: h.code,
        name: `${h.name} (${h.code})`,
        studentCount,
        floors: floors.map((f) => f.label),
      });
    }

    // Include BH1 and GH if they are not in definedHostels
    const existingCodes = new Set(definedHostels.map((h) => h.code));
    for (const fallbackCode of ['BH1', 'GH']) {
      if (!existingCodes.has(fallbackCode)) {
        const legacyStudents = await User.countDocuments({ role: 'student', hostel: fallbackCode, isActive: true });
        result.push({
          hostel: fallbackCode,
          name: fallbackCode === 'BH1' ? "Boys' Hostel 1 (BH1)" : "Girls' Hostel (GH)",
          studentCount: legacyStudents,
          floors: ['1st Floor', '2nd Floor', '3rd Floor'],
        });
      }
    }

    return result;
  }

  // Fallback for legacy DB
  const students = await User.find({
    role: 'student',
    isActive: true,
    hostel: { $in: ['BH1', 'BH2', 'GH'] },
    roomNo: { $ne: null },
  })
    .select('hostel roomNo')
    .lean();

  const hostelMap = {
    BH1: { name: "Boys' Hostel 1 (BH1)", floors: new Set(), studentCount: 0 },
    BH2: { name: "Boys' Hostel 2 (BH2)", floors: new Set(), studentCount: 0 },
    GH:  { name: "Girls' Hostel (GH)", floors: new Set(), studentCount: 0 },
  };

  for (const s of students) {
    if (!hostelMap[s.hostel]) continue;
    hostelMap[s.hostel].studentCount += 1;
    const floor = parseFloorFromRoom(s.roomNo);
    hostelMap[s.hostel].floors.add(floor);
  }

  return Object.entries(hostelMap).map(([hostelKey, data]) => ({
    hostel: hostelKey,
    name: data.name,
    studentCount: data.studentCount,
    floors: Array.from(data.floors).length > 0 ? Array.from(data.floors) : ['1st Floor', '2nd Floor', '3rd Floor'],
  }));
};


/**
 * Start or resume an attendance round for a given hostel and floor.
 */
const startOrResumeRound = async ({ hostel, floor, session_name = 'Night Attendance', staffUser }) => {
  const date = getTodayDateStr();
  const cleanHostel = hostel.toUpperCase();
  const cleanFloor = String(floor).trim();

  // 1. Look for existing active round for this staff/hostel/floor/session/date
  let existingRound = await AttendanceRound.findOne({
    date,
    session_name,
    hostel: cleanHostel,
    floor: cleanFloor,
    status: 'active',
  });

  if (existingRound) {
    return { round: existingRound, resumed: true };
  }

  // 2. Create new round
  const newRound = await AttendanceRound.create({
    date,
    session_name,
    hostel: cleanHostel,
    floor: cleanFloor,
    staff_id: staffUser._id,
    window_start: new Date(),
    window_end: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4-hour window default
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

  return { round: newRound, resumed: false };
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
  } else {
    // Fallback to User query
    const students = await User.find({
      role: 'student',
      isActive: true,
      hostel: round.hostel,
    })
      .select('_id name rollNo roomNo studentPhoto picture phone')
      .lean();

    const floorStudents = students.filter((s) => parseFloorFromRoom(s.roomNo) === round.floor);
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
          ['approved', 'manual_present', 'manual_absent', 'on_leave', 'manual_on_leave'].includes(r.status)
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
    students = await User.find({
      role: 'student',
      isActive: true,
      hostel: round.hostel,
      roomNo: cleanRoomNo,
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
        else if (resp.status === 'manual_absent') status = 'Absent';
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

  // Fallback if not found via RoomAllocation
  if (students.length === 0 && !roomDoc) {
    students = await User.find({
      role: 'student',
      isActive: true,
      hostel: round.hostel,
      roomNo: cleanRoomNo,
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
    request.status = 'open';
    request.skip_reason = null;
    request.skipped_at = null;
    await request.save();

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
          status: finalStatus,
          method,
          verified_by: staffUser._id,
          remark: st.remark || null,
          round_id: round._id,
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

module.exports = {
  parseFloorFromRoom,
  getHostelsAndFloors,
  startOrResumeRound,
  getRoundRoomsSummary,
  getRoomDetails,
  requestRoomAttendance,
  resendRoomRequest,
  skipRoom,
  reopenRoom,
  completeRound,
};
