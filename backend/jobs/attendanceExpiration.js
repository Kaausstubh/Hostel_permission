const cron = require('node-cron');
const { finalizeExpiredNightAttendance } = require('../services/nightAttendanceService');
const logger = require('../utils/logger');

// Runs independently of student browsers.  The endpoint-level expiry checks
// remain in place as a safety net for restarts or a delayed cron tick.
const scheduleAttendanceExpiration = () => {
  cron.schedule('* * * * *', () => {
    finalizeExpiredNightAttendance().catch((err) =>
      logger.error('[NightAttendance] Expiry scheduler failed', { error: err.message })
    );
  });

  logger.info('[NightAttendance] Expiry scheduler active (every minute)');
};

module.exports = { scheduleAttendanceExpiration };
