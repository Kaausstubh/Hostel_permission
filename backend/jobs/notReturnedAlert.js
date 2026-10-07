/**
 * Not Returned Alert Cron Job
 * Runs daily at 11:59 PM.
 * Finds all students who scanned OUT but never returned (no IN scan).
 * Sends WhatsApp alerts to student and warden.
 */

const cron = require('node-cron');
const InOutLog = require('../models/InOutLog');
const User = require('../models/User');
const { enqueueWhatsAppMessage } = require('../queues/whatsappQueue');

/**
 * Core alert logic — also exported for manual testing via API.
 * @returns {Promise<{ processed: number, alerted: string[] }>}
 */
const runNotReturnedAlert = async () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  console.log(`\n🔔 [CRON] Running not-returned alert job for ${today}...`);

  // Find all OUT entries today with no return and alert not yet sent
  const logs = await InOutLog.find({
    status: 'OUT',
    returned: false,
    date: today,
    alertSent: false,
  }).populate('student_id', 'name phone rollNo hostel parentPhone').lean();

  console.log(`   Found ${logs.length} student(s) not returned.`);

  // Find warden(s) to notify
  const wardens = await User.find({ role: 'warden' }).select('phone name').lean();

  const alertedStudents = [];
  const processedLogIds = [];

  for (const log of logs) {
    const student = log.student_id;
    if (!student) continue;

    const exitTime = new Date(log.timestamp).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });

    try {
      // ── Alert to STUDENT ─────────────────────────────────────────────────
      if (student.phone) {
        await enqueueWhatsAppMessage({
          to: student.phone,
          body: `🚨 *HOSTEL ALERT*\n\nYou have *not returned* to the hostel today.\nYou checked OUT at ${exitTime}.\n\nPlease report to the hostel immediately or contact the warden.\n\n_This is an automated alert from HEIMDALL System._`,
        });
      }

      // ── Alert to WARDEN(s) ────────────────────────────────────────────────
      for (const warden of wardens) {
        if (!warden.phone) continue;
        await enqueueWhatsAppMessage({
          to: warden.phone,
          body: `🚨 *RETURN ALERT — Action Required*\n\nStudent: *${student.name}*\nRoll No: ${student.rollNo || 'N/A'}\nHostel: ${student.hostel || 'N/A'}\nExit Time: ${exitTime}\n\nThis student checked OUT at ${exitTime} and has *NOT returned* today.\n\nPlease take necessary action.`,
        });
      }

      // Collect log ID for bulk update
      processedLogIds.push(log._id);
      alertedStudents.push(student.name);
      console.log(`   ✅ Alert queued for student: ${student.name} (${student.phone || 'no phone'})`);
    } catch (err) {
      console.error(`   ❌ Failed to alert for ${student.name}: ${err.message}`);
    }
  }

  // Atomically update all processed logs in a single database operation
  if (processedLogIds.length > 0) {
    await InOutLog.updateMany(
      { _id: { $in: processedLogIds } },
      { $set: { alertSent: true } }
    );
  }

  console.log(`🔔 [CRON] Job complete. Alerted: [${alertedStudents.join(', ')}]\n`);

  return { processed: logs.length, alerted: alertedStudents };
};

/**
 * Schedule the cron job.
 * Cron expression: "59 23 * * *" = every day at 11:59 PM
 */
const scheduleNotReturnedAlert = () => {
  cron.schedule('59 23 * * *', async () => {
    try {
      await runNotReturnedAlert();
    } catch (error) {
      console.error('❌ Cron job failed:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata', // IST timezone
  });

  console.log('⏰ Not-returned alert cron job scheduled for 11:59 PM IST');
};

module.exports = { scheduleNotReturnedAlert, runNotReturnedAlert };
