/**
 * Passport.js Strategy Configuration
 *
 * Initializes the Google OAuth 2.0 strategy.
 * The strategy uses a `findOrCreateUser` helper which:
 *   1. Looks up user by oauthId + oauthProvider (fast — indexed)
 *   2. Falls back to email lookup to link legacy accounts
 *   3. Creates a new user record if first-time login
 *
 * NOTE: Role assignment is handled in the OAuth callback route (routes/auth.js),
 * NOT here. Passport only handles profile retrieval and user upsert.
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const logger = require('../utils/logger');

// ── Shared user find-or-create helper ─────────────────────────────────────────

/**
 * Finds an existing user by OAuth credentials or email, or creates a new one.
 * Role is left as-is for existing users and set to null for brand-new ones
 * (the route callback sets the correct role based on portal + domain check).
 *
 * @param {object} profile  — Passport-normalized profile
 * @param {string} provider — 'google'
 * @param {string} role     — Role to assign to NEW users only
 * @returns {Promise<{user: object, isNew: boolean}>}
 */
const findOrCreateUser = async (profile, provider, role) => {
  const email = (
    profile.emails?.[0]?.value ||
    profile._json?.email ||
    ''
  ).toLowerCase().trim();

  const name =
    profile.displayName ||
    `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() ||
    email.split('@')[0];

  const picture =
    profile.photos?.[0]?.value ||
    profile._json?.picture ||
    null;

  const oauthId = String(profile.id || profile._json?.sub || '');

  if (!email) {
    throw new Error('OAuth provider did not return an email address. Ensure email scope is granted.');
  }

  // ── 1. Look up by oauthId + provider (fastest — indexed compound key) ────────
  let user = await User.findOne({ oauthId, oauthProvider: provider });

  if (user) {
    // Update mutable fields on every login
    user.picture      = picture;
    user.lastLoginAt  = new Date();
    user.name         = name; // Keep name fresh from provider
    await user.save();
    return { user, isNew: false };
  }

  // ── 2. Fall back to email lookup (links legacy JWT-based accounts on first OAuth login) ──
  user = await User.findOne({ email });

  if (user) {
    // Link existing account to OAuth
    user.oauthId       = oauthId;
    user.oauthProvider = provider;
    user.picture       = picture;
    user.lastLoginAt   = new Date();
    await user.save();
    logger.info('[Passport] Linked existing account to OAuth', { email, provider });
    return { user, isNew: false };
  }

  // ── 3. Create new user (role provided by caller based on portal) ──────────────
  user = await User.create({
    name,
    email,
    oauthId,
    oauthProvider:  provider,
    picture,
    lastLoginAt:    new Date(),
    role:           role || 'student',
  });

  logger.info('[Passport] Created new OAuth user', { email, provider, role: user.role });
  return { user, isNew: true };
};

// ── Google Strategy ────────────────────────────────────────────────────────────
// Lazily register the strategy so the server can boot even if credentials
// are not yet set (useful during local UI development).
// The strategy will throw a clear error at request time if credentials are missing.
const registerGoogleStrategy = () => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return; // Will be caught in the route handler with a clear message
  }
  passport.use(
    new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  `${process.env.PUBLIC_BACKEND_URL || 'http://localhost:5001'}/api/auth/google/callback`,
        scope:        ['profile', 'email'],
        // Pass request to callback so we can read session state (portal)
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          const portal = req.session?.oauthPortal || 'student';
          const role   = require('./oauth').portalToRole(portal);
          const { user } = await findOrCreateUser(profile, 'google', role);
          // Attach portal to user object temporarily — read in callback route
          user._portal = portal;
          return done(null, user);
        } catch (err) {
          logger.error('[Passport] Google strategy error', { error: err.message });
          return done(err, null);
        }
      }
    )
  );
};

// Register immediately if credentials are available, otherwise defer
registerGoogleStrategy();

// Export so routes can re-trigger registration after env is set (edge case)
passport._registerGoogleStrategy = registerGoogleStrategy;


// ── Serialization (minimal — only store user ID in session) ───────────────────
// Note: We use express-session only for the OAuth handshake (state param).
// After callback we issue a JWT and don't rely on Passport sessions further.
passport.serializeUser((user, done) => {
  done(null, { id: user._id?.toString(), portal: user._portal });
});

passport.deserializeUser(async ({ id }, done) => {
  try {
    const user = await User.findById(id).lean();
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
