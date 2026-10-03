/**
 * 5,000 Users Database Seeder
 * Seeds realistic campus data: 4,950 students, 30 security guards, 20 wardens,
 * plus thousands of historical gate logs, home visits, and complaints.
 */

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_replace_before_production_32ch';

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Aditya', 'Aishwarya', 'Akash', 'Ananya', 'Aniket', 'Anushka',
  'Aryan', 'Ayush', 'Bhavya', 'Chetan', 'Deepak', 'Devansh', 'Divya', 'Gaurav',
  'Harsh', 'Isha', 'Ishaan', 'Jatin', 'Kavya', 'Kunal', 'Manish', 'Meera',
  'Mohit', 'Neha', 'Nikhil', 'Pooja', 'Pranav', 'Priya', 'Rahul', 'Rhea',
  'Rishi', 'Rohan', 'Sakshi', 'Sameer', 'Sanya', 'Sarthak', 'Shivam', 'Shreya',
  'Siddharth', 'Sneha', 'Tanvi', 'Utkarsh', 'Vaibhav', 'Varun', 'Vidhi', 'Yash'
];

const LAST_NAMES = [
  'Agarwal', 'Bansal', 'Bhatia', 'Chauhan', 'Deshmukh', 'Gupta', 'Jain', 'Joshi',
  'Kapoor', 'Kumar', 'Mehta', 'Mishra', 'Nair', 'Patel', 'Patil', 'Pawar',
  'Rao', 'Reddy', 'Sharma', 'Shinde', 'Singh', 'Verma', 'Yadav'
];

