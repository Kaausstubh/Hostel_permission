/**
 * Database Seeder — OAuth Edition
 *
 * Pre-seeds Warden and Security staff accounts so they have the correct role
 * assigned before their first Google OAuth login.
 *
 * Students do NOT need to be seeded — they self-onboard via Google OAuth
 * using their @cse.iiitp.ac.in or @ece.iiitp.ac.in institutional email.
 *
 * HOW IT WORKS:
 *   On first Google login, Passport looks up the user by email.
 *   If a seeded record exists, it links the oauthId to it and preserves the role.
 *   If no record exists (e.g. an unknown email tries the warden portal), access is denied.
 *
 * Run: node seed.js
 *
 * IMPORTANT: Replace the email addresses below with your REAL warden/security
 *            Google accounts before going to production.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const InOutLog = require('./models/InOutLog');
const HomeVisitLog = require('./models/HomeVisitLog');
const Complaint = require('./models/Complaint');
const AuditLog = require('./models/AuditLog');
const ArchiveJob = require('./models/ArchiveJob');
const connectDB = require('./config/db');

// ── Staff accounts to pre-seed ────────────────────────────────────────────────
// Replace these with real institutional Google account emails.
// Students are NOT seeded — they self-register via OAuth.
const staffUsers = [
  // ─── Hostel Staff (Wardens) ────────────────────────────────────────────────
  {
    name:          'Kaustubh Khandare',
    email:         'kaaustubhkhandare@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-kaustubh',
  },
  {
    name:          'Laxman Shinde',
    email:         'laxmanshinde@iiitp.ac.in',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-laxman',
  },
  {
    name:          'Angad Borge',
    email:         'angadborge691@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-angad',
  },
  {
    name:          'Saurabh Kumar',
    email:         'saurabhkumar78540@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-saurabh',
  },
  {
    name:          'Navin Thakur',
    email:         'navinthakur@iiitp.ac.in',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-navin',
  },
  {
    name:          'Kirti More',
    email:         'kirti.more@iiitp.ac.in',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-kirti',
  },
  {
    name:          'Minakshi',
    email:         'minakshi@iiitp.ac.in',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-minakshi',
  },
  {
    name:          'Sjyotik',
    email:         'sjyotik2005@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-sjyotik',
  },
  {
    name:          'Aniket Wandre',
    email:         'aniketwandre2914@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-aniket',
  },
  {
    name:          'Parthraj Solanke',
    email:         'parthrajsolanke@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-parthraj',
  },
  {
    name:          'Mohit Moksh',
    email:         'mohitmoksh810@gmail.com',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-mohit',
  },
  {
    name:          'Mahesh Joshi',
    email:         'mahesh.joshi@iiitp.ac.in',
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-staff-mahesh',
  },

  // ─── Security Staff ────────────────────────────────────────────────────────
  {
    name:          'Security Guard',
    email:         'security@campus.edu',
    role:          'security',
    oauthProvider: 'google',
    oauthId:       'seeded-security-placeholder',
  },
];

const seed = async () => {
  try {
    await connectDB();
    console.log('\n🧹 Initiating complete database reset...');

    // Drop all historical logs, complaints, and student records
    await InOutLog.deleteMany({});
    console.log('  🗑️  Cleared all In/Out gate logs');

    await HomeVisitLog.deleteMany({});
    console.log('  🗑️  Cleared all Home Visit logs');

    await Complaint.deleteMany({});
    console.log('  🗑️  Cleared all student complaints');

    await AuditLog.deleteMany({});
    console.log('  🗑️  Cleared all audit logs');

    await ArchiveJob.deleteMany({});
    console.log('  🗑️  Cleared all archive jobs');

    await User.deleteMany({});
    console.log('  🗑️  Cleared all registered users');

    for (const userData of staffUsers) {
      const user = await User.create(userData);
      console.log(`  ✅ [${user.role.padEnd(8)}] ${user.name} — ${user.email}`);
    }

    console.log('\n✨ Seed complete!');
    console.log('─'.repeat(65));
    console.log('  Warden and Security accounts have been pre-seeded.');
    console.log('  These users must log in via Google OAuth using the emails above.');
    console.log('  On first login, their Google account will be automatically linked.');
    console.log('');
    console.log('  Student Portal: open to @cse.iiitp.ac.in and @ece.iiitp.ac.in emails.');
    console.log('  Students do NOT need to be seeded — they self-onboard via Google OAuth.');
    console.log('─'.repeat(65));
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    try {
      await mongoose.connection.close();
    } catch (dbErr) {
      // Ignore secondary error
    }
    process.exit(1);
  }
};

seed();
