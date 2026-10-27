/**
 * Frontend URL Resolver Utility
 *
 * Resolves the public frontend origin for user-facing links
 * (parent email approval links, guardian invites, auth redirects, etc.).
 *
 * Guarantees that links never mistakenly point to the Render backend API domain
 * or backend internal ports.
 */

function getCleanFrontendUrl(customBaseUrl) {
  const candidate = (customBaseUrl || process.env.APP_BASE_URL || process.env.FRONTEND_URL || '').split(',')[0].trim();

  // If candidate is empty or mistakenly points to the backend (Render API domain or internal ports 5000/5001)
  if (!candidate || candidate.includes('onrender.com') || candidate.includes(':5001') || candidate.includes(':5000')) {
    return process.env.NODE_ENV === 'development'
      ? 'http://localhost:5173'
      : 'https://iiitpune-hosteel-gate-management.vercel.app';
  }

  return candidate.replace(/\/+$/, '');
}

module.exports = {
  getCleanFrontendUrl,
};
