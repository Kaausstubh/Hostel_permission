/**
 * Server-authoritative lifecycle helpers for the two-hour night-attendance
 * window.  Attendance attempts are created when staff opens a round; students
 * can only act on an existing attempt document.
 */

const AttendanceAttempt = require('../models/AttendanceAttempt');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceRound = require('../models/AttendanceRound');
const User = require('../models/User');
const logger = require('../utils/logger');

const getIstDate = (date = new Date()) =>
  new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

const buildAbsentRecord = async (attempt, student, reason, now) => {
  const record = await AttendanceRecord.findOneAndUpdate(
    {
      student_id: attempt.student_id,
      date: attempt.date,
      session: attempt.session || 'Night Attendance',
    },
    {
      $setOnInsert: {
        student_id: attempt.student_id,
        date: attempt.date,
        session: attempt.session || 'Night Attendance',
        session_name: attempt.session || 'Night Attendance',
        hostel: attempt.hostel,
        floor: student?.roomNo ? String(student.roomNo).trim() : '',
        roomNo: student?.roomNo || 'Assigned',
        student_name: student?.name || '',
        student_rollNo: student?.rollNo || '',
        status: 'absent',
        method: 'self_approved',
        verified_by: null,
        attempt_count: attempt.attemptsCount || 0,
        verification_timestamp: now,
        remark: `Marked ABSENT: ${reason}`,
        round_id: attempt.round_id || null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return record;
};

/**
 * Finalize one pending window.  $setOnInsert on the ledger is intentional:
 * a staff-present mark or a successful GPS verification can never be
 * overwritten by a late expiry task.
 */
const finalizeExpiredAttempt = async (attemptId, now = new Date()) => {
  const attempt = await AttendanceAttempt.findOneAndUpdate(
    {
      _id: attemptId,
      status: { $in: ['pending', 'verifying'] },
      expires_at: { $lte: now },
    },
    {
      $set: {
        status: 'absent',
        finalizedAt: now,
        verification_started_at: null,
      },
    },
    { new: true }
  );

  if (!attempt) return null;

  const student = await User.findById(attempt.student_id).select('roomNo').lean();
  const reason = 'Attendance verification window expired (two hours elapsed)';
  const record = await buildAbsentRecord(attempt, student, reason, now);

  // A concurrent successful verification wins over expiry.  Keep the attempt
  // state aligned with the immutable ledger in that rare race.
  if (record.status === 'present') {
    await AttendanceAttempt.updateOne(
      { _id: attempt._id, status: 'absent' },
      { $set: { status: 'present', locationStatus: 'INSIDE HOSTEL' } }
    );
    return { attempt: { ...attempt.toObject(), status: 'present' }, record };
  }

  return { attempt, record };
};

/**
 * A durable fallback for unattended browser sessions.  Endpoint reads also
 * invoke finalization for the individual student, so correctness does not
 * depend solely on this in-process scheduler.
 */
const finalizeExpiredNightAttendance = async (now = new Date()) => {
  const candidates = await AttendanceAttempt.find({
    status: { $in: ['pending', 'verifying'] },
    expires_at: { $lte: now },
    round_id: { $ne: null },
  }).select('_id round_id').lean();

  let finalized = 0;

  for (const candidate of candidates) {
    const result = await finalizeExpiredAttempt(candidate._id, now);
    if (result) {
      finalized += 1;
    }
  }

  // Close every elapsed night round, even if its hostel had no eligible
  // students. Otherwise a later staff click could "resume" an expired empty
  // round and incorrectly expose its old verification window.
  await AttendanceRound.updateMany(
    {
      status: 'active',
      window_end: { $lte: now },
    },
    {
      $set: {
        status: 'completed',
        completed_at: now,
        completed_summary: {
          reason: 'Night attendance window expired',
          finalized_at: now,
        },
      },
    }
  );

  if (finalized) {
    logger.info('[NightAttendance] Finalized expired attendance attempts', { finalized });
  }

  return { finalized };
};

module.exports = {
  getIstDate,
  finalizeExpiredAttempt,
  finalizeExpiredNightAttendance,
};
