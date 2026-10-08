/**
 * Attendance Module Demo Seed Script
 * Creates sample geofences, rooms, students, devices, and a sample active round for testing.
 * Usage: node scripts/seedAttendanceDemo.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const HostelGeofence = require('../models/HostelGeofence');
const StudentDevice = require('../models/StudentDevice');
const AttendanceRound = require('../models/AttendanceRound');
const RoomAttendanceRequest = require('../models/RoomAttendanceRequest');
const RequestResponse = require('../models/RequestResponse');
const AttendanceRecord = require('../models/AttendanceRecord');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/heimdall';

// IIIT Pune Campus coordinates for BH1
const BH1_POLYGON = [
  { lat: 18.53050, lng: 73.85600 },
  { lat: 18.53150, lng: 73.85600 },
  { lat: 18.53150, lng: 73.85720 },
  { lat: 18.53050, lng: 73.85720 },
];

async function seed() {
  console.log('🌱 Connecting to database for attendance seed...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  // 1. Seed BH1 Geofence
  console.log('📍 Seeding Hostel Geofences...');
  await HostelGeofence.findOneAndUpdate(
    { hostel: 'BH1' },
    {
      hostel: 'BH1',
      name: 'Boys Hostel 1 Campus Perimeter',
      active: true,
      buffer_m: 25,
      accuracy_threshold_m: 50,
      polygon: BH1_POLYGON,
    },
    { upsert: true, new: true }
  );

  await HostelGeofence.findOneAndUpdate(
    { hostel: 'BH2' },
    {
      hostel: 'BH2',
      name: 'Boys Hostel 2 Campus Perimeter',
      active: true,
      buffer_m: 25,
      accuracy_threshold_m: 50,
      polygon: BH1_POLYGON,
    },
    { upsert: true, new: true }
  );

  await HostelGeofence.findOneAndUpdate(
    { hostel: 'GH' },
    {
      hostel: 'GH',
      name: 'Girls Hostel Campus Perimeter',
      active: true,
      buffer_m: 25,
      accuracy_threshold_m: 50,
      polygon: BH1_POLYGON,
    },
    { upsert: true, new: true }
  );
  console.log('✅ Geofences configured for BH1, BH2, GH');

  // 2. Find or Create Staff User (warden)
  let staff = await User.findOne({ role: 'warden' });
  if (!staff) {
    staff = await User.create({
      name: 'Hostel Warden',
      email: 'warden@iiitp.ac.in',
      role: 'warden',
      hostel: 'BH1',
      isActive: true,
    });
    console.log('✅ Created demo staff warden account');
  }

  // 3. Seed Sample Students in BH1 Floor 2 (Rooms 201, 202, 203)
  console.log('👥 Seeding demo students in BH1 Floor 2...');
  const demoStudents = [
    { name: 'Arjun Verma', rollNo: 'CS22B1001', roomNo: '201', email: 'arjun@iiitp.ac.in' },
    { name: 'Rohan Gupta', rollNo: 'CS22B1002', roomNo: '201', email: 'rohan@iiitp.ac.in' },
    { name: 'Sameer Joshi', rollNo: 'CS22B1003', roomNo: '202', email: 'sameer@iiitp.ac.in' },
    { name: 'Kavita Patel', rollNo: 'CS22B1004', roomNo: '202', email: 'kavita@iiitp.ac.in' },
    { name: 'Dev Sharma', rollNo: 'CS22B1005', roomNo: '203', email: 'dev@iiitp.ac.in' },
  ];

  for (const st of demoStudents) {
    let studentDoc = await User.findOne({ email: st.email });
    if (!studentDoc) {
      studentDoc = await User.create({
        name: st.name,
        rollNo: st.rollNo,
        email: st.email,
        role: 'student',
        hostel: 'BH1',
        roomNo: st.roomNo,
        phone: '9876543210',
        parentPhone: '9876543211',
        isActive: true,
      });
    }

    // Seed Enrolled Biometric Device
    await StudentDevice.findOneAndUpdate(
      { student_id: studentDoc._id },
      {
        student_id: studentDoc._id,
        device_id: `device_hw_${st.rollNo}`,
        device_model: 'Google Pixel 7 (Platform Authenticator)',
        credential_id: `cred_sample_${st.rollNo}`,
        public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0',
        algorithm: 'ES256',
        consent_given: true,
        consent_timestamp: new Date(),
        approved_by: staff._id,
        approved_at: new Date(),
        active: true,
      },
      { upsert: true, new: true }
    );
  }
  console.log('✅ Demo students and biometric devices enrolled');

  console.log('\n🎉 Attendance Module demo seed data populated successfully!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
