/**
 * Synthetic Load-Test User Generator & Seeder
 *
 * Generates 5,000 synthetic students, 20 guards, 10 wardens, 2 admins.
 * Tags every record with { loadTest: true, loadTestRunId: "<unique-id>" }
 * Never modifies or deletes real users.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('./lib/config');

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Kabir', 'Ananya', 'Diya', 'Aadhya', 'Saanvi', 'Myra',
  'Pari', 'Anika', 'Navya', 'Angel', 'Ira', 'Tanvi', 'Riya', 'Siya', 'Shanaya', 'Sneha'
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Joshi', 'Kulkarni', 'Deshmukh', 'Shinde', 'Patil', 'Gupta', 'Mehta',
  'Shah', 'Chauhan', 'Singh', 'Kumar', 'Bose', 'Chatterjee', 'Das', 'Nair', 'Pillai', 'Rao',
  'Reddy', 'Gowda', 'Iyer', 'Agarwal', 'Bhat', 'Kamat', 'Jain', 'Bansal', 'Saxena', 'Mishra'
];

const HOSTELS = ['BH1', 'BH2', 'GH'];
const DEPARTMENTS = ['CSE', 'ECE', 'DSAI', 'IT'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomDigits = (n) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

async function seed() {
  console.log('═'.repeat(70));
  console.log('🚀 HEIMDALL SYNTHETIC USER GENERATOR & SEEDER');
  console.log('═'.repeat(70));

  const runId = `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  console.log(`📋 Test Run ID: ${runId}`);
  console.log(`🔗 Connecting to MongoDB: ${config.mongoUri.replace(/:([^@]+)@/, ':***@')}...`);

  await mongoose.connect(config.mongoUri, { maxPoolSize: 50 });
  const db = mongoose.connection.db;

  // Protected emails that must NEVER be touched (dynamically loaded from .env)
  const PROTECTED_EMAILS = [
    ...(process.env.WARDEN_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()),
    ...(process.env.SECURITY_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()),
    'security@campus.edu',
  ].filter(Boolean);

  console.log('🧹 Purging any existing synthetic test data (loadTest: true)...');
  const deleteResult = await db.collection('users').deleteMany({
    loadTest: true,
    email: { $nin: PROTECTED_EMAILS },
  });
  console.log(`   Removed ${deleteResult.deletedCount} prior synthetic users.`);

  // Also remove non-protected, non-loadTest seed accounts from older seed scripts if any
  const oldSeedResult = await db.collection('users').deleteMany({
    email: {
      $nin: PROTECTED_EMAILS,
      $regex: /^(student_|guard|warden|loadtest\.)/i,
    },
    loadTest: { $ne: true },
  });
  if (oldSeedResult.deletedCount > 0) {
    console.log(`   Cleaned up ${oldSeedResult.deletedCount} legacy seed records.`);
  }

  const usersToInsert = [];
  const studentCount = 5000;
  const guardCount = 20;
  const wardenCount = 10;
  const adminCount = 2;

  console.log(`\n📦 Generating records:`);
  console.log(`   • ${studentCount} Students (loadtest.student00001 - loadtest.student05000)`);
  console.log(`   • ${guardCount} Security Guards`);
  console.log(`   • ${wardenCount} Wardens`);
  console.log(`   • ${adminCount} Admins`);

  // 1. Guards
  for (let i = 1; i <= guardCount; i++) {
    const fName = pick(FIRST_NAMES);
    const lName = pick(LAST_NAMES);
    const numStr = String(i).padStart(2, '0');
    usersToInsert.push({
      name: `Guard ${fName} ${lName}`,
      email: `loadtest.guard${numStr}@heimdall-security.ac.in`,
      oauthProvider: 'google',
      oauthId: `loadtest_guard_oauth_${i}`,
      role: 'security',
      phone: `+9198${randomDigits(8)}`,
      isActive: true,
      loadTest: true,
      loadTestRunId: runId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 2. Wardens
  for (let i = 1; i <= wardenCount; i++) {
    const fName = pick(FIRST_NAMES);
    const lName = pick(LAST_NAMES);
    const numStr = String(i).padStart(2, '0');
    usersToInsert.push({
      name: `Dr. ${fName} ${lName}`,
      email: `loadtest.warden${numStr}@iiitp.ac.in`,
      oauthProvider: 'google',
      oauthId: `loadtest_warden_oauth_${i}`,
      role: 'warden',
      hostel: HOSTELS[i % HOSTELS.length],
      phone: `+9199${randomDigits(8)}`,
      isActive: true,
      loadTest: true,
      loadTestRunId: runId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 3. Admins
  for (let i = 1; i <= adminCount; i++) {
    const numStr = String(i).padStart(2, '0');
    usersToInsert.push({
      name: `Admin Officer ${i}`,
      email: `loadtest.admin${numStr}@iiitp.ac.in`,
      oauthProvider: 'google',
      oauthId: `loadtest_admin_oauth_${i}`,
      role: 'admin',
      phone: `+9197${randomDigits(8)}`,
      isActive: true,
      loadTest: true,
      loadTestRunId: runId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // 4. Students (5,000)
  for (let i = 1; i <= studentCount; i++) {
    const fName = pick(FIRST_NAMES);
    const lName = pick(LAST_NAMES);
    const numStr = String(i).padStart(5, '0');
    const year = 2021 + (i % 4);
    const dept = DEPARTMENTS[i % DEPARTMENTS.length];
    const rollNo = `${year}${dept}${String(i).padStart(5, '0')}`;
    const hostel = HOSTELS[i % HOSTELS.length];
    const roomNo = `${hostel[0]}-${(i % 4) + 1}0${(i % 20) + 1}`;

    usersToInsert.push({
      name: `${fName} ${lName}`,
      email: `loadtest.student${numStr}@iiitp.ac.in`,
      oauthProvider: 'google',
      oauthId: `loadtest_student_oauth_${i}`,
      role: 'student',
      rollNo,
      hostel,
      roomNo,
      phone: `+91${pick(['98', '97', '99', '96'])}${randomDigits(8)}`,
      parentPhone: `+9191${randomDigits(8)}`,
      parentPhone2: `+9192${randomDigits(8)}`,
      isActive: true,
      loadTest: true,
      loadTestRunId: runId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Batch insert into MongoDB
  console.log('\n⏳ Writing users to MongoDB in batches of 1,000...');
  const batchSize = 1000;
  for (let b = 0; b < usersToInsert.length; b += batchSize) {
    const chunk = usersToInsert.slice(b, b + batchSize);
    await db.collection('users').insertMany(chunk, { ordered: false });
    process.stdout.write(`   ✓ Inserted ${Math.min(b + batchSize, usersToInsert.length)}/${usersToInsert.length} users\r`);
  }
  console.log('\n✅ User insertion complete.');

  // Fetch newly created users with their MongoDB _id
  console.log('🔑 Generating signed authentication tokens...');
  const seededStudents = await db.collection('users').find({ role: 'student', loadTest: true }).toArray();
  const seededGuards = await db.collection('users').find({ role: 'security', loadTest: true }).toArray();
  const seededWardens = await db.collection('users').find({ role: 'warden', loadTest: true }).toArray();
  const seededAdmins = await db.collection('users').find({ role: 'admin', loadTest: true }).toArray();

  const tokenData = {
    metadata: {
      runId,
      createdAt: new Date().toISOString(),
      studentCount: seededStudents.length,
      guardCount: seededGuards.length,
      wardenCount: seededWardens.length,
      adminCount: seededAdmins.length,
      jwtSecretUsed: config.jwtSecret.slice(0, 8) + '***',
    },
    students: seededStudents.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      email: s.email,
      rollNo: s.rollNo,
      hostel: s.hostel,
      token: jwt.sign({ id: s._id }, config.jwtSecret, { expiresIn: '15d' }),
    })),
    guards: seededGuards.map((g) => ({
      id: g._id.toString(),
      name: g.name,
      email: g.email,
      token: jwt.sign({ id: g._id }, config.jwtSecret, { expiresIn: '15d' }),
    })),
    wardens: seededWardens.map((w) => ({
      id: w._id.toString(),
      name: w.name,
      email: w.email,
      hostel: w.hostel,
      token: jwt.sign({ id: w._id }, config.jwtSecret, { expiresIn: '15d' }),
    })),
    admins: seededAdmins.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      email: a.email,
      token: jwt.sign({ id: a._id }, config.jwtSecret, { expiresIn: '15d' }),
    })),
  };

  if (!fs.existsSync(config.fixturesDir)) {
    fs.mkdirSync(config.fixturesDir, { recursive: true });
  }

  fs.writeFileSync(config.tokensFile, JSON.stringify(tokenData, null, 2));
  console.log(`📁 Test tokens written to: ${config.tokensFile}`);

  // Mirror to backend loadtest folder as well
  const backendTokensPath = path.resolve(__dirname, '../../Hostel_permission/backend/loadtest/testTokens.json');
  fs.writeFileSync(backendTokensPath, JSON.stringify(tokenData, null, 2));

  // Seed baseline in/out logs & complaints for test students
  console.log('\n📊 Seeding realistic baseline logs...');
  const inOutDocs = [];
  const today = new Date().toISOString().split('T')[0];
  const sampleStudents = seededStudents.slice(0, 1000);

  for (let i = 0; i < 2500; i++) {
    const student = sampleStudents[i % sampleStudents.length];
    const guard = seededGuards[i % seededGuards.length];
    const daysAgo = Math.floor(Math.random() * 4);
    const d = new Date(Date.now() - daysAgo * 86400000);
    const isReturned = Math.random() > 0.15;

    inOutDocs.push({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      email: student.email,
      phone: student.phone,
      parentPhone: student.parentPhone,
      hostel: student.hostel,
      qr_token: `token_loadtest_${i}_${Date.now()}`,
      status: isReturned ? 'IN' : 'OUT',
      returned: isReturned,
      out_time: new Date(d.getTime() - 7200000),
      in_time: isReturned ? d : null,
      timestamp: d,
      date: d.toISOString().split('T')[0],
      scannedBy: guard._id,
      scanned_by_name: guard.name,
      loadTest: true,
      loadTestRunId: runId,
    });
  }
  await db.collection('inoutlogs').deleteMany({ loadTest: true });
  await db.collection('inoutlogs').insertMany(inOutDocs, { ordered: false });
  console.log(`   ✓ Seeded 2,500 InOutLog records with loadTest: true`);

  // Seed complaints
  const complaintDocs = [];
  const types = ['wifi', 'electricity', 'washing_machine', 'plumber', 'carpenter'];
  for (let i = 0; i < 300; i++) {
    const student = sampleStudents[i % sampleStudents.length];
    const type = pick(types);
    const isResolved = Math.random() > 0.4;
    complaintDocs.push({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      complaint_type: type,
      complaint_text: `[LoadTest] ${type} issue reported in room ${student.roomNo || 'Wing 1'}.`,
      status: isResolved ? 'resolved' : 'pending',
      timestamp: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 3)),
      resolvedAt: isResolved ? new Date() : null,
      loadTest: true,
      loadTestRunId: runId,
    });
  }
  await db.collection('complaints').deleteMany({ loadTest: true });
  await db.collection('complaints').insertMany(complaintDocs, { ordered: false });
  console.log(`   ✓ Seeded 300 Complaint records with loadTest: true`);

  console.log('\n' + '═'.repeat(70));
  console.log('🎉 SYNTHETIC SEEDING COMPLETE');
  console.log(`   Total Users: ${await db.collection('users').countDocuments()}`);
  console.log(`   Synthetic Students: ${seededStudents.length}`);
  console.log(`   Synthetic Guards: ${seededGuards.length}`);
  console.log(`   Synthetic Wardens: ${seededWardens.length}`);
  console.log(`   Synthetic Admins: ${seededAdmins.length}`);
  console.log('═'.repeat(70));

  await mongoose.disconnect();
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    });
}

module.exports = seed;
