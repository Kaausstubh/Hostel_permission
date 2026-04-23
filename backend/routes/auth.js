/**
 * Auth Routes
 * POST /api/auth/register - Student self-registration (college email only)
 * POST /api/auth/login    - Login and receive JWT (1 day)
 * GET  /api/auth/me       - Get logged-in user profile
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { normalizeToE164 } = require('../utils/phone');

// College email domain restriction for student self-registration
const COLLEGE_EMAIL_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'iiitp.ac.in';

// Helper: generate 1-day JWT
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1d' });

// ── Register (Students Only) ──────────────────────────────────────────────────
/**
 * Only students can self-register.
 * Warden and security accounts are created by admin (seed or manual DB insert).
 *
 * Validates:
 *  - email must end with @<COLLEGE_EMAIL_DOMAIN>
 *  - rollNo must be unique
 *  - email must be unique
 *  - phone must be unique
 */
router.post('/register', async (req, res) => {
  try {
    const { name, rollNo, email, phone, parentPhone, hostel, password } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!name || !rollNo || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'name, rollNo, email, phone, and password are required',
      });
    }

    // College email domain check
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== COLLEGE_EMAIL_DOMAIN) {
      return res.status(400).json({
        success: false,
        message: `Only college emails (@${COLLEGE_EMAIL_DOMAIN}) are allowed for student registration`,
      });
    }

    // Check for duplicates
    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    const existingRollNo = await User.findOne({ rollNo });
    if (existingRollNo) {
      return res.status(400).json({ success: false, message: 'Roll number (MIS) already registered' });
    }
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    }

    // ── Create user ─────────────────────────────────────────────────────────
    const user = await User.create({
      name,
      rollNo,
      email: email.toLowerCase(),
      phone: normalizeToE164(phone),
      parentPhone: parentPhone ? normalizeToE164(parentPhone) : null,
      hostel: hostel || null,
      password,
      role: 'student', // Always student for self-registration
    });

    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        rollNo: user.rollNo,
        email: user.email,
        phone: user.phone,
        hostel: user.hostel,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    // Handle mongoose duplicate key errors gracefully
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        success: false,
        message: `${field} is already taken`,
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    // Include password field explicitly (select: false in schema)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const token = signToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        rollNo: user.rollNo,
        email: user.email,
        phone: user.phone,
        hostel: user.hostel,
        parentPhone: user.parentPhone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ── Get current user ──────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
