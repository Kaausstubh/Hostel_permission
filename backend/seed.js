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
const connectDB = require('./config/db');

// ── Staff accounts to pre-seed ────────────────────────────────────────────────
// Replace these with real institutional Google account emails.
// Students are NOT seeded — they self-register via OAuth.
const staffUsers = [
  // ─── Wardens ──────────────────────────────────────────────────────────────
  {
    name:          'Dr. Mahesh Joshi',
    email:         'kaaustubhkhandare@gmail.com',  // ← Replace with real Google email
    role:          'warden',
    oauthProvider: 'google',
    oauthId:       'seeded-warden-placeholder', // ← Will be replaced on first real login
  },

  // ─── Security Staff ────────────────────────────────────────────────────────
  {
    name:          'MSF Guard',
    email:         'security@campus.edu', // ← Replace with real Google email
    role:          'security',
    oauthProvider: 'google',
    oauthId:       'seeded-security-placeholder', // ← Will be replaced on first real login
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
