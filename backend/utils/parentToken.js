/**
 * Parent Approval Token Utility
 * Generates cryptographically secure, high-entropy tokens and SHA-256 hashes.
 * Plaintext tokens are NEVER stored in the database.
 */

const crypto = require('crypto');

/**
 * Generate a new random 32-byte approval token and its SHA-256 hash.
 * @param {number} [expiryHours] Configurable token lifetime in hours (default: 48h)
 * @returns {{ rawToken: string, tokenHash: string, expiresAt: Date }}
 */
function generateParentApprovalToken(expiryHours) {
  const hours = Number(expiryHours) || Number(process.env.PARENT_APPROVAL_EXPIRY_HOURS) || 48;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashParentToken(rawToken);
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);

  return {
    rawToken,
    tokenHash,
    expiresAt,
  };
}

/**
 * Computes a SHA-256 hash of a raw token string.
 * @param {string} rawToken
 * @returns {string}
 */
function hashParentToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return '';
  }
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Constant-time comparison between two hashes to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function verifyTokenHash(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  generateParentApprovalToken,
  hashParentToken,
  verifyTokenHash,
};
