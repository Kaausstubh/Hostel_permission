/**
 * GuardianInvitation Model
 * Stores single-use, cryptographically secure invitation tokens for parent onboarding.
 * Tokens are stored as SHA-256 hashes (never plaintext).
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const guardianInvitationSchema = new mongoose.Schema(
  {
    guardian_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guardian',
      required: true,
      index: true,
    },
    token_hash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    used_at: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

/**
 * Hash raw token using SHA-256
 * @param {string} rawToken
 * @returns {string} hex hash
 */
guardianInvitationSchema.statics.hashToken = function (rawToken) {
  return crypto.createHash('sha256').update(String(rawToken).trim()).digest('hex');
};

/**
 * Generate a new single-use 32-byte cryptographic invitation
 * @param {mongoose.Types.ObjectId} guardianId
 * @param {number} expiryDays - default 7 days
 * @returns {Promise<{ invitationDoc: Object, rawToken: string }>}
 */
guardianInvitationSchema.statics.createForGuardian = async function (guardianId, expiryDays = 7) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = this.hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  const invitationDoc = await this.create({
    guardian_id: guardianId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return { invitationDoc, rawToken };
};

module.exports = mongoose.model('GuardianInvitation', guardianInvitationSchema);
