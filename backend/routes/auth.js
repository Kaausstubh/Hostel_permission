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
const COLLEGE_EMAIL_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'iiitpune.ac.in';

// Basic email format regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: generate 7-day JWT (extended from 1d for better student UX)
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

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

    // Email format check
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    // College email domain check
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== COLLEGE_EMAIL_DOMAIN) {
      return res.status(400).json({
        success: false,
        message: `Only college emails (@${COLLEGE_EMAIL_DOMAIN}) are allowed for student registration`,
      });
    }

    // Single query to check all duplicates at once (replaces 3 sequential DB hits)
    const existing = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { rollNo },
        { phone },
      ],
    }).lean();

    if (existing) {
      if (existing.email === email.toLowerCase()) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }
      if (existing.rollNo === rollNo) {
        return res.status(400).json({ success: false, message: 'Roll number (MIS) already registered' });
      }
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
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
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
