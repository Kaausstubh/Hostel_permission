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
  // Exclude students on approved Home Visits (multi-day leaves with parent consent)
  const HomeVisitLog = require('../models/HomeVisitLog');
  const activeHomeVisits = await HomeVisitLog.find({
    overall_status: { $in: ['approved', 'completed'] },
    leave_date: { $lte: today },
    return_date: { $gte: today },
  }).distinct('student_id');

  const filter = {
    status: 'OUT',
    returned: false,
    date: today,
    alertSent: false,
  };

  if (activeHomeVisits && activeHomeVisits.length > 0) {
    filter.student_id = { $nin: activeHomeVisits };
  }

  const logs = await InOutLog.find(filter)
    .populate('student_id', 'name phone rollNo hostel parentPhone')
    .lean();

  console.log(`   Found ${logs.length} student(s) not returned past 8:00 PM curfew.`);

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
          body: `🚨 *HOSTEL CURFEW ALERT*\n\nYou have *not returned* to the hostel before the 8:00 PM curfew.\nYou checked OUT at ${exitTime}.\n\nPlease report to the hostel gate immediately or contact the warden.\n\n_This is an automated alert from HEIMDALL System._`,
        });
      }

      // ── Alert to WARDEN(s) ────────────────────────────────────────────────
      for (const warden of wardens) {
        if (!warden.phone) continue;
        await enqueueWhatsAppMessage({
          to: warden.phone,
          body: `🚨 *CURFEW BREACH (8:00 PM) — Action Required*\n\nStudent: *${student.name}*\nRoll No: ${student.rollNo || 'N/A'}\nHostel: ${student.hostel || 'N/A'}\nExit Time: ${exitTime}\n\nThis student checked OUT at ${exitTime} and has *NOT returned* before the 8:00 PM curfew.\n\nPlease take necessary action.`,
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
 * Curfew is 8:00 PM IST.
 * Primary: 8:05 PM IST ("5 20 * * *")
 * Secondary final sweep: 11:59 PM IST ("59 23 * * *")
 */
const scheduleNotReturnedAlert = () => {
  // 1. Post-Curfew Alert: 8:05 PM IST
  cron.schedule('5 20 * * *', async () => {
    try {
      console.log('⏰ Running 8:05 PM Post-Curfew Alert check...');
      await runNotReturnedAlert();
    } catch (error) {
      console.error('❌ 8:05 PM Curfew alert failed:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  // 2. Midnight Final Check: 11:59 PM IST
  cron.schedule('59 23 * * *', async () => {
    try {
      await runNotReturnedAlert();
    } catch (error) {
      console.error('❌ Midnight alert failed:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });

  console.log('⏰ Not-returned alert cron jobs scheduled for 8:05 PM & 11:59 PM IST');
};

module.exports = { scheduleNotReturnedAlert, runNotReturnedAlert };
