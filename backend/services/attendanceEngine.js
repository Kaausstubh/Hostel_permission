/**
 * Attendance Engine
 *
 * Provides the background infrastructure for Floor Attendance:
 * 1. Startup State Rehydration:
 *    - Leaves active open requests with a future expires_at valid.
 *    - Expires any open requests whose expires_at has passed and marks non-responding students as timeout.
 *    - Marks stale rounds from prior days as expired.
 * 2. High-Frequency Expiry Worker:
 *    - Runs every 3 seconds to check for expired open RoomAttendanceRequests.
 *    - Marks expired requests as 'expired' and pending student responses as 'timeout'.
 *    - Emits real-time Socket.IO notifications to staff dashboards and affected students.
 * 3. Idempotent Bootstrap:
 *    - Safe against hot-reloads and multiple calls.
 *    - Does NOT start an attendance round or session — only staff can start a session.
 *    - If ATTENDANCE_MODULE_ENABLED is false, no worker starts.
 */

const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRound = require('../models/AttendanceRound');
const { getIO } = require('./socketService');
const logger = require('../utils/logger');

let expiryTimer = null;
let isEngineRunning = false;

const getTodayDateStr = () => {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
};

/**
 * Rehydrate attendance state on startup or worker tick.
 * Closes expired requests and flags non-responders as timeout.
 */
const rehydrateAttendanceState = async (now = new Date()) => {
  try {
    const today = getTodayDateStr();

    // 1. Find all open requests whose expires_at has elapsed
    const expiredRequests = await RoomAttendanceRequest.find({
      status: 'open',
      expires_at: { $lte: now },
    });

    if (expiredRequests.length > 0) {
      for (const req of expiredRequests) {
        req.status = 'expired';
        await req.save();

        // Mark any student still pending on this request as timeout
        const updatedResponses = await RequestResponse.updateMany(
          {
            request_id: req._id,
            status: 'pending',
          },
          {
            $set: {
              status: 'timeout',
              remark: 'Request expired without student verification',
            },
          }
        );

        const io = getIO();
        if (io) {
          const payload = {
            requestId: req._id,
            roundId: req.round_id,
            roomNo: req.roomNo,
            hostel: req.hostel,
            status: 'timeout',
            expired: true,
            timestamp: now.toISOString(),
          };

          io.of('/dashboard').emit('room_attendance_updated', payload);
          io.of('/dashboard').emit('attendance_request_expired', payload);
          io.emit('room_attendance_updated', payload);
        }

        logger.info(`[AttendanceEngine] Expired request ${req._id} for room ${req.roomNo} (${updatedResponses.modifiedCount} students timed out)`);
      }
    }

    // 2. Mark stale rounds from prior days as expired
    await AttendanceRound.updateMany(
      {
        status: 'active',
        date: { $ne: today },
      },
      {
        $set: {
          status: 'expired',
          completed_at: now,
          completed_summary: { reason: 'Expired at end of day' },
        },
      }
    );
  } catch (err) {
    logger.error('[AttendanceEngine] Error during state rehydration:', { error: err.message });
  }
};

/**
 * Starts the background expiry worker running every 3 seconds.
 */
const startExpiryWorker = () => {
  if (expiryTimer) {
    clearInterval(expiryTimer);
  }

  expiryTimer = setInterval(async () => {
    await rehydrateAttendanceState(new Date());
  }, 3000);

  // Unref the timer so it doesn't prevent Node process exit during testing
  if (expiryTimer.unref) {
    expiryTimer.unref();
  }
};

/**
 * Bootstrap function called during server startup.
 * Fully idempotent and safe against multiple invocations.
 */
const bootstrapAttendanceEngine = async () => {
  if (process.env.ATTENDANCE_MODULE_ENABLED === 'false') {
    logger.info('[AttendanceEngine] ATTENDANCE_MODULE_ENABLED is false — attendance engine skipped');
    return { enabled: false, running: false };
  }

  if (isEngineRunning) {
    logger.info('[AttendanceEngine] Attendance engine already running (idempotent skip)');
    return { enabled: true, running: true };
  }

  try {
    // 1. Initial State Rehydration
    await rehydrateAttendanceState(new Date());

    // 2. Start Expiry Worker
    startExpiryWorker();

    isEngineRunning = true;
    logger.info('Attendance engine started: routes registered, worker running');

    return { enabled: true, running: true };
  } catch (err) {
    logger.error('[AttendanceEngine] Failed to start attendance engine:', { error: err.message });
    return { enabled: true, running: false, error: err.message };
  }
};

/**
 * Stop engine worker (useful for tests or graceful shutdown)
 */
const stopAttendanceEngine = () => {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
  isEngineRunning = false;
  logger.info('[AttendanceEngine] Attendance engine worker stopped');
};

module.exports = {
  bootstrapAttendanceEngine,
  stopAttendanceEngine,
  rehydrateAttendanceState,
  isEngineRunning: () => isEngineRunning,
};