const HOSTELS = ['BH1', 'BH2', 'GH'];
const DEPARTMENTS = ['CSE', 'ECE', 'DSAI', 'IT'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomDigits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

async function seed() {
  console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI);
  console.log('MongoDB connected.');

  const existingCount = await User.countDocuments();
  console.log(`Current users in DB: ${existingCount}`);

  const targetTotal = 5000;
  const toCreate = Math.max(0, targetTotal - existingCount);

  let allUsers = [];

  if (toCreate > 0) {
    console.log(`Creating ${toCreate} users in bulk...`);
    const usersToInsert = [];

    // 1. Guard users
    const guardCount = Math.min(30, toCreate);
    for (let i = 1; i <= guardCount; i++) {
      const fName = pick(FIRST_NAMES);
      const lName = pick(LAST_NAMES);
      usersToInsert.push({
        name: `Guard ${fName} ${lName}`,
        email: `guard${existingCount + i}@heimdall-security.ac.in`,
        oauthProvider: 'google',
        oauthId: `google_guard_${Date.now()}_${i}`,
        role: 'security',
        phone: `+9198${randomDigits(8)}`,
      });
    }

    // 2. Warden users
    const wardenCount = Math.min(20, Math.max(0, toCreate - guardCount));
    for (let i = 1; i <= wardenCount; i++) {
      const fName = pick(FIRST_NAMES);
      const lName = pick(LAST_NAMES);
      usersToInsert.push({
        name: `Dr. ${fName} ${lName}`,
        email: `warden${existingCount + i}@iiitp.ac.in`,
        oauthProvider: 'google',
        oauthId: `google_warden_${Date.now()}_${i}`,
        role: 'warden',
        hostel: HOSTELS[i % HOSTELS.length],
        phone: `+9199${randomDigits(8)}`,
      });
    }

    // 3. Students
    const studentCount = toCreate - guardCount - wardenCount;
    for (let i = 1; i <= studentCount; i++) {
      const fName = pick(FIRST_NAMES);
      const lName = pick(LAST_NAMES);
      const year = 2021 + (i % 4);
      const dept = DEPARTMENTS[i % DEPARTMENTS.length];
      const rollNo = `${year}${dept}${String(existingCount + guardCount + wardenCount + i).padStart(5, '0')}`;
      const hostel = HOSTELS[i % HOSTELS.length];
      const roomNo = `${hostel[0]}-${(i % 4) + 1}0${(i % 20) + 1}`;

      usersToInsert.push({
        name: `${fName} ${lName}`,
        email: `student_${existingCount + guardCount + wardenCount + i}_${Date.now()}@iiitp.ac.in`,
        oauthProvider: 'google',
        oauthId: `google_student_${Date.now()}_${existingCount + i}`,
        role: 'student',
        rollNo,
        hostel,
        roomNo,
        phone: `+91${pick(['98', '97', '99', '96'])}${randomDigits(8)}`,
        parentPhone: `+9191${randomDigits(8)}`,
        parentPhone2: `+9192${randomDigits(8)}`,
      });
    }

    // Insert in batches of 1000
    const batchSize = 1000;
    for (let b = 0; b < usersToInsert.length; b += batchSize) {
      const chunk = usersToInsert.slice(b, b + batchSize);
      await User.insertMany(chunk, { ordered: false });
      console.log(`Inserted batch ${b + chunk.length}/${usersToInsert.length}`);
    }
  }

  const finalUserCount = await User.countDocuments();
  console.log(`Total users in system now: ${finalUserCount}`);

  // Fetch sample users for testing and logs generation
  const students = await User.find({ role: 'student' }).limit(500).lean();
  const guards = await User.find({ role: 'security' }).limit(30).lean();
  const wardens = await User.find({ role: 'warden' }).limit(20).lean();

  console.log(`Available roles -> Students: ${students.length} (sample), Guards: ${guards.length}, Wardens: ${wardens.length}`);

  // Generate baseline historical records if needed
  const inOutCount = await InOutLog.countDocuments();
  if (inOutCount < 3000 && students.length > 0) {
    console.log('Seeding 3,000 historical Gate InOutLogs...');
    const inOutDocs = [];
    const today = new Date().toISOString().split('T')[0];

    for (let i = 0; i < 3000; i++) {
      const student = students[i % students.length];
      const guard = guards[i % guards.length] || { name: 'Gate Officer', _id: null };
      const daysAgo = Math.floor(Math.random() * 5);
      const d = new Date(Date.now() - daysAgo * 86400000);
      const dateStr = d.toISOString().split('T')[0];
      const isReturned = Math.random() > 0.15;
      const status = isReturned ? 'IN' : 'OUT';

      inOutDocs.push({
        student_id: student._id,
        name: student.name,
        rollNo: student.rollNo,
        email: student.email,
        phone: student.phone,
        parentPhone: student.parentPhone,
        hostel: student.hostel,
        qr_token: `token_seed_${i}_${Date.now()}_${Math.random()}`,
        status,
        returned: isReturned,
        out_time: new Date(d.getTime() - 3600000 * 2),
        in_time: isReturned ? d : null,
        timestamp: d,
        date: dateStr,
        scannedBy: guard._id,
        scanned_by_name: guard.name,
      });
    }
    await InOutLog.insertMany(inOutDocs, { ordered: false });
    console.log('Seeded 3,000 InOutLog records.');
  }

  // Seed Home Visits
  const homeCount = await HomeVisitLog.countDocuments();
  if (homeCount < 300 && students.length > 0) {
    console.log('Seeding 300 HomeVisitLog records...');
    const homeDocs = [];
    const statuses = ['pending', 'approved', 'completed', 'rejected'];

    for (let i = 0; i < 300; i++) {
      const student = students[i % students.length];
      const guard = guards[i % guards.length] || { name: 'Gate Officer', _id: null };
      const status = statuses[i % statuses.length];

      homeDocs.push({
        student_id: student._id,
        name: student.name,
        rollNo: student.rollNo,
        parent_phone: student.parentPhone,
        parent_call_confirmed: status !== 'pending',
        place: pick(['Mumbai', 'Nagpur', 'Nashik', 'Delhi', 'Bangalore']),
        reason: pick(['Family Function', 'Medical appointment', 'Festival leave', 'Sister Wedding']),
        leave_date: '2026-10-05',
        return_date: '2026-10-09',
        overall_status: status,
        qr_used_out: status === 'completed',
        qr_used_in: status === 'completed',
        scanned_by_name: guard.name,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 7)),
      });
    }
    await HomeVisitLog.insertMany(homeDocs, { ordered: false });
    console.log('Seeded 300 HomeVisitLog records.');
  }

  // Seed Complaints
  const complaintCount = await Complaint.countDocuments();
  if (complaintCount < 200 && students.length > 0) {
    console.log('Seeding 200 Complaint records...');
    const complaintDocs = [];
    const types = ['electricity', 'wifi', 'washing_machine', 'carpenter', 'plumber', 'others'];
    const statuses = ['pending', 'in_progress', 'resolved'];

    for (let i = 0; i < 200; i++) {
      const student = students[i % students.length];
      const type = pick(types);
      const status = pick(statuses);

      complaintDocs.push({
        student_id: student._id,
        name: student.name,
        rollNo: student.rollNo,
        hostel: student.hostel,
        complaint_type: type,
        complaint_text: `[${type}] Maintenance issue reported in room ${student.roomNo || 'Wing A'}. Needs prompt attention.`,
        status,
        timestamp: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 5)),
        resolvedAt: status === 'resolved' ? new Date() : null,
      });
    }
    await Complaint.insertMany(complaintDocs, { ordered: false });
    console.log('Seeded 200 Complaint records.');
  }

  // Generate tokens file for the load simulator
  const activeTokens = {
    students: students.slice(0, 150).map((s) => ({
      id: s._id.toString(),
      name: s.name,
      rollNo: s.rollNo,
      hostel: s.hostel,
      token: jwt.sign({ id: s._id }, JWT_SECRET, { expiresIn: '7d' }),
    })),
    guards: guards.slice(0, 20).map((g) => ({
      id: g._id.toString(),
      name: g.name,
      token: jwt.sign({ id: g._id }, JWT_SECRET, { expiresIn: '7d' }),
    })),
    wardens: wardens.slice(0, 10).map((w) => ({
      id: w._id.toString(),
      name: w.name,
      hostel: w.hostel,
      token: jwt.sign({ id: w._id }, JWT_SECRET, { expiresIn: '7d' }),
    })),
  };

  const tokensFilePath = path.join(__dirname, 'testTokens.json');
  fs.writeFileSync(tokensFilePath, JSON.stringify(activeTokens, null, 2));
  console.log(`Saved test tokens to ${tokensFilePath}`);

  console.log('Seeding completed successfully!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
