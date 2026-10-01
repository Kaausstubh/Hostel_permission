/**
 * Frontend Phone utilities & validation
 * Normalizes and validates Indian mobile numbers.
 *
 * Accepted formats:
 * - 10 digits: "9876543210"
 * - +91 and 10 digits: "+919876543210"
 * - +91 then single space then 10 digits: "+91 9876543210"
 * - Leading 0 (11 digits): "09876543210"
 * - 91 without plus (12 digits): "919876543210"
 */

export function validateIndianPhone(input, label = 'Phone number') {
  if (!input || !String(input).trim()) {
    return { valid: false, error: `${label} is required.` };
  }

  const raw = String(input).trim();

  // Check for invalid characters (only digits, +, and space allowed)
  if (/[^\d+\s]/.test(raw)) {
    return {
      valid: false,
      error: `${label} contains invalid characters. Allowed formats: 10 digits, +91XXXXXXXXXX, or +91 XXXXXXXXXX.`,
    };
  }

  let digits10 = '';

  if (raw.startsWith('+')) {
    if (!raw.startsWith('+91')) {
      return {
        valid: false,
        error: `${label} must use India country code +91 (e.g. +91 9876543210 or +919876543210).`,
      };
    }

    const rest = raw.slice(3);
    // Allow either direct digits or a single space followed by digits
    if (!/^\s?\d+$/.test(rest)) {
      return {
        valid: false,
        error: `${label} format is invalid. Allowed: "+91" directly followed by 10 digits, or "+91 " with a single space.`,
      };
    }

    const cleanedRest = rest.trim();
    if (cleanedRest.length < 10) {
      return {
        valid: false,
        error: `${label} is too short (${cleanedRest.length}/10 digits). Must be a 10-digit mobile number.`,
      };
    }
    if (cleanedRest.length > 10) {
      return {
        valid: false,
        error: `${label} is too long (${cleanedRest.length}/10 digits). Please enter a 10-digit mobile number.`,
      };
    }

    digits10 = cleanedRest;
  } else {
    if (raw.includes('+')) {
      return {
        valid: false,
        error: `${label}: "+" is only allowed at the beginning as "+91".`,
      };
    }

    if (raw.includes(' ')) {
      return {
        valid: false,
        error: `${label} should not contain spaces unless preceded by "+91 ".`,
      };
    }

    const allDigits = raw.replace(/\D/g, '');
    if (allDigits.length === 12 && allDigits.startsWith('91')) {
      digits10 = allDigits.slice(2);
    } else if (allDigits.length === 11 && allDigits.startsWith('0')) {
      digits10 = allDigits.slice(1);
    } else {
      digits10 = allDigits;
    }

    if (digits10.length < 10) {
      return {
        valid: false,
        error: `${label} is too short (${digits10.length}/10 digits). Must be a 10-digit mobile number.`,
      };
    }
    if (digits10.length > 10) {
      return {
        valid: false,
        error: `${label} is too long (${digits10.length}/10 digits). Must be a 10-digit mobile number.`,
      };
    }
  }

  // Check valid Indian mobile starting digit (6, 7, 8, or 9)
  if (!/^[6-9]/.test(digits10)) {
    return {
      valid: false,
      error: `${label} must start with 6, 7, 8, or 9 (standard Indian mobile number series).`,
    };
  }

  return {
    valid: true,
    digits10,
    e164: `+91${digits10}`,
  };
}
