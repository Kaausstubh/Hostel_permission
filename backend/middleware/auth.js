/**
 * JWT Authentication Middleware
 * Validates Bearer tokens and attaches user to request object.
 * Uses lean() for read performance — avoid full Mongoose document overhead.
 */

const jwt    = require('jsonwebtoken');
const User   = require('../models/User');

// Verify JWT and attach user to req
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // lean() returns a plain JS object — faster and uses less memory than
    // a full Mongoose Document for read-only middleware use cases.
    const user = await User.findById(decoded.id).select('-password').lean();
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

// Role-based access controller factory
// Usage: authorize('warden', 'security')
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized for this route`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
