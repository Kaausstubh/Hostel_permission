/**
 * Phone utilities
 * Normalizes commonly-entered Indian numbers to E.164.
 *
 * Accepts:
 * - "+919876543210"
 * - "919876543210"
 * - "09876543210"
 * - "9876543210"
 *
 * Returns:
 * - "+919876543210"
 * - or original string trimmed if it can't be normalized safely.
 */
function normalizeToE164(input, { defaultCountryCode = '+91' } = {}) {
  if (!input) return input;
  const raw = String(input).trim();
  if (!raw) return raw;

  // Already E.164-ish
  if (raw.startsWith('+') && raw.length >= 8) return raw;

  // Keep digits only for normalization attempts
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return raw;

  // 10-digit Indian mobile number
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;

  // "91" + 10 digits
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;

  // Leading 0 + 10 digits
  if (digits.length === 11 && digits.startsWith('0')) return `${defaultCountryCode}${digits.slice(1)}`;

  // Fallback: if it looks like a full country-code number but missing '+'
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return raw;
}

module.exports = { normalizeToE164 };

