/**
 * Script: removeExistingStudents.js
 * Removes all pre-seeded / placeholder students from the students directory,
 * resets room allocation occupancy back to empty/vacant, and clears test student data.
 * Does NOT touch warden, admin, or security accounts.
 *
 * Future students will be automatically created and populated into the directory
 * when they register with their institutional Google Gmail accounts.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function removeExistingStudents() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  console.log(`🔌 Connecting to database: ${uri}`);

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB\n');

  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const RoomAllocation = mongoose.model('RoomAllocation', new mongoose.Schema({}, { strict: false }));
  const HostelRoom = mongoose.model('HostelRoom', new mongoose.Schema({}, { strict: false }));
  const StudentDevice = mongoose.model('StudentDevice', new mongoose.Schema({}, { strict: false }));
  const InOutLog = mongoose.model('InOutLog', new mongoose.Schema({}, { strict: false }));
  const AttendanceRecord = mongoose.model('AttendanceRecord', new mongoose.Schema({}, { strict: false }));

  // 1. Find all student accounts
  const studentCount = await User.countDocuments({ role: 'student' });
  console.log(`📋 Found ${studentCount} student account(s) currently in the database.`);

  const staffCount = await User.countDocuments({ role: { $in: ['warden', 'admin', 'security'] } });
  console.log(`🛡️ Staff/Admin/Security accounts preserved: ${staffCount}`);

  if (studentCount > 0) {
    // Delete students
    const deleteResult = await User.deleteMany({ role: 'student' });
    console.log(`🗑️ Deleted ${deleteResult.deletedCount} student accounts from User collection.`);

    // Delete room allocations
    const allocResult = await RoomAllocation.deleteMany({});
    console.log(`🗑️ Cleared ${allocResult.deletedCount} student room allocation records.`);

    // Reset all hostel room occupant counts to 0 and vacantBeds to capacity
    const rooms = await HostelRoom.find({}).lean();
    for (const r of rooms) {
      await HostelRoom.updateOne(
        { _id: r._id },
        { $set: { occupantsCount: 0, vacantBeds: r.capacity || 2 } }
      );
    }
    console.log(`🏢 Reset occupancy for ${rooms.length} hostel rooms (all vacant, ready for newly registering students).`);

    // Clean up devices, logs, records for old test students
    const devResult = await StudentDevice.deleteMany({});
    console.log(`📱 Cleared ${devResult.deletedCount} student device registration(s).`);

    const attResult = await AttendanceRecord.deleteMany({});
    console.log(`📝 Cleared ${attResult.deletedCount} old attendance record(s).`);

    const logResult = await InOutLog.deleteMany({ role: 'student' });
    console.log(`🚪 Cleared ${logResult.deletedCount} old student gate logs.`);
  } else {
    console.log('ℹ️ No student accounts found to remove.');
  }

  console.log('\n✨ Student directory is now clean. Newly registered Google Gmail students will be automatically populated upon login and onboarding.');

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

removeExistingStudents()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error removing students:', err);
    process.exit(1);
  });
