/**
 * Room Allocation Service
 * Implements business logic for managing hostel rooms, floor structure,
 * student allocations, atomic transfers, vacates, and audit logs.
 */

const mongoose = require('mongoose');
const Hostel = require('../models/Hostel');
const HostelFloor = require('../models/HostelFloor');
const HostelRoom = require('../models/HostelRoom');
const RoomAllocation = require('../models/RoomAllocation');
const RoomAllocationAudit = require('../models/RoomAllocationAudit');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * List all active hostels
 */
async function getHostels() {
  return Hostel.find({ active: true }).sort({ code: 1 }).lean();
}

/**
 * List floors for a specific hostel
 */
async function getFloorsByHostel(hostelId) {
  return HostelFloor.find({ hostel_id: hostelId, active: true })
    .sort({ floor_number: 1 })
    .lean();
}

/**
 * List rooms for a floor with live occupant counts and vacancy status
 */
async function getRoomsByFloor(floorId, filterStatus = null) {
  const query = { floor_id: floorId };
  if (filterStatus) {
    query.status = filterStatus;
  }

  const rooms = await HostelRoom.find(query)
    .sort({ room_number: 1 })
    .lean();

  if (!rooms.length) return [];

  const roomIds = rooms.map((r) => r._id);

  // Fetch all active allocations for these rooms in a single query
  const activeAllocations = await RoomAllocation.find({
    room_id: { $in: roomIds },
    status: 'active',
  })
    .populate('student_id', 'name rollNo phone email')
    .lean();

  // Group allocations by room_id
  const allocationsByRoom = {};
  for (const alloc of activeAllocations) {
    const rid = alloc.room_id.toString();
    if (!allocationsByRoom[rid]) allocationsByRoom[rid] = [];
    allocationsByRoom[rid].push(alloc);
  }

  // Augment rooms with live counts
  return rooms.map((room) => {
    const occupants = allocationsByRoom[room._id.toString()] || [];
    const activeCount = occupants.length;
    const capacity = room.capacity || 4;
    const vacantBeds = Math.max(0, capacity - activeCount);

    let calculatedStatus = room.status;
    if (room.status !== 'maintenance' && room.status !== 'blocked') {
      if (activeCount === 0) {
        calculatedStatus = 'available';
      } else if (activeCount >= capacity) {
        calculatedStatus = 'full';
      } else {
        calculatedStatus = 'occupied';
      }
    }

    return {
      ...room,
      occupantsCount: activeCount,
      vacantBeds,
      calculatedStatus,
      occupants: occupants.map((o) => ({
        allocation_id: o._id,
        bed_number: o.bed_number,
        allocated_on: o.allocated_on,
        student: o.student_id,
      })),
    };
  });
}

/**
 * Get full details of a specific room, including current occupants and allocation history
 */
