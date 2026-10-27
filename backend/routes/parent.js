/**
 * Parent Portal Routes
 *
 * Public Endpoints:
 *  GET  /api/parent/invitation/verify  - Verify token without consuming it (idempotent, Referrer-Policy: no-referrer)
 *  POST /api/parent/invitation/accept  - Activate parent account & set password
 *  POST /api/parent/login             - Password login for parents
 *  POST /api/parent/send-login-otp    - Send passwordless login OTP
 *  POST /api/parent/login-otp         - Passwordless OTP login
 *  POST /api/parent/forgot-password   - Request password reset link
 *  POST /api/parent/reset-password    - Set new password via reset token
 *
 * Protected Endpoints (protect, authorize('parent')):
 *  GET  /api/parent/me                - Current parent profile and ward summary
 *  GET  /api/parent/wards             - Details of linked students
 *  GET  /api/parent/requests          - Requests list for linked students
 *  GET  /api/parent/requests/:id      - Request detail view
 *  POST /api/parent/requests/:id/decision - Submit Approve/Reject decision
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const Guardian = require('../models/Guardian');
const HomeVisitLog = require('../models/HomeVisitLog');
const ParentApproval = require('../models/ParentApproval');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const { protect, authorize, invalidateUserCache } = require('../middleware/auth');
const {
  verifyInvitationToken,
  acceptInvitation,
} = require('../services/guardianService');
const {
  recordParentDecision,
} = require('../services/parentApprovalService');
const {
  sendParentResetPasswordEmail,
  sendParentLoginOtpEmail,
} = require('../services/mailService');
const logger = require('../utils/logger');
const { getCleanFrontendUrl } = require('../utils/frontendUrl');

// Security middleware to prevent token leakage via HTTP Referer header
router.use((req, res, next) => {
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15d' });

// ── GET /invitation/verify ───────────────────────────────────────────────────
// Idempotent inspection of the invitation link. DOES NOT CONSUME TOKEN.
router.get('/invitation/verify', async (req, res) => {
  try {
    const { token } = req.query;
    const result = await verifyInvitationToken(token);
    if (!result.valid) {
      return res.status(400).json({ success: false, message: result.message });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('[Parent] Verify token error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to verify invitation token' });
  }
});

// ── POST /invitation/accept ──────────────────────────────────────────────────
// Consumes single-use token and sets up parent account with password.
router.post('/invitation/accept', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and password are required' });
    }

    const { parentUser, guardian } = await acceptInvitation({
      rawToken: token,
      password,
      ip: req.ip,
    });

    const jwtToken = signToken(parentUser._id);
    return res.json({
      success: true,
      message: 'Account activated successfully. Welcome!',
      token: jwtToken,
      user: {
        id: parentUser._id,
        name: parentUser.name,
        email: parentUser.email,
        role: parentUser.role,
      },
    });
  } catch (err) {
    logger.error('[Parent] Accept invitation error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// Helper to resolve parent account or linked guardian account
const findParentOrGuardianUser = async (email) => {
  if (!email || typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalized, role: 'parent' });
  if (!user) {
    const guardian = await Guardian.findOne({
      email: normalized,
      status: { $ne: 'REVOKED' },
    });
    if (guardian) {
      user = await User.findOne({ email: normalized });
      if (!user) {
        // Auto-provision parent User account for invited guardian
        user = await User.create({
          name: guardian.name || 'Parent / Guardian',
          email: normalized,
          phone: guardian.phone || null,
          role: 'parent',
          isActive: true,
        });
      }
      if (!guardian.user_id) {
        guardian.user_id = user._id;
        if (guardian.status === 'INVITED') guardian.status = 'ACTIVE';
        guardian.linked_at = new Date();
        await guardian.save();
      }
    }
  }
  return user;
};

// ── POST /login ──────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await findParentOrGuardianUser(email);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.passwordHash) {
      return res.status(401).json({
        success: false,
        message: 'No password has been set for this account yet. Please use your onboarding link or click "Forgot password?".',
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = signToken(user._id);
    await invalidateUserCache(String(user._id));

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error('[Parent] Login error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ── POST /send-login-otp ─────────────────────────────────────────────────────
router.post('/send-login-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const user = await findParentOrGuardianUser(email);

    // Privacy requirement: do not leak whether email exists
    if (!user) {
      return res.json({ success: true, message: 'If registered, a login code has been sent to your email.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    user.loginOtpHash = otpHash;
    user.loginOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save();

    await sendParentLoginOtpEmail({
      to: user.email,
      name: user.name,
      otp,
    });

    await ApprovalAuditLog.create({
      event: 'LOGIN_OTP_SENT',
      actor_id: user._id,
      actor_role: 'parent',
      actor_email: user.email,
      ip_address: req.ip,
    });

    return res.json({ success: true, message: 'If registered, a login code has been sent to your email.' });
  } catch (err) {
    logger.error('[Parent] Send login OTP error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to dispatch login code' });
  }
});

// ── POST /login-otp ──────────────────────────────────────────────────────────
router.post('/login-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }

    const user = await findParentOrGuardianUser(email);

    if (!user || !user.loginOtpHash || !user.loginOtpExpires) {
      return res.status(401).json({ success: false, message: 'Invalid or expired login code' });
    }

    if (new Date() > new Date(user.loginOtpExpires)) {
      user.loginOtpHash = null;
      user.loginOtpExpires = null;
      await user.save();
      return res.status(401).json({ success: false, message: 'Login code has expired' });
    }

    const inputHash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    if (inputHash !== user.loginOtpHash) {
      return res.status(401).json({ success: false, message: 'Invalid login code' });
    }

    // Clean OTP
    user.loginOtpHash = null;
    user.loginOtpExpires = null;
    await user.save();

    const token = signToken(user._id);
    await invalidateUserCache(String(user._id));

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error('[Parent] OTP login error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ── POST /forgot-password ────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const user = await findParentOrGuardianUser(email);

    // Do not leak email existence
    if (!user) {
      return res.json({ success: true, message: 'If your email is registered, password reset instructions have been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const baseUrl = getCleanFrontendUrl();
    const resetUrl = `${baseUrl}/parent/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    await sendParentResetPasswordEmail({
      to: user.email,
      name: user.name,
      resetUrl,
    });

    return res.json({ success: true, message: 'If your email is registered, password reset instructions have been sent.' });
  } catch (err) {
    logger.error('[Parent] Forgot password error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to process request' });
  }
});

// ── POST /reset-password ─────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;
    if (!token || !email || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Valid token, email, and password (min 6 chars) are required' });
    }

    const tokenHash = crypto.createHash('sha256').update(String(token).trim()).digest('hex');
    const user = await findParentOrGuardianUser(email);

    if (
      !user ||
      user.resetPasswordToken !== tokenHash ||
      !user.resetPasswordExpires ||
      new Date() > new Date(user.resetPasswordExpires)
    ) {
      return res.status(400).json({ success: false, message: 'Invalid or expired password reset token' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    await invalidateUserCache(String(user._id));

    await ApprovalAuditLog.create({
      event: 'PASSWORD_RESET',
      actor_id: user._id,
      actor_role: 'parent',
      actor_email: user.email,
      ip_address: req.ip,
    });

    return res.json({ success: true, message: 'Password has been reset successfully. Please log in.' });
  } catch (err) {
    logger.error('[Parent] Reset password error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Password reset failed' });
  }
});

// ── Protected Parent Routes ──────────────────────────────────────────────────
router.use(protect, authorize('parent'));

// ── GET /me ──────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const parentUser = req.user;
    // Find all active guardians for this user or email (supports siblings)
    const guardians = await Guardian.find({
      $or: [{ user_id: parentUser._id }, { email: parentUser.email.toLowerCase() }],
      status: { $ne: 'REVOKED' },
    }).populate('student_id', 'name rollNo hostel roomNo branch year studentPhoto picture email phone');

    const wards = guardians
      .map((g) => g.student_id)
      .filter(Boolean);

    return res.json({
      success: true,
      parent: {
        id: parentUser._id,
        name: parentUser.name,
        email: parentUser.email,
        phone: parentUser.phone,
      },
      wardsCount: wards.length,
      wards,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /wards ───────────────────────────────────────────────────────────────
router.get('/wards', async (req, res) => {
  try {
    const parentUser = req.user;
    const guardians = await Guardian.find({
      $or: [{ user_id: parentUser._id }, { email: parentUser.email.toLowerCase() }],
      status: { $ne: 'REVOKED' },
    }).populate('student_id', 'name rollNo hostel roomNo branch year studentPhoto picture email phone');

    const wardsWithLeaves = await Promise.all(
      guardians.map(async (g) => {
        const student = g.student_id;
        if (!student) return null;
        const leaveCount = await HomeVisitLog.countDocuments({
          student_id: student._id,
          overall_status: 'completed',
        });
        const activeRequestsCount = await HomeVisitLog.countDocuments({
          student_id: student._id,
          parent_approval_status: 'pending',
        });
        return {
          student,
          relationship: g.relationship,
          slot: g.guardian_slot,
          leaveCount,
          activeRequestsCount,
        };
      })
    );

    return res.json({
      success: true,
      wards: wardsWithLeaves.filter(Boolean),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /requests ────────────────────────────────────────────────────────────
router.get('/requests', async (req, res) => {
  try {
    const parentUser = req.user;
    // 1. Get all ward student IDs
    const guardians = await Guardian.find({
      $or: [{ user_id: parentUser._id }, { email: parentUser.email.toLowerCase() }],
      status: { $ne: 'REVOKED' },
    }).select('student_id');

    const studentIds = guardians.map((g) => g.student_id).filter(Boolean);

    // 2. Fetch requests strictly isolated to these students
    const filter = { student_id: { $in: studentIds } };
    if (req.query.status === 'pending') {
      filter.parent_approval_status = 'pending';
    }

    const requests = await HomeVisitLog.find(filter)
      .populate('student_id', 'name rollNo hostel roomNo studentPhoto picture')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // Attach existing decision if any
    const requestIds = requests.map((r) => r._id);
    const approvals = await ParentApproval.find({ home_visit_request_id: { $in: requestIds } }).lean();
    const approvalMap = new Map();
    approvals.forEach((a) => {
      approvalMap.set(String(a.home_visit_request_id), a);
    });

    const enriched = requests.map((r) => ({
      ...r,
      approvalRecord: approvalMap.get(String(r._id)) || null,
    }));

    return res.json({
      success: true,
      requests: enriched,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /requests/:requestId ─────────────────────────────────────────────────
router.get('/requests/:requestId', async (req, res) => {
  try {
    const parentUser = req.user;
    const { requestId } = req.params;

    const visit = await HomeVisitLog.findById(requestId)
      .populate('student_id', 'name rollNo hostel roomNo branch year studentPhoto picture email phone')
      .lean();

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    // Authorization isolation check
    const studentId = visit.student_id?._id || visit.student_id;
    const guardian = await Guardian.findOne({
      student_id: studentId,
      $or: [{ user_id: parentUser._id }, { email: parentUser.email.toLowerCase() }],
      status: { $ne: 'REVOKED' },
    });

    if (!guardian) {
      return res.status(403).json({ success: false, message: 'Access denied: not an authorized guardian for this student' });
    }

    // Previous leave count
    const previousLeaveCount = await HomeVisitLog.countDocuments({
      student_id: studentId,
      overall_status: 'completed',
    });

    // Existing decisions
    const existingApprovals = await ParentApproval.find({ home_visit_request_id: requestId }).lean();

    return res.json({
      success: true,
      request: {
        ...visit,
        destination: visit.place,
        previousLeaveCount,
        approvals: existingApprovals,
        guardian: {
          id: guardian._id,
          name: guardian.name,
          relationship: guardian.relationship,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /requests/:requestId/decision ───────────────────────────────────────
router.post('/requests/:requestId/decision', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { decision, remarks } = req.body;

    const result = await recordParentDecision({
      visitId: requestId,
      parentUser: req.user,
      decision,
      remarks,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
    });

    return res.json({
      success: true,
      message: `Request successfully ${decision === 'APPROVED' ? 'approved' : 'rejected'}.`,
      ...result,
    });
  } catch (err) {
    logger.warn('[Parent] Decision error', { error: err.message });
    return res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
