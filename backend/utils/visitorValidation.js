/**
 * Visitor Validation and Normalization Utilities
 *
 * Rules:
 * 1. visitorCount: integer, min 1, max 20, default 1. Defensive string parsing.
 * 2. hasVehicle: boolean.
 * 3. vehicleNumber: Normalized (trim, uppercase, strip spaces and hyphens).
 *    Validated loosely: alphanumeric, 4-15 characters (/^[A-Z0-9]{4,15}$/).
 *    Required only when hasVehicle is true; ignored (null) when false.
 * 4. Safe log masking: Never log full phone or vehicle numbers.
 */

/**
 * Normalizes and loosely validates a vehicle registration number.
 * @param {string|null|undefined} raw
 * @param {boolean} hasVehicle
 * @returns {{ valid: boolean, normalized: string|null, error?: string }}
 */
function normalizeVehicleNumber(raw, hasVehicle = true) {
  if (!hasVehicle) {
    return { valid: true, normalized: null };
  }

  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return {
      valid: false,
      normalized: null,
      error: 'Vehicle number is required when bringing a vehicle.',
    };
  }

  // Trim, uppercase, strip spaces and hyphens
  const cleaned = String(raw).trim().toUpperCase().replace(/[\s-]/g, '');

  // Loosely validate alphanumeric, 4 to 15 characters
  const alphanumericRegex = /^[A-Z0-9]{4,15}$/;
  if (!alphanumericRegex.test(cleaned)) {
    return {
      valid: false,
      normalized: cleaned,
      error: 'Vehicle number must be 4-15 alphanumeric characters (e.g., MH12AB1234).',
    };
  }

  return { valid: true, normalized: cleaned };
}

/**
 * Defensively parses and validates visitor count.
 * Handles strings from Google Forms or direct API payloads.
 * @param {string|number|undefined|null} raw
 * @returns {{ valid: boolean, count: number, error?: string }}
 */
function parseVisitorCount(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { valid: true, count: 1 };
  }

  const str = String(raw).trim();
  const parsed = parseInt(str, 10);

  if (Number.isNaN(parsed)) {
    return {
      valid: false,
      count: 1,
      error: 'Visitor count must be a valid number between 1 and 20.',
    };
  }

  if (parsed < 1) {
    return {
      valid: false,
      count: 1,
      error: 'Visitor count must be at least 1.',
    };
  }

  if (parsed > 20) {
    return {
      valid: false,
      count: 20,
      error: 'Visitor count cannot exceed 20 people per entry pass.',
    };
  }

  return { valid: true, count: parsed };
}

/**
 * Safely parses boolean values from form responses or API flags.
 * @param {any} raw
 * @returns {boolean}
 */
function parseBoolean(raw) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (!raw) return false;
  const str = String(raw).trim().toLowerCase();
  return str === 'true' || str === 'yes' || str === 'y' || str === '1';
}

/**
 * Mask phone number for secure logging (e.g. "+91 98****3210" or "98****3210")
 * @param {string|null|undefined} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone) return 'N/A';
  const str = String(phone).trim();
  if (str.length <= 4) return '****';
  return `${str.slice(0, 3)}****${str.slice(-3)}`;
}

/**
 * Mask vehicle number for secure logging (e.g. "MH****1234")
 * @param {string|null|undefined} vehicleNumber
 * @returns {string}
 */
function maskVehicle(vehicleNumber) {
  if (!vehicleNumber) return 'None';
  const str = String(vehicleNumber).trim();
  if (str.length <= 4) return '****';
  return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

module.exports = {
  normalizeVehicleNumber,
  parseVisitorCount,
  parseBoolean,
  maskPhone,
  maskVehicle,
};