async function getRoomDetails(roomId) {
  const room = await HostelRoom.findById(roomId)
    .populate('hostel_id', 'code name type')
    .populate('floor_id', 'floor_number label')
    .lean();

  if (!room) {
    const error = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  // Active occupants
  const activeAllocations = await RoomAllocation.find({
    room_id: roomId,
    status: 'active',
  })
    .populate('student_id', 'name rollNo phone email')
    .sort({ allocated_on: 1 })
    .lean();

  // Past allocation history
  const history = await RoomAllocation.find({
    room_id: roomId,
    status: { $in: ['vacated', 'transferred'] },
  })
    .populate('student_id', 'name rollNo email')
    .populate('allocated_by', 'name role')
    .sort({ vacated_on: -1 })
    .limit(50)
    .lean();

  // Audit events for this room
  const auditLogs = await RoomAllocationAudit.find({
    $or: [{ old_room_id: roomId }, { new_room_id: roomId }],
  })
    .populate('actor_id', 'name role')
    .populate('student_id', 'name rollNo')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const capacity = room.capacity || 4;
  const activeCount = activeAllocations.length;

  return {
    ...room,
    capacity,
    occupantsCount: activeCount,
    vacantBeds: Math.max(0, capacity - activeCount),
    activeOccupants: activeAllocations,
    history,
    auditLogs,
  };
}

/**
 * Add a new room to a floor
 */
async function createRoom({ hostel_id, floor_id, room_number, capacity = 4, room_type = 'Standard', status = 'available', remarks = '' }) {
  const normalizedNumber = room_number.toString().trim().toUpperCase();

  const existing = await HostelRoom.findOne({
    hostel_id,
    room_number: normalizedNumber,
  });

  if (existing) {
    const error = new Error(`Room ${normalizedNumber} already exists in this hostel`);
    error.code = 'ROOM_ALREADY_EXISTS';
    error.status = 400;
    throw error;
  }

  return HostelRoom.create({
    hostel_id,
    floor_id,
    room_number: normalizedNumber,
    capacity: Number(capacity) || 4,
    room_type,
    status,
    remarks,
  });
}

/**
 * Update room capacity, status (maintenance/blocked), or remarks
 */
async function updateRoom(roomId, updates, actor = {}) {
  const room = await HostelRoom.findById(roomId);
  if (!room) {
    const error = new Error('Room not found');
    error.code = 'ROOM_NOT_FOUND';
    error.status = 404;
    throw error;
  }

  const activeCount = await RoomAllocation.countDocuments({
    room_id: roomId,
    status: 'active',
  });

  if (updates.capacity !== undefined) {
    const newCap = Number(updates.capacity);
    if (newCap < activeCount) {
      const error = new Error(`Cannot set capacity to ${newCap}; room currently has ${activeCount} active occupants`);
      error.code = 'CAPACITY_TOO_LOW';
      error.status = 400;
      throw error;
    }
    room.capacity = newCap;
  }

  if (updates.status !== undefined) {
    room.status = updates.status;
  }
  if (updates.room_type !== undefined) room.room_type = updates.room_type;
  if (updates.remarks !== undefined) room.remarks = updates.remarks;

  await room.save();

  // Audit entry for room configuration update
  await RoomAllocationAudit.create({
    student_id: actor._id || room._id, // fallback
    action: 'BULK_IMPORT',
    new_room_id: room._id,
    actor_id: actor._id || null,
    actor_role: actor.role || 'warden',
    reason: `Room updated: status=${room.status}, capacity=${room.capacity}`,
    details: updates,
  }).catch((e) => logger.warn('[AllocationAudit] Failed to log room update', { error: e.message }));

  return room;
}

/**
 * Helper to run operations within a MongoDB transaction when available (e.g., replica set),
 * or execute directly when running against a standalone development MongoDB instance.
 */
function isTransactionSupported() {
  const type = mongoose.connection.client?.topology?.description?.type;
  return type === 'ReplicaSetWithPrimary' || type === 'Sharded';
}

async function executeWithOptionalTransaction(fn) {
  if (!isTransactionSupported()) {
    return await fn(null);
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const res = await fn(session);
    await session.commitTransaction();
    return res;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}


/**
 * Allocate a student to a room (with strict validation)
 */
async function allocateStudent({
  student_id,
  room_id,
  bed_number = null,
  remarks = '',
  actor_id = null,
  actor_role = 'warden',
  source = 'manual',
}) {
  return executeWithOptionalTransaction(async (session) => {
    const opts = session ? { session } : {};

    const student = await User.findById(student_id, null, opts);
    if (!student) {
      const error = new Error('Student not found');
      error.code = 'STUDENT_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const roomQuery = HostelRoom.findById(room_id).populate('hostel_id', 'code');
    if (session) roomQuery.session(session);
    const room = await roomQuery;

    if (!room) {
      const error = new Error('Room not found');
      error.code = 'ROOM_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (room.status === 'maintenance' || room.status === 'blocked') {
      const error = new Error(`Room is currently in ${room.status} status and cannot receive allocations`);
      error.code = 'ROOM_UNAVAILABLE';
      error.status = 400;
      throw error;
    }

    // Check one active allocation per student constraint
    const activeQuery = RoomAllocation.findOne({
      student_id,
      status: 'active',
    });
    if (session) activeQuery.session(session);
    const existingActive = await activeQuery;

    if (existingActive) {
      const error = new Error(`Student ${student.name} (${student.rollNo}) already has an active room allocation`);
      error.code = 'STUDENT_ALREADY_ALLOCATED';
      error.status = 400;
      throw error;
    }

    // Check room capacity
    const countQuery = RoomAllocation.countDocuments({
      room_id,
      status: 'active',
    });
    if (session) countQuery.session(session);
    const activeCount = await countQuery;

    if (activeCount >= room.capacity) {
      const error = new Error(`Room ${room.room_number} is full (capacity ${room.capacity}/${room.capacity})`);
      error.code = 'ROOM_FULL';
      error.status = 400;
      throw error;
    }

    // Create allocation
    const allocation = new RoomAllocation({
      student_id,
      room_id,
      bed_number,
      allocated_on: new Date(),
      status: 'active',
      allocated_by: actor_id,
      remarks,
      source,
    });
    await allocation.save(opts);

    // Update room occupancy status
    const newActiveCount = activeCount + 1;
    room.status = newActiveCount >= room.capacity ? 'full' : 'occupied';
    await room.save(opts);

    // Update User record for backward compatibility
    student.roomNo = room.room_number;
    if (room.hostel_id && room.hostel_id.code) {
      student.hostel = room.hostel_id.code;
    }
    await student.save(opts);

    // Record audit log
    await RoomAllocationAudit.create(
      [
        {
          allocation_id: allocation._id,
          student_id,
          action: 'ALLOCATE',
          new_room_id: room._id,
          actor_id,
          actor_role,
          reason: remarks || 'Allocated to room',
          details: { bed_number, source },
        },
      ],
      opts
    );

    return allocation;
  });
}


/**
 * Transfer a student from one room to another atomically
 */
async function transferStudent({
  allocation_id,
  new_room_id,
  bed_number = null,
  reason,
  actor_id = null,
  actor_role = 'warden',
}) {
  if (!reason || !reason.trim()) {
    const error = new Error('Transfer reason is mandatory');
    error.code = 'REASON_REQUIRED';
    error.status = 400;
    throw error;
  }

  return executeWithOptionalTransaction(async (session) => {
    const opts = session ? { session } : {};

    const oldAllocQuery = RoomAllocation.findById(allocation_id);
    if (session) oldAllocQuery.session(session);
    const oldAllocation = await oldAllocQuery;

    if (!oldAllocation || oldAllocation.status !== 'active') {
      const error = new Error('Active room allocation not found');
      error.code = 'ALLOCATION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (oldAllocation.room_id.toString() === new_room_id.toString()) {
      const error = new Error('Student is already allocated to this room');
      error.code = 'SAME_ROOM_TRANSFER';
      error.status = 400;
      throw error;
    }

    const newRoomQuery = HostelRoom.findById(new_room_id).populate('hostel_id', 'code');
    if (session) newRoomQuery.session(session);
    const newRoom = await newRoomQuery;

    if (!newRoom) {
      const error = new Error('Target room not found');
      error.code = 'ROOM_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (newRoom.status === 'maintenance' || newRoom.status === 'blocked') {
      const error = new Error(`Target room is in ${newRoom.status} status`);
      error.code = 'ROOM_UNAVAILABLE';
      error.status = 400;
      throw error;
    }

    const countQuery = RoomAllocation.countDocuments({
      room_id: new_room_id,
      status: 'active',
    });
    if (session) countQuery.session(session);
    const targetActiveCount = await countQuery;

    if (targetActiveCount >= newRoom.capacity) {
      const error = new Error(`Target room ${newRoom.room_number} is full`);
      error.code = 'ROOM_FULL';
      error.status = 400;
      throw error;
    }

    const student = await User.findById(oldAllocation.student_id, null, opts);
    const oldRoomId = oldAllocation.room_id;

    // 1. Close old allocation
    oldAllocation.status = 'transferred';
    oldAllocation.vacated_on = new Date();
    oldAllocation.remarks = `${oldAllocation.remarks || ''} [Transferred: ${reason}]`.trim();
    await oldAllocation.save(opts);

    // 2. Open new allocation
    const newAllocation = new RoomAllocation({
      student_id: oldAllocation.student_id,
      room_id: new_room_id,
      bed_number,
      allocated_on: new Date(),
      status: 'active',
      allocated_by: actor_id,
      remarks: `Transferred: ${reason}`,
      source: 'transfer',
    });
    await newAllocation.save(opts);

    // 3. Update student user record
    if (student) {
      student.roomNo = newRoom.room_number;
      if (newRoom.hostel_id && newRoom.hostel_id.code) {
        student.hostel = newRoom.hostel_id.code;
      }
      await student.save(opts);
    }

    // 4. Update room status of old room
    const oldCountQuery = RoomAllocation.countDocuments({
      room_id: oldRoomId,
      status: 'active',
    });
    if (session) oldCountQuery.session(session);
    const oldRoomActiveCount = await oldCountQuery;

    const oldRoom = await HostelRoom.findById(oldRoomId, null, opts);
    if (oldRoom && oldRoom.status !== 'maintenance' && oldRoom.status !== 'blocked') {
      oldRoom.status = oldRoomActiveCount === 0 ? 'available' : 'occupied';
      await oldRoom.save(opts);
    }

    // 5. Update room status of new room
    const newCount = targetActiveCount + 1;
    newRoom.status = newCount >= newRoom.capacity ? 'full' : 'occupied';
    await newRoom.save(opts);

    // 6. Record audit entry
    await RoomAllocationAudit.create(
      [
        {
          allocation_id: newAllocation._id,
          student_id: oldAllocation.student_id,
          action: 'TRANSFER',
          old_room_id: oldRoomId,
          new_room_id: new_room_id,
          actor_id,
          actor_role,
          reason,
          details: { old_allocation_id: oldAllocation._id, bed_number },
        },
      ],
      opts
    );

    return newAllocation;
  });
}

/**
 * Vacate a student from a room
 */
async function vacateStudent({
  allocation_id,
  reason,
  vacated_on = null,
  actor_id = null,
  actor_role = 'warden',
}) {
  if (!reason || !reason.trim()) {
    const error = new Error('Vacate reason is mandatory');
    error.code = 'REASON_REQUIRED';
    error.status = 400;
    throw error;
  }

  return executeWithOptionalTransaction(async (session) => {
    const opts = session ? { session } : {};

    const allocQuery = RoomAllocation.findById(allocation_id);
    if (session) allocQuery.session(session);
    const allocation = await allocQuery;

    if (!allocation || allocation.status !== 'active') {
      const error = new Error('Active room allocation not found');
      error.code = 'ALLOCATION_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    const roomId = allocation.room_id;
    const student = await User.findById(allocation.student_id, null, opts);

    // Close allocation
    allocation.status = 'vacated';
    allocation.vacated_on = vacated_on ? new Date(vacated_on) : new Date();
    allocation.remarks = `${allocation.remarks || ''} [Vacated: ${reason}]`.trim();
    await allocation.save(opts);

    // Clear roomNo on student
    if (student) {
      student.roomNo = '';
      await student.save(opts);
    }

    // Update room status
    const remainingCountQuery = RoomAllocation.countDocuments({
      room_id: roomId,
      status: 'active',
    });
    if (session) remainingCountQuery.session(session);
    const remainingCount = await remainingCountQuery;

    const room = await HostelRoom.findById(roomId, null, opts);
    if (room && room.status !== 'maintenance' && room.status !== 'blocked') {
      room.status = remainingCount === 0 ? 'available' : 'occupied';
      await room.save(opts);
    }

    // Record audit
    await RoomAllocationAudit.create(
      [
        {
          allocation_id: allocation._id,
          student_id: allocation.student_id,
          action: 'VACATE',
          old_room_id: roomId,
          actor_id,
          actor_role,
          reason,
          details: { vacated_on: allocation.vacated_on },
        },
      ],
      opts
    );

    return allocation;
  });
}


/**
 * Get a student's current room allocation and roommates (names and roll numbers only)
 */
async function getStudentAllocation(studentId) {
  const allocation = await RoomAllocation.findOne({
    student_id: studentId,
    status: 'active',
  })
    .populate('room_id')
    .populate({
      path: 'room_id',
      populate: [
        { path: 'hostel_id', select: 'code name type' },
        { path: 'floor_id', select: 'floor_number label' },
      ],
    })
    .lean();

  if (!allocation) {
    return { allocated: false, allocation: null, roommates: [] };
  }

  // Get roommates in the same room (hide private phone/email details)
  const roomId = allocation.room_id._id;
  const roommateAllocations = await RoomAllocation.find({
    room_id: roomId,
    status: 'active',
    student_id: { $ne: studentId },
  })
    .populate('student_id', 'name rollNo')
    .lean();

  const roommates = roommateAllocations.map((ra) => ({
    name: ra.student_id?.name || 'Unknown',
    rollNo: ra.student_id?.rollNo || '',
    bed_number: ra.bed_number,
    allocated_on: ra.allocated_on,
  }));

  return {
    allocated: true,
    allocation,
    roommates,
  };
}

/**
 * Search allocations by student name or roll number, with floor/hostel filters
 */
async function searchAllocations({ search = '', floorId = null, hostelId = null, status = 'active' }) {
  const query = {};
  if (status) query.status = status;

  if (search && search.trim()) {
    const userMatches = await User.find({
      role: 'student',
      $or: [
        { name: { $regex: search.trim(), $options: 'i' } },
        { rollNo: { $regex: search.trim(), $options: 'i' } },
      ],
    })
      .select('_id')
      .lean();

    const userIds = userMatches.map((u) => u._id);
    query.student_id = { $in: userIds };
  }

  let allocations = await RoomAllocation.find(query)
    .populate('student_id', 'name rollNo phone email')
    .populate({
      path: 'room_id',
      populate: [
        { path: 'hostel_id', select: 'code name' },
        { path: 'floor_id', select: 'floor_number label' },
      ],
    })
    .sort({ allocated_on: -1 })
    .limit(200)
    .lean();

  if (floorId) {
    allocations = allocations.filter((a) => a.room_id?.floor_id?._id?.toString() === floorId.toString());
  }
  if (hostelId) {
    allocations = allocations.filter((a) => a.room_id?.hostel_id?._id?.toString() === hostelId.toString());
  }

  return allocations;
}

/**
 * Export allocations to CSV string
 */
async function exportAllocationsCsv(hostelId = null) {
  const query = { status: 'active' };

  let allocations = await RoomAllocation.find(query)
    .populate('student_id', 'name rollNo phone')
    .populate({
      path: 'room_id',
      populate: [
        { path: 'hostel_id', select: 'code name' },
        { path: 'floor_id', select: 'floor_number label' },
      ],
    })
    .sort({ 'room_id.room_number': 1 })
    .lean();

  if (hostelId) {
    allocations = allocations.filter((a) => a.room_id?.hostel_id?._id?.toString() === hostelId.toString());
  }

  const rows = [
    ['Hostel', 'Floor', 'Room Number', 'Capacity', 'Student Name', 'Roll / MIS No', 'Bed Number', 'Allocated On', 'Source'],
  ];

  for (const a of allocations) {
    rows.push([
      a.room_id?.hostel_id?.code || 'N/A',
      a.room_id?.floor_id?.label || 'N/A',
      a.room_id?.room_number || 'N/A',
      a.room_id?.capacity || 4,
      `"${(a.student_id?.name || '').replace(/"/g, '""')}"`,
      a.student_id?.rollNo || 'N/A',
      a.bed_number || '',
      a.allocated_on ? new Date(a.allocated_on).toISOString().split('T')[0] : '',
      a.source || 'manual',
    ]);
  }

  return rows.map((r) => r.join(',')).join('\n');
}

module.exports = {
  getHostels,
  getFloorsByHostel,
  getRoomsByFloor,
  getRoomDetails,
  createRoom,
  updateRoom,
  allocateStudent,
  transferStudent,
  vacateStudent,
  getStudentAllocation,
  searchAllocations,
  exportAllocationsCsv,
};
