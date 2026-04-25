/**
 * Database Seeder
 * Creates demo users: warden, security, 3 students with college emails
 * Run: node seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const connectDB = require('./config/db');

const DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'iiitpune.ac.in';

const seedUsers = [
  // ─── Warden ─────────────────────────────────────────────────────────────────
  {
    name: 'Dr. Mahesh Joshi',
    phone: '+919900001111',
    email: 'warden@campus.edu',
    password: 'warden123',
    role: 'warden',
  },
  // ─── Security Guard ──────────────────────────────────────────────────────────
  {
    name: 'MSF Guard',
    phone: '+919900002222',
    email: 'security@campus.edu',
    password: 'security123',
    role: 'security',
  },
  // ─── Students (college email domain) ─────────────────────────────────────────
  {
    name: 'Kaustubh Khandare',
    phone: '+919800011001',
    email: `kaustubh@${DOMAIN}`,
    password: 'student123',
    role: 'student',
    hostel: 'BH1',
    rollNo: 'CS2021001',
    parentPhone: '+919700011001',
  },
  {
    name: 'Priya Patel',
    phone: '+919800011002',
    email: `priya@${DOMAIN}`,
    password: 'student123',
    role: 'student',
    hostel: 'GH',
    rollNo: 'EC2021042',
    parentPhone: '+919700011002',
  },
  {
    name: 'Ravi Verma',
    phone: '+919800011003',
    email: `ravi@${DOMAIN}`,
    password: 'student123',
    role: 'student',
    hostel: 'BH2',
    rollNo: 'ME2022015',
    parentPhone: '+919700011003',
  },
];

const seed = async () => {
  try {
    await connectDB();
    console.log('\n🌱 Starting database seed...');

    await User.deleteMany({});
    console.log('  🗑️  Cleared existing users');

    for (const userData of seedUsers) {
      const user = await User.create(userData);
      console.log(`  ✅ [${user.role.padEnd(8)}] ${user.name} — ${user.email}`);
    }

    console.log('\n✨ Seed complete! Demo credentials:');
    console.log('─'.repeat(55));
    console.log(`  Warden:   warden@campus.edu       / warden123`);
    console.log(`  Security: security@campus.edu     / security123`);
    console.log(`  Student:  kaustubh@${DOMAIN}  / student123`);
    console.log(`  Student:  priya@${DOMAIN}  / student123`);
    console.log('─'.repeat(55));
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
};

seed();
