require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const path = require('path');

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('DB connected');

  const AttendanceRound = require(path.join(__dirname, '../models/AttendanceRound'));
  const RoomAttendanceRequest = require(path.join(__dirname, '../models/RoomAttendanceRequest'));
  const RequestResponse = require(path.join(__dirname, '../models/RequestResponse'));
  const AttendanceRecord = require(path.join(__dirname, '../models/AttendanceRecord'));
  const AttendanceAttempt = require(path.join(__dirname, '../models/AttendanceAttempt'));
  const User = require(path.join(__dirname, '../models/User'));
  const RoomAllocation = require(path.join(__dirname, '../models/RoomAllocation'));
  const HostelRoom = require(path.join(__dirname, '../models/HostelRoom'));
  const Hostel = require(path.join(__dirname, '../models/Hostel'));

  const todayIST = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  console.log('Today IST:', todayIST);

  const wardens = await User.find({ role: 'warden' }).lean();
  const students = await User.find({ role: 'student' }).lean();
  console.log('Wardens:', wardens.length, '| Students:', students.length);

  students.slice(0, 5).forEach(s => {
    console.log('  Student:', s.name, '| hostel:', s.hostel, '| room:', s.roomNo, '| active:', s.isActive);
  });

  const hostels = await Hostel.find({}).lean();
  const rooms = await HostelRoom.find({}).lean();
  const allocs = await RoomAllocation.find({ status: 'active' }).lean();
  console.log('Hostels:', hostels.map(h => h.code).join(', ') || 'none');
  console.log('Rooms:', rooms.length, '| Active allocs:', allocs.length);

  const rounds = await AttendanceRound.find({ date: todayIST }).lean();
  const allRounds = await AttendanceRound.find({}).sort({ createdAt: -1 }).limit(5).lean();
  console.log('Rounds today:', rounds.length);
  rounds.forEach(r => console.log('  Round:', r.hostel, r.floor, r.status, 'window_end:', r.window_end));
  if (rounds.length === 0) {
    console.log('Recent rounds:');
    allRounds.forEach(r => console.log('  Round:', r.date, r.hostel, r.floor, r.status));
  }

  const now = new Date();
  const stuckOpen = await RoomAttendanceRequest.find({ status: 'open', expires_at: { $lt: now } }).lean();
  console.log('STUCK OPEN requests (engine bug?):', stuckOpen.length);

  const requests = await RoomAttendanceRequest.find({}).sort({ createdAt: -1 }).limit(5).lean();
  console.log('Recent requests:', requests.length);
  requests.forEach(r => console.log('  Req:', r.roomNo, r.hostel, r.status, 'expires:', r.expires_at));

  const responses = await RequestResponse.find({}).sort({ createdAt: -1 }).limit(10).lean();
  const sc = {};
  responses.forEach(r => { sc[r.status] = (sc[r.status] || 0) + 1; });
  console.log('RequestResponse statuses:', JSON.stringify(sc));

  const records = await AttendanceRecord.find({ date: todayIST }).lean();
  const rc = {};
  records.forEach(r => { rc[r.status] = (rc[r.status] || 0) + 1; });
  console.log('Records today:', records.length, JSON.stringify(rc));

  const attempts = await AttendanceAttempt.find({ date: todayIST }).lean();
  const ac = {};
  attempts.forEach(a => { ac[a.status] = (ac[a.status] || 0) + 1; });
  console.log('Attempts today:', attempts.length, JSON.stringify(ac));

  const noRoom = students.filter(s => s.hostel && !s.roomNo);
  console.log('Students with hostel but no roomNo:', noRoom.length);

  const orphanAttempts = await AttendanceAttempt.find({ round_id: null }).lean();
  console.log('Orphan attempts (no round_id):', orphanAttempts.length);

  await mongoose.disconnect();
  console.log('Audit complete.');
}

audit().catch(e => { console.error('AUDIT FAIL:', e.message); process.exit(1); });
