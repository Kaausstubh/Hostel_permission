/**
 * Auth Routes
 * POST /api/auth/register - Student self-registration (college email only)
 * POST /api/auth/login    - Login and receive JWT (7 days)
 * GET  /api/auth/me       - Get logged-in user profile
 * POST /api/auth/logout   - Invalidate session cache + blacklist JWT
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect, invalidateUserCache, addToBlacklist } = require('../middleware/auth');
const { normalizeToE164 } = require('../utils/phone');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiters');
const logger = require('../utils/logger');

// College email domain restriction for student self-registration
const COLLEGE_EMAIL_DOMAIN = process.env.COLLEGE_EMAIL_DOMAIN || 'iiitpune.ac.in';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: generate 7-day JWT
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// ── Register (Students Only) ──────────────────────────────────────────────────
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { name, rollNo, email, phone, parentPhone, hostel, password } = req.body;

    if (!name || !rollNo || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'name, rollNo, email, phone, and password are required',
      });
    }

    // Input length caps — prevent oversized payloads slipping through
    if (name.trim().length > 100 || rollNo.trim().length > 30) {
      return res.status(400).json({ success: false, message: 'Input fields exceed allowed length' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (emailDomain !== COLLEGE_EMAIL_DOMAIN) {
      return res.status(400).json({
        success: false,
        message: `Only college emails (@${COLLEGE_EMAIL_DOMAIN}) are allowed for student registration`,
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
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

    const user = await User.create({
      name: name.trim(),
      rollNo: rollNo.trim(),
      email: email.toLowerCase().trim(),
      phone: normalizeToE164(phone),
      parentPhone: parentPhone ? normalizeToE164(parentPhone) : null,
      hostel: hostel || null,
      password,
      role: 'student',
    });

    const token = signToken(user._id);

    logger.info('[Auth] Student registered', { userId: user._id, email: user.email, requestId: req.requestId });

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
    logger.error('[Auth] Register error', { error: error.message, requestId: req.requestId });
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ success: false, message: `${field} is already taken` });
    }
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password name rollNo email phone hostel parentPhone role isActive');
    if (!user || !(await user.comparePassword(password))) {
      // Generic message — do not reveal whether email exists
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account has been deactivated' });
    }

    const token = signToken(user._id);

    logger.info('[Auth] Login success', { userId: user._id, role: user.role, requestId: req.requestId });

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
    logger.error('[Auth] Login error', { error: error.message, requestId: req.requestId });
    res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// ── Get current user ──────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    const userId = String(req.user._id);

    // 1. Invalidate Redis/in-memory session cache
    await invalidateUserCache(userId);

    // 2. Add current JWT to blacklist (prevents reuse even within 7-day validity)
    if (req._authToken && req._authDecoded) {
      await addToBlacklist(req._authToken, req._authDecoded);
    }

    logger.info('[Auth] User logged out', { userId, requestId: req.requestId });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.warn('[Auth] Logout cleanup error (non-critical)', { error: err.message, requestId: req.requestId });
    res.json({ success: true, message: 'Logged out (cleanup partial)' });
  }
});

module.exports = router;
