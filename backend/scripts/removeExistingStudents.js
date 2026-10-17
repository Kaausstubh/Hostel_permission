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

  const PendingRegistration = mongoose.model('PendingRegistration', new mongoose.Schema({}, { strict: false }));
  const Guardian = mongoose.model('Guardian', new mongoose.Schema({}, { strict: false }));
  const GuardianInvitation = mongoose.model('GuardianInvitation', new mongoose.Schema({}, { strict: false }));
  const HomeVisitLog = mongoose.model('HomeVisitLog', new mongoose.Schema({}, { strict: false }));
  const ParentApproval = mongoose.model('ParentApproval', new mongoose.Schema({}, { strict: false }));
  const ApprovalAuditLog = mongoose.model('ApprovalAuditLog', new mongoose.Schema({}, { strict: false }));

  // Delete students and parent users
  const deleteResult = await User.deleteMany({ role: { $in: ['student', 'parent'] } });
  console.log(`🗑️ Deleted ${deleteResult.deletedCount} student and parent accounts from User collection.`);

  // Clear pending registrations & guardian records
  const pendResult = await PendingRegistration.deleteMany({});
  console.log(`🗑️ Cleared ${pendResult.deletedCount} pending student registration(s).`);

  const guardResult = await Guardian.deleteMany({});
  console.log(`🗑️ Cleared ${guardResult.deletedCount} guardian record(s).`);

  const invResult = await GuardianInvitation.deleteMany({});
  console.log(`🗑️ Cleared ${invResult.deletedCount} guardian invitation(s).`);

  const hvResult = await HomeVisitLog.deleteMany({});
  console.log(`🗑️ Cleared ${hvResult.deletedCount} home visit log(s).`);

  const paResult = await ParentApproval.deleteMany({});
  console.log(`🗑️ Cleared ${paResult.deletedCount} parent approval(s).`);

  const alResult = await ApprovalAuditLog.deleteMany({});
  console.log(`🗑️ Cleared ${alResult.deletedCount} approval audit log(s).`);

  // Reset password on any staff accounts that had one set during parent testing
  await User.updateMany(
    { email: 'sjyotik2005@gmail.com' },
    { $set: { role: 'warden', passwordHash: null } }
  );

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

  console.log('\n✨ Database student and parent records are now completely reset and clean.');

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

removeExistingStudents()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error removing students:', err);
    process.exit(1);
  });
