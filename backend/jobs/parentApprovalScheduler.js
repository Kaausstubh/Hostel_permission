/**
 * Parent Approval Scheduler Cron Job
 * Multi-instance safe background scheduler for home-visit parent approval expiry and reminders.
 * Runs every 15 minutes.
 *
 * Multi-Instance Safety:
 * 1. Redis distributed lock (NX EX 180s) ensures only one server node executes the cycle.
 * 2. In-memory guard fallback if Redis is unavailable.
 * 3. Atomic document queries/updates prevent duplicate notifications or state corruption.
 * 4. Strictly ignores legacy records (parent_approval_status === 'legacy').
 */

const cron = require('node-cron');
const HomeVisitLog = require('../models/HomeVisitLog');
const Guardian = require('../models/Guardian');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const { sendLeaveReminderEmail } = require('../services/mailService');
const { getRedis } = require('../services/redisClient');
const logger = require('../utils/logger');

let localRunning = false;

const runParentApprovalCycle = async () => {
  if (localRunning) return { skipped: true, reason: 'Already running locally' };
  localRunning = true;

  const redis = await getRedis();
  const lockKey = 'lock:scheduler:parent_approval';
  let hasRedisLock = false;

  if (redis) {
    try {
      const acquired = await redis.set(lockKey, '1', { NX: true, EX: 120 });
      if (!acquired) {
        localRunning = false;
        return { skipped: true, reason: 'Acquired by another instance' };
      }
      hasRedisLock = true;
    } catch (err) {
      logger.warn('[Scheduler] Redis lock failed, falling back to local lock', { error: err.message });
    }
  }

  try {
    const now = new Date();
    const expiryHours = parseInt(process.env.PARENT_APPROVAL_EXPIRY_HOURS || '24', 10);
    const expiryThreshold = new Date(now.getTime() - expiryHours * 60 * 60 * 1000);
    const reminderThreshold = new Date(now.getTime() - (expiryHours / 2) * 60 * 60 * 1000);
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    let expiredCount = 0;
    let reminderCount = 0;

    // ── 1. Process Expired Requests ───────────────────────────────────────────
    // Query only 'pending' requests (strictly exempts 'legacy' records)
    const expiredCandidates = await HomeVisitLog.find({
      parent_approval_status: 'pending',
      $or: [
        { createdAt: { $lte: expiryThreshold } },
        { leave_date: { $lte: todayStr } },
      ],
    }).limit(100);

    for (const visit of expiredCandidates) {
      // Atomic claim
      const updated = await HomeVisitLog.findOneAndUpdate(
        { _id: visit._id, parent_approval_status: 'pending' },
        {
          $set: {
            parent_approval_status: 'parent_no_response',
            overall_status: 'parent_no_response',
          },
        },
        { new: true }
      );

      if (updated) {
        expiredCount++;
        await ApprovalAuditLog.create({
          event: 'EXPIRED',
          home_visit_request_id: visit._id,
          student_id: visit.student_id,
          actor_role: 'system',
          details: {
            reason: visit.leave_date <= todayStr ? 'Reached leave departure date' : `Exceeded ${expiryHours}h response window`,
          },
        });
        logger.info(`[Scheduler] Request ${visit._id} marked parent_no_response`);
      }
    }

    // ── 2. Process Midpoint Reminders (50% window) ───────────────────────────
    const reminderCandidates = await HomeVisitLog.find({
      parent_approval_status: 'pending',
      parent_reminder_sent: false,
      createdAt: { $lte: reminderThreshold, $gt: expiryThreshold },
      leave_date: { $gt: todayStr },
    })
      .populate('student_id', 'name')
      .limit(50);

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    for (const visit of reminderCandidates) {
      // Atomic claim so reminder is sent once
      const claimed = await HomeVisitLog.findOneAndUpdate(
        { _id: visit._id, parent_reminder_sent: false, parent_approval_status: 'pending' },
        { $set: { parent_reminder_sent: true } },
        { new: true }
      );

      if (!claimed) continue;

      const studentId = visit.student_id?._id || visit.student_id;
      const guardians = await Guardian.find({ student_id: studentId, status: { $ne: 'REVOKED' } });
      const requestUrl = `${baseUrl}/parent/requests/${visit._id}`;
      const hoursLeft = Math.max(1, Math.round((new Date(visit.createdAt).getTime() + expiryHours * 3600000 - now.getTime()) / 3600000));

      for (const guardian of guardians) {
        sendLeaveReminderEmail({
          to: guardian.email,
          guardianName: guardian.name,
          studentName: visit.student_id?.name || visit.name,
          leaveDate: visit.leave_date,
          returnDate: visit.return_date,
          reason: visit.reason,
          requestUrl,
          hoursLeft,
        }).catch((err) => logger.warn(`[Scheduler] Reminder email failed for ${guardian.email}: ${err.message}`));

        await ApprovalAuditLog.create({
          event: 'REMINDER_SENT',
          home_visit_request_id: visit._id,
          student_id: studentId,
          guardian_id: guardian._id,
          actor_role: 'system',
          actor_email: guardian.email,
          details: { hoursLeft },
        });
      }
      reminderCount++;
    }

    return { processed: true, expiredCount, reminderCount };
  } catch (error) {
    logger.error('[Scheduler] Error running parent approval cycle', { error: error.message });
    return { error: error.message };
  } finally {
    localRunning = false;
    if (hasRedisLock && redis) {
      redis.del(lockKey).catch(() => {});
    }
  }
};

const scheduleParentApprovalJob = () => {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('[Scheduler] Running parent approval expiry & reminder check...');
    await runParentApprovalCycle();
  });
  logger.info('⏰ Parent Approval Scheduler scheduled (every 15m).');
};

module.exports = {
  scheduleParentApprovalJob,
  runParentApprovalCycle,
};
