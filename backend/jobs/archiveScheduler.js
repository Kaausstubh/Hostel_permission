/**
 * Monthly Archive Scheduler
 * Runs once a month (default: 1st day of month at 02:00 AM) to automatically enqueue
 * historical archival jobs for MongoDB collections older than ARCHIVE_RETENTION_MONTHS.
 *
 * Config:
 *  - ARCHIVE_ENABLED=true
 *  - ARCHIVE_CRON=0 2 1 * *
 *  - ARCHIVE_RETENTION_MONTHS=3
 *
 * TIMEZONE DOCUMENTATION:
 *  - The scheduler evaluates CRON expressions using node-cron against the server system timezone.
 *  - In production Docker / Cloud deployments (Render / AWS / Railway), the system clock runs in UTC.
 *  - E.g., `0 2 1 * *` in UTC executes at 02:00 AM UTC (7:30 AM IST) on the 1st of every month.
 *  - If campus operations require exact IST execution, configure timezone: 'Asia/Kolkata' in node-cron.
 */

const cron = require('node-cron');
const { enqueueArchiveJob } = require('../queues/archiveQueue');
const { getEligibleArchiveMonths } = require('../services/archiveService');
const logger = require('../utils/logger');

const ARCHIVE_CRON = process.env.ARCHIVE_CRON || '0 2 1 * *';
const RETENTION_MONTHS = parseInt(process.env.ARCHIVE_RETENTION_MONTHS || '3', 10);
const ARCHIVE_ENABLED = (process.env.ARCHIVE_ENABLED ?? 'true') !== 'false';

const TARGET_COLLECTIONS = ['InOutLog', 'HomeVisitLog', 'Complaint'];

const runMonthlyArchivalTrigger = async () => {
  if (!ARCHIVE_ENABLED) {
    logger.info('[Archive Scheduler] Archiving is disabled via ARCHIVE_ENABLED=false');
    return;
  }

  logger.info('[Archive Scheduler] Running monthly archival scan...', { retentionMonths: RETENTION_MONTHS });

  const eligibleMonths = getEligibleArchiveMonths(RETENTION_MONTHS);
  let totalEnqueued = 0;

  for (const yearMonthStr of eligibleMonths) {
    for (const collectionName of TARGET_COLLECTIONS) {
      try {
        await enqueueArchiveJob({ collectionName, yearMonthStr });
        totalEnqueued += 1;
      } catch (err) {
        logger.error('[Archive Scheduler] Failed to enqueue archive job', {
          collectionName,
          yearMonthStr,
          error: err.message,
        });
      }
    }
  }

  logger.info(`[Archive Scheduler] Completed monthly scan. Enqueued ${totalEnqueued} archive job(s).`);
  return { totalEnqueued, eligibleMonths };
};

const scheduleArchiveJob = () => {
  if (!ARCHIVE_ENABLED) {
    logger.info('📅 Archive scheduler DISABLED via ARCHIVE_ENABLED=false');
    return;
  }

  const timezone = process.env.TZ || 'UTC';
  cron.schedule(
    ARCHIVE_CRON,
    () => {
      runMonthlyArchivalTrigger().catch((err) =>
        logger.error('[Archive Scheduler] Scheduled run failed:', { error: err.message })
      );
    },
    { timezone }
  );

  logger.info(`📅 Monthly Archive Scheduler active (cron: "${ARCHIVE_CRON}", tz: "${timezone}", retention: ${RETENTION_MONTHS}m)`);
};

module.exports = {
  runMonthlyArchivalTrigger,
  scheduleArchiveJob,
};
