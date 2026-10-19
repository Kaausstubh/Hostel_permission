/**
 * Auth Routes — Google OAuth
 *
 * GET  /api/auth/google?portal=student|warden|security
 *        → Initiates Google OAuth flow. Stores portal in session state.
 *
 * GET  /api/auth/google/callback
 *        → Google redirects here after authentication.
 *          Validates domain/email per portal → issues JWT → redirects to frontend.
 *
 * GET  /api/auth/me
 *        → Returns the currently authenticated user (requires Bearer token).
 *
 * POST /api/auth/logout
 *        → Invalidates session cache. Frontend discards token.
 */

const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const passport = require('../config/passport');
const { protect, authorize, invalidateUserCache } = require('../middleware/auth');
const { validatePortalAccess, portalToRole } = require('../config/oauth');
const User     = require('../models/User');
const Guardian = require('../models/Guardian');
const PendingRegistration = require('../models/PendingRegistration');
const { sendStudentOtpEmail } = require('../services/mailService');
const {
  validateCollegeDomain,
  getAllowedCollegeDomains,
  validateGuardianInputs,
  linkInitialGuardians,
} = require('../services/guardianService');
const logger   = require('../utils/logger');

// ── Temporary reset endpoint for production correction ─────────────────────────
router.get('/temp-reset-user', async (req, res) => {
  try {
    const { email, secret, action } = req.query;
    if (secret !== 'heimdall_temp_reset_9988') {
      return res.status(403).send('Forbidden: Invalid secret');
    }
    if (!email) {
      return res.status(400).send('Bad Request: Email required');
    }
    const query = { email: email.toLowerCase().trim() };
    if (action === 'delete') {
      const result = await User.deleteOne(query);
      return res.json({ success: true, message: `Deleted user ${email}`, result });
    } else if (action === 'get') {
      const user = await User.findOne(query).lean();
      return res.json({ success: true, user });
    } else {
      const result = await User.updateOne(query, { $set: { role: 'student' } });
      return res.json({ success: true, message: `Updated user ${email} to student`, result });
    }
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/temp-clear-students', async (req, res) => {
  try {
    const { secret } = req.query;
    if (secret !== 'heimdall_temp_reset_9988') {
      return res.status(403).send('Forbidden: Invalid secret');
    }
    const RoomAllocation = require('../models/RoomAllocation');
    const HostelRoom = require('../models/HostelRoom');
    const StudentDevice = require('../models/StudentDevice');
    const AttendanceRecord = require('../models/AttendanceRecord');
    const InOutLog = require('../models/InOutLog');
    const HomeVisitLog = require('../models/HomeVisitLog');
    const Complaint = require('../models/Complaint');

    const [userRes, allocRes, devRes] = await Promise.all([
      User.deleteMany({ role: 'student' }),
      RoomAllocation.deleteMany({}),
      StudentDevice.deleteMany({}),
      AttendanceRecord.deleteMany({}),
      InOutLog.deleteMany({ role: 'student' }),
      HomeVisitLog.deleteMany({ role: 'student' }),
      Complaint.deleteMany({ role: 'student' }),
    ]);

    const rooms = await HostelRoom.find({}).lean();
    for (const r of rooms) {
      await HostelRoom.updateOne(
        { _id: r._id },
        { $set: { occupantsCount: 0, vacantBeds: r.capacity || 2 } }
      );
    }

    return res.json({
      success: true,
      message: `Cleared ${userRes.deletedCount} students and reset room allocations.`,
      deletedStudents: userRes.deletedCount,
      clearedAllocations: allocRes.deletedCount,
      clearedDevices: devRes.deletedCount,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Issue a JWT (15 days) after successful OAuth.
// The JWT is used as a stateless Bearer token for all subsequent API calls.
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15d' });

// Build the frontend redirect URL with token and user info encoded in query params.
// Using a one-time URL is acceptable here; PKCE would be needed for mobile.
const buildFrontendRedirect = (baseUrl, token, user) => {
  // Keep the OAuth callback URL lightweight (under 1KB) to avoid HTTP 414 / header overflow.
  // The full user profile and studentPhoto are loaded cleanly by AuthContext via /api/auth/me on mount.
  const shortPicture = user.picture && !user.picture.startsWith('data:') && !user.picture.includes('googleusercontent.com')
    ? user.picture
    : null;

  const userPayload = Buffer.from(
    JSON.stringify({
      id:           user._id,
      name:         user.name,
      email:        user.email,
      role:         user.role,
      picture:      shortPicture,
      hostel:       user.hostel || null,
      roomNo:       user.roomNo || null,
      rollNo:       user.rollNo || null,
      phone:        user.phone || null,
      parentPhone:  user.parentPhone || null,
      parentPhone2: user.parentPhone2 || null,
    })
  ).toString('base64');

  const params = new URLSearchParams({ token, user: userPayload });
  return `${baseUrl}/auth/callback?${params.toString()}`;
};

const buildErrorRedirect = (baseUrl, errorCode, message) => {
  const params = new URLSearchParams({ error: errorCode, message });
  return `${baseUrl}/auth/callback?${params.toString()}`;
};

// ── Student Self-Registration ────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const {
      name,
      rollNo,
      email,
      phone,
      password,
      hostel,
      roomNo,
      guardian1,
      guardian2,
    } = req.body;

    if (!name || !rollNo || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'All required student fields must be provided' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const normEmail = email.trim().toLowerCase();
    const normRollNo = rollNo.trim().toUpperCase();

    // 1. Strict College Domain Validation
    if (!validateCollegeDomain(normEmail)) {
      const allowed = getAllowedCollegeDomains();
      return res.status(400).json({
        success: false,
        message: `Only authorized college domains (${allowed.map((d) => `@${d}`).join(', ')}) are allowed for student registration.`,
      });
    }

    // 2. Duplicate Check in User Collection
    const existingUser = await User.findOne({
      $or: [{ email: normEmail }, { rollNo: normRollNo }],
    });
    if (existingUser) {
      if (existingUser.email === normEmail) {
        return res.status(409).json({ success: false, message: 'An account with this college email already exists. Please sign in.' });
      }
      return res.status(409).json({ success: false, message: 'An account with this roll number already exists.' });
    }

    // 3. Validate Guardian Inputs (3 distinct phones, 2 distinct non-college parent emails)
    const { studentPhoneE164, g1PhoneE164, g2PhoneE164, normG1E, normG2E } = validateGuardianInputs({
      studentPhone: phone,
      studentEmail: normEmail,
      guardian1,
      guardian2,
    });

    // 4. Generate 6-digit OTP and store in PendingRegistration (15 min TTL)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const passwordHash = await bcrypt.hash(password, 10);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Upsert into PendingRegistration
    await PendingRegistration.findOneAndUpdate(
      { email: normEmail },
      {
        $set: {
          name: name.trim(),
          email: normEmail,
          rollNo: normRollNo,
          phone: studentPhoneE164,
          hostel: hostel || null,
          roomNo: roomNo || null,
          passwordHash,
          otpHash,
          otpExpiresAt,
          otpAttempts: 0,
          guardian1: {
            name: guardian1.name.trim(),
            relationship: guardian1.relationship,
            phone: g1PhoneE164,
            email: normG1E,
          },
          guardian2: {
            name: guardian2.name.trim(),
            relationship: guardian2.relationship,
            phone: g2PhoneE164,
            email: normG2E,
          },
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // 5. Send OTP Email
    await sendStudentOtpEmail({
      to: normEmail,
      name: name.trim(),
      otp,
    });

    logger.info(`[Auth] Registration OTP dispatched to ${normEmail} (OTP: ${otp})`);

    return res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normEmail}. Please verify to complete your registration.`,
      email: normEmail,
    });
  } catch (err) {
    logger.warn('[Auth] Registration error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── Verify Registration OTP ──────────────────────────────────────────────────
router.post('/verify-registration-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const normEmail = email.trim().toLowerCase();
    const pending = await PendingRegistration.findOne({ email: normEmail });

    if (!pending) {
      return res.status(400).json({ success: false, message: 'Registration session expired or not found. Please register again.' });
    }

    if (new Date() > new Date(pending.otpExpiresAt)) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please register again.' });
    }

    if (pending.otpAttempts >= 5) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({ success: false, message: 'Too many incorrect attempts. Please register again.' });
    }

    const inputHash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    if (inputHash !== pending.otpHash) {
      pending.otpAttempts += 1;
      await pending.save();
      return res.status(400).json({ success: false, message: 'Invalid verification code. Please check and try again.' });
    }

    // OTP verified successfully! Create permanent User record
    const user = await User.create({
      name: pending.name,
      email: pending.email,
      rollNo: pending.rollNo,
      phone: pending.phone,
      hostel: pending.hostel,
      roomNo: pending.roomNo,
      role: 'student',
      passwordHash: pending.passwordHash,
      isEmailVerified: true,
      isActive: true,
    });

    // Automatically link guardians and dispatch invitations
    let guardianResult = null;
    try {
      guardianResult = await linkInitialGuardians({
        studentId: user._id,
        guardian1: pending.guardian1,
        guardian2: pending.guardian2,
        ip: req.ip,
      });
    } catch (guardErr) {
      logger.error('[Auth] Error linking guardians after verification', { error: guardErr.message });
    }

    // Cleanup staging record
    await PendingRegistration.deleteOne({ _id: pending._id });

    const { isMailConfigured } = require('../services/mailService');
    const mailActive = isMailConfigured();
    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      mailConfigured: mailActive,
      message: mailActive
        ? 'Account verified and registered successfully! Parent invitations sent to email inboxes.'
        : 'Account registered! (SMTP is not configured in backend/.env — invitations simulated in mock mode).',
      inviteUrls: guardianResult?.inviteUrls || {},
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        rollNo: user.rollNo,
        hostel: user.hostel,
        roomNo: user.roomNo,
        phone: user.phone,
        parentPhone: user.parentPhone,
        parentPhone2: user.parentPhone2,
      },
    });
  } catch (err) {
    logger.error('[Auth] Verify OTP error', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Resend Registration OTP ──────────────────────────────────────────────────
router.post('/resend-registration-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const normEmail = email.trim().toLowerCase();
    const pending = await PendingRegistration.findOne({ email: normEmail });
    if (!pending) {
      return res.status(400).json({ success: false, message: 'Registration session expired. Please fill the form again.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    pending.otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    pending.otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    pending.otpAttempts = 0;
    await pending.save();

    await sendStudentOtpEmail({
      to: normEmail,
      name: pending.name,
      otp,
    });

    return res.json({ success: true, message: 'A new verification code has been sent to your email.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Password-Based Sign In (Student / Staff / Parent) ─────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normEmail });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. If you registered with Google, please use Google Sign In.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'This account has been deactivated.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    user.lastLoginAt = new Date();
    await user.save();
    await invalidateUserCache(String(user._id));

    const token = signToken(user._id);

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        rollNo: user.rollNo || null,
        hostel: user.hostel || null,
        roomNo: user.roomNo || null,
        phone: user.phone || null,
        parentPhone: user.parentPhone || null,
        parentPhone2: user.parentPhone2 || null,
      },
    });
  } catch (err) {
    logger.error('[Auth] Login error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ── Complete Guardian Details (Backward Compatibility for Existing Students) ──
router.post('/complete-guardian-details', protect, authorize('student'), async (req, res) => {
  try {
    const guardian1 = req.body.guardian1 || req.body.guardian_1;
    const guardian2 = req.body.guardian2 || req.body.guardian_2;
    if (!guardian1) {
      return res.status(400).json({ success: false, message: 'Primary guardian details are required' });
    }

    const result = await linkInitialGuardians({
      studentId: req.user._id,
      guardian1,
      guardian2,
      ip: req.ip,
      actorId: req.user._id,
    });

    const { isMailConfigured } = require('../services/mailService');
    const mailActive = isMailConfigured();

    return res.json({
      success: true,
      mailConfigured: mailActive,
      message: mailActive
        ? 'Guardian details saved and invitations dispatched successfully to parent inboxes.'
        : 'Guardian details saved! SMTP is not configured in backend/.env (Mock mode).',
      ...result,
    });
  } catch (err) {
    logger.warn('[Auth] Complete guardian details error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ── Dev Fast-Login (Development Only) ─────────────────────────────────────────
router.get('/dev-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Dev login is disabled in production.' });
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const portal = req.query.portal || 'student';

  try {
    let user = null;

    if (portal === 'warden' || portal === 'hostel_staff') {
      const authorizedStaffEmail = 'sjyotik2005@gmail.com';
      user = await User.findOne({ email: authorizedStaffEmail });
      if (!user) {
        user = await User.create({
          name: 'Sjyotik (Hostel Staff)',
          email: authorizedStaffEmail,
          role: 'hostel_staff',
          oauthProvider: 'google',
        });
      } else if (user.role !== 'hostel_staff' && user.role !== 'warden') {
        user.role = 'hostel_staff';
        await user.save();
      }
    } else if (portal === 'security') {
      const authorizedSecurityEmail = 'kaaustubhkhandare@gmail.com';
      user = await User.findOne({ email: authorizedSecurityEmail });
      if (!user) {
        user = await User.create({
          name: 'Kaaustubh Khandare (Security)',
          email: authorizedSecurityEmail,
          role: 'security',
          oauthProvider: 'google',
        });
      } else if (user.role !== 'security') {
        user.role = 'security';
        await user.save();
      }
    } else {
      // Authorized Student with official institutional domain
      const authorizedStudentEmail = 'aarav.sharma@cse.iiitp.ac.in';
      user = await User.findOne({ email: authorizedStudentEmail });
      if (!user) {
        user = await User.create({
          name: 'Aarav Sharma',
          email: authorizedStudentEmail,
          role: 'student',
          rollNo: '2023BCSE042',
          hostel: 'BH1',
          roomNo: 'A-204',
          phone: '+919876543210',
          parentPhone: '+919876543211',
          gender: 'male',
          branch: 'CSE',
          year: '2nd Year',
          oauthProvider: 'google',
        });
      } else if (user.role !== 'student') {
        user.role = 'student';
        await user.save();
      }
    }

    const token = signToken(user._id);
    return res.redirect(buildFrontendRedirect(frontendUrl, token, user));
  } catch (error) {
    logger.error('[Auth] Dev login failed', { error: error.message });
    return res.redirect(buildErrorRedirect(frontendUrl, 'dev_login_failed', error.message));
  }
});

// ── Initiate Google OAuth ─────────────────────────────────────────────────────
// Step 1: Frontend calls this URL with ?portal=student|warden|security
// We store the portal in the session before redirecting to Google.
router.get('/google', (req, res, next) => {
  const portal = req.query.portal;
  const validPortals = ['student', 'warden', 'hostel_staff', 'security'];

  if (!portal || !validPortals.includes(portal)) {
    return res.status(400).json({
      success: false,
      message: `Invalid portal. Must be one of: ${validPortals.join(', ')}`,
    });
  }

  // Check if OAuth is configured to avoid Passport crashes
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    logger.error('[Auth] Google OAuth credentials are not set in the backend environment.');
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(
      buildErrorRedirect(frontendUrl, 'oauth_unconfigured', 'Google OAuth credentials are not set in backend/.env.')
    );
  }

  // Pass portal via OAuth state param (more reliable than session on free-tier hosts
  // where the process may restart between the initiation and callback requests)
  req.session.oauthPortal = portal;
  req.session.save((err) => {
    if (err) logger.warn('[Auth] Session save error before OAuth redirect', { error: err.message });
  });

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account', // Always show account picker for multi-account users
    state: portal,            // Carry portal through Google redirect as state param
  })(req, res, next);
});

// ── Google OAuth Callback ─────────────────────────────────────────────────────
// Step 2: Google redirects here after user authenticates.
router.get(
  '/google/callback',
  (req, res, next) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      logger.error('[Auth] Google OAuth callback triggered but credentials are not set.');
      return res.redirect(
        buildErrorRedirect(frontendUrl, 'oauth_unconfigured', 'Google OAuth is not configured on this server.')
      );
    }

    // Custom callback to handle errors gracefully with frontend redirect
    passport.authenticate('google', { session: false }, async (err, user) => {
      // Read portal from state param first (reliable), fall back to session (local dev)
      const portal = req.query.state || req.session?.oauthPortal;

      if (!portal) {
        logger.error('[Auth] Google OAuth callback triggered but portal was missing in both state and session');
        return res.redirect(
          buildErrorRedirect(frontendUrl, 'session_lost', 'Authentication session expired. Please choose a portal and try again.')
        );
      }

      if (err || !user) {
        logger.error('[Auth] Google OAuth callback error', {
          error: err?.message || 'No user returned',
          portal,
        });
        return res.redirect(
          buildErrorRedirect(frontendUrl, 'oauth_failed', 'Google authentication failed. Please try again.')
        );
      }

      try {
        const email = user.email;

        // ── Portal access validation ─────────────────────────────────────────
        const { allowed, reason } = validatePortalAccess(portal, email);
        if (!allowed) {
          logger.warn('[Auth] Portal access denied', { email, portal, reason });
          return res.redirect(
            buildErrorRedirect(frontendUrl, 'access_denied', reason)
          );
        }

        // ── Ensure role is set correctly for the portal ─────────────────────
        const expectedRole = portalToRole(portal);
        if (user.role !== expectedRole) {
          // For warden/hostel_staff/security: auto-correct the role if their email passes
          // portal access validation (e.g. user was accidentally created as
          // 'student' during testing but is a valid warden/security account).
          if (portal === 'warden' || portal === 'hostel_staff' || portal === 'security') {
            logger.info('[Auth] Auto-correcting role to match portal', {
              email,
              oldRole: user.role,
              newRole: expectedRole,
              portal,
            });
            user.role = expectedRole;
            await user.save();
          } else {
            // For student portal: strict role match required
            logger.warn('[Auth] Role mismatch for portal', {
              email,
              portal,
              userRole: user.role,
              expectedRole,
            });
            return res.redirect(
              buildErrorRedirect(
                frontendUrl,
                'role_mismatch',
                `Your account is registered as '${user.role}' but you tried to access the ${portal} portal. Please use the correct portal.`
              )
            );
          }
        }

        // ── Invalidate session cache & issue JWT & redirect ──────────────────
        await invalidateUserCache(String(user._id));
        const token = signToken(user._id);
        logger.info('[Auth] Google OAuth login success', {
          userId: user._id,
          email,
          role: user.role,
          portal,
        });

        return res.redirect(buildFrontendRedirect(frontendUrl, token, user));
      } catch (callbackErr) {
        logger.error('[Auth] OAuth callback processing error', { error: callbackErr.message });
        return res.redirect(
          buildErrorRedirect(frontendUrl, 'server_error', 'An internal error occurred. Please try again.')
        );
      }
    })(req, res, next);
  }
);

// ── Get current user ──────────────────────────────────────────────────────────
// Used by AuthContext on mount to silently re-validate the stored token.
router.get('/me', protect, async (req, res) => {
  // Always query fresh from DB for /me to guarantee latest profile and student photo
  let u = (await User.findById(req.user._id).lean()) || req.user;

  // Auto-recovery: If student has no studentPhoto or if picture is Google's letter avatar,
  // attempt to recover their verified face photo from past HomeVisitLog or InOutLog
  if (u.role === 'student' && (!u.studentPhoto || u.studentPhoto.includes('googleusercontent.com'))) {
    try {
      const HomeVisitLog = require('../models/HomeVisitLog');
      const InOutLog = require('../models/InOutLog');
      const pastVisit = await HomeVisitLog.findOne({
        student_id: u._id,
        student_photo: { $ne: null, $nin: ['', null] },
      }).sort({ createdAt: -1 });

      const pastInOut = !pastVisit && await InOutLog.findOne({
        student_id: u._id,
        student_photo: { $ne: null, $nin: ['', null] },
      }).sort({ createdAt: -1 });

      const candidate = pastVisit?.student_photo || pastInOut?.student_photo;
      const recovered = (candidate && !candidate.includes('googleusercontent.com')) ? candidate : null;
      if (recovered) {
        await User.updateOne({ _id: u._id }, { $set: { studentPhoto: recovered, picture: recovered } });
        await invalidateUserCache(String(u._id));
        u.studentPhoto = recovered;
        u.picture = recovered;
      }
    } catch (recoveryErr) {
      // Non-blocking recovery
    }
  }

  let hasGuardians = true;
  if (u.role === 'student') {
    try {
      const Guardian = require('../models/Guardian');
      const gCount = await Guardian.countDocuments({ student_id: u._id });
      hasGuardians = gCount > 0;
    } catch {
      hasGuardians = true;
    }
  }

  const effectivePicture = u.studentPhoto || (u.picture && !u.picture.includes('googleusercontent.com') ? u.picture : null);
  res.json({
    success: true,
    user: {
      id:           u._id,
      name:         u.name,
      email:        u.email,
      role:         u.role,
      picture:      effectivePicture,
      studentPhoto: u.studentPhoto || (u.picture && !u.picture.includes('googleusercontent.com') ? u.picture : null),
      hostel:       u.hostel || null,
      roomNo:       u.roomNo || null,
      rollNo:       u.rollNo || null,
      phone:        u.phone || null,
      parentPhone:  u.parentPhone || null,
      parentPhone2: u.parentPhone2 || null,
      hasGuardians,
    },
  });
});

// ── Guardian Status for Student ──────────────────────────────────────────────
router.get('/guardian-status', protect, authorize('student'), async (req, res) => {
  try {
    const Guardian = require('../models/Guardian');
    const guardians = await Guardian.find({ student_id: req.user._id }).lean();
    res.json({
      success: true,
      hasGuardians: guardians.length > 0,
      guardians,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
// Invalidates Redis/in-memory session cache.
// The JWT (15d) will expire naturally — no blacklist needed.
router.post('/logout', protect, async (req, res) => {
  try {
    await invalidateUserCache(String(req.user._id));
    logger.info('[Auth] User logged out', {
      userId: req.user._id,
      requestId: req.requestId,
    });
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.warn('[Auth] Logout cache cleanup error (non-critical)', { error: err.message });
    res.json({ success: true, message: 'Logged out' });
  }
});

// ── Student Photo Stream (Fast on-demand binary image endpoint) ──────────────
// Converts database base64 strings into standard binary image responses with
// 24-hour browser caching. Completely prevents megabytes of base64 data from
// inflating scan logs, home visits, and complaint list endpoints.
router.get('/student-photo/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('studentPhoto picture').lean();
    if (!user) return res.status(404).send('Not found');

    const photo = user.studentPhoto || user.picture;
    if (!photo) return res.status(404).send('No photo');

    if (photo.startsWith('http')) {
      return res.redirect(photo);
    }

    if (photo.startsWith('data:image/')) {
      const parts = photo.split(',');
      if (parts.length >= 2) {
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const buffer = Buffer.from(parts[1], 'base64');
        res.set('Content-Type', mime);
        res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        return res.send(buffer);
      }
    }

    return res.status(404).send('Invalid photo format');
  } catch (err) {
    return res.status(500).send('Error');
  }
});

module.exports = router;
