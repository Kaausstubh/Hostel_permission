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
const passport = require('../config/passport');
const { protect, invalidateUserCache } = require('../middleware/auth');
const { validatePortalAccess, portalToRole } = require('../config/oauth');
const User     = require('../models/User');
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
    } else {
      const result = await User.updateOne(query, { $set: { role: 'student' } });
      return res.json({ success: true, message: `Updated user ${email} to student`, result });
    }
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

// ── Initiate Google OAuth ─────────────────────────────────────────────────────
// Step 1: Frontend calls this URL with ?portal=student|warden|security
// We store the portal in the session before redirecting to Google.
router.get('/google', (req, res, next) => {
  const portal = req.query.portal;
  const validPortals = ['student', 'warden', 'security'];

  if (!portal || !validPortals.includes(portal)) {
    return res.status(400).json({
      success: false,
      message: `Invalid portal. Must be one of: ${validPortals.join(', ')}`,
    });
  }

  // Check if OAuth is configured to avoid Passport crashes
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    logger.error('[Auth] Google OAuth credentials are not set in the backend environment.');
    return res.status(500).json({
      success: false,
      message: 'Google OAuth is not configured on this server. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env',
    });
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
          // For warden/security: auto-correct the role if their email passes
          // portal access validation (e.g. user was accidentally created as
          // 'student' during testing but is a valid warden/security account).
          if (portal === 'warden' || portal === 'security') {
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
    },
  });
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
