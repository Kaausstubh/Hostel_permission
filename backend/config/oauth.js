/**
 * OAuth Access Control Configuration
 *
 * This file is the single source of truth for role-based domain/email
 * restrictions. Extend here — not scattered across routes or middleware.
 *
 * ── Student Portal ────────────────────────────────────────────────────────────
 *   Only emails from STUDENT_ALLOWED_DOMAINS are permitted.
 *
 * ── Warden Portal ────────────────────────────────────────────────────────────
 *   Currently open to any authenticated Google/Microsoft account.
 *   To restrict in future: populate WARDEN_ALLOWED_EMAILS env var.
 *
 * ── Security Portal ───────────────────────────────────────────────────────────
 *   Currently open to any authenticated Google/Microsoft account.
 *   To restrict in future: populate SECURITY_ALLOWED_EMAILS env var.
 */

// ── Student domain whitelist ───────────────────────────────────────────────────
const STUDENT_ALLOWED_DOMAINS = [
  'cse.iiitp.ac.in',
  'ece.iiitp.ac.in',
  'cysec.iiitp.ac.in',
  'aids.iiitp.ac.in',
  'mevd.iiitp.ac.in',
];

// ── Hostel Staff (Warden) email whitelist ─────────────────────────────────────
// Authorized emails permitted to log in to the Hostel Staff Command Centre.
const HOSTEL_STAFF_ALLOWED_EMAILS = [
  'laxmanshinde@iiitp.ac.in',
  'angadborge691@gmail.com',
  'saurabhkumar78540@gmail.com',
  'navinthakur@iiitp.ac.in',
  'kirti.more@iiitp.ac.in',
  'minakshi@iiitp.ac.in',
  'kaaustubhkhandare@gmail.com',
  'sjyotik2005@gmail.com',
  'aniketwandre2914@gmail.com',
  'parthrajsolanke@gmail.com',
  'mohitmoksh810@gmail.com',
  'mahesh.joshi@iiitp.ac.in',
];

// Loaded from env (comma-separated), falling back to HOSTEL_STAFF_ALLOWED_EMAILS.
const envWardenEmails = (process.env.WARDEN_ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const WARDEN_ALLOWED_EMAILS = envWardenEmails.length > 0
  ? envWardenEmails
  : HOSTEL_STAFF_ALLOWED_EMAILS;

// ── Security email whitelist ──────────────────────────────────────────────────
// Loaded from env (comma-separated). Empty = any authenticated account allowed.
const SECURITY_ALLOWED_EMAILS = (process.env.SECURITY_ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── Validators ────────────────────────────────────────────────────────────────

/**
 * Returns true if the email is allowed to access the Student Portal.
 * @param {string} email
 * @returns {boolean}
 */
const validateStudentEmail = (email) => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  // Prevent hostel staff from logging in as students
  if (WARDEN_ALLOWED_EMAILS.includes(normalized)) return false;
  const domain = normalized.split('@')[1];
  return STUDENT_ALLOWED_DOMAINS.includes(domain);
};

/**
 * Returns true if the email is allowed to access the Warden / Hostel Staff Portal.
 * Strictly restricted to authorized hostel staff emails only.
 * @param {string} email
 * @returns {boolean}
 */
const validateWardenEmail = (email) => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return WARDEN_ALLOWED_EMAILS.includes(normalized);
};

/**
 * Returns true if the email is allowed to access the Security Portal.
 * When SECURITY_ALLOWED_EMAILS is empty, any authenticated account is allowed EXCEPT student domains.
 * @param {string} email
 * @returns {boolean}
 */
const validateSecurityEmail = (email) => {
  if (!email) return false;
  if (validateStudentEmail(email)) return false; // Block student accounts
  if (SECURITY_ALLOWED_EMAILS.length === 0) return true; // Open — any other authenticated account
  return SECURITY_ALLOWED_EMAILS.includes(email.toLowerCase());
};

/**
 * Validate access for a given portal based on the authenticated email.
 * @param {string} portal  — 'student' | 'warden' | 'security'
 * @param {string} email
 * @returns {{ allowed: boolean, reason: string }}
 */
const validatePortalAccess = (portal, email) => {
  switch (portal) {
    case 'student': {
      const allowed = validateStudentEmail(email);
      return {
        allowed,
        reason: allowed
          ? 'ok'
          : `Student Portal is restricted to ${STUDENT_ALLOWED_DOMAINS.map((d) => `@${d}`).join(', ')} email addresses. Your account (${email}) is not permitted.`,
      };
    }
    case 'warden': {
      const allowed = validateWardenEmail(email);
      return {
        allowed,
        reason: allowed ? 'ok' : `Your account (${email}) is not authorized for the Hostel Staff Portal. Access is restricted to designated hostel staff members.`,
      };
    }
    case 'security': {
      const allowed = validateSecurityEmail(email);
      return {
        allowed,
        reason: allowed ? 'ok' : `Your account (${email}) is not authorized for the Security Portal.`,
      };
    }
    default:
      return { allowed: false, reason: 'Unknown portal specified.' };
  }
};

// ── Role mapping ──────────────────────────────────────────────────────────────
/**
 * Map portal name to user role stored in DB.
 * @param {string} portal
 * @returns {'student' | 'warden' | 'security'}
 */
const portalToRole = (portal) => {
  const map = { student: 'student', warden: 'warden', security: 'security' };
  return map[portal] || null;
};

module.exports = {
  STUDENT_ALLOWED_DOMAINS,
  WARDEN_ALLOWED_EMAILS,
  SECURITY_ALLOWED_EMAILS,
  validateStudentEmail,
  validateWardenEmail,
  validateSecurityEmail,
  validatePortalAccess,
  portalToRole,
};
