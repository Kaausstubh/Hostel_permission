/**
 * Guardian Service
 * Handles guardian creation, single-use token invitations, activation, sibling linking,
 * rate-limited resends, and admin/warden updates with full audit trails.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const Guardian = require('../models/Guardian');
const GuardianInvitation = require('../models/GuardianInvitation');
const User = require('../models/User');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const { sendGuardianInviteEmail } = require('./mailService');
const { validateIndianPhone } = require('../utils/phone');
const { getCleanFrontendUrl } = require('../utils/frontendUrl');
const logger = require('../utils/logger');

// Allowed college domains configuration
const getAllowedCollegeDomains = () => {
  const envVal = process.env.ALLOWED_COLLEGE_EMAIL_DOMAINS || 'iiitpune.ac.in,cse.iiitp.ac.in,ece.iiitp.ac.in,cysec.iiitp.ac.in,aids.iiitp.ac.in,mevd.iiitp.ac.in,iiitp.ac.in,college.edu';
  return envVal
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
};

const validateCollegeDomain = (email) => {
  if (!email || typeof email !== 'string') return false;
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return false;
  const domain = parts[1];
  const allowed = getAllowedCollegeDomains();
  return allowed.includes(domain);
};

const validateParentEmail = (email) => {
  if (!email || typeof email !== 'string') return { valid: false, error: 'Email is required' };
  const normalized = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    return { valid: false, error: 'Invalid email address format' };
  }
  const domain = normalized.split('@')[1];
  const allowed = getAllowedCollegeDomains();
  if (allowed.includes(domain)) {
    return {
      valid: false,
      error: `Parent email cannot use a college domain (@${domain}). Please provide a personal email address.`,
    };
  }
  return { valid: true };
};

/**
 * Validate the registration guardian input contract
 */
const validateGuardianInputs = ({ studentPhone, studentEmail, guardian1, guardian2 }) => {
  if (!guardian1 || !guardian1.name || !guardian1.phone || !guardian1.email) {
    throw new Error('Guardian 1 details (name, phone, personal email) are mandatory');
  }

  // 1. Phone validation
  const spCheck = validateIndianPhone(studentPhone, 'Student Phone');
  if (!spCheck.valid) throw new Error(spCheck.error);

  const g1pCheck = validateIndianPhone(guardian1.phone, 'Guardian 1 Phone');
  if (!g1pCheck.valid) throw new Error(g1pCheck.error);

  const p1 = g1pCheck.digits10;
  const sp = spCheck.digits10;

  if (sp === p1) {
    throw new Error('Student phone number cannot be the same as any guardian phone number');
  }

  const hasGuardian2 = Boolean(guardian2 && (guardian2.name || guardian2.phone || guardian2.email));
  let g2pCheck = null;

  if (hasGuardian2) {
    g2pCheck = validateIndianPhone(guardian2.phone, 'Guardian 2 Phone');
    if (!g2pCheck.valid) throw new Error(g2pCheck.error);

    const p2 = g2pCheck.digits10;
    if (sp === p2) {
      throw new Error('Student phone number cannot be the same as any guardian phone number');
    }
    if (p1 === p2) {
      throw new Error('Guardian 1 phone and Guardian 2 phone must be distinct');
    }
  }

  // 2. Email validation
  const normSE = (studentEmail || '').trim().toLowerCase();
  const normG1E = (guardian1.email || '').trim().toLowerCase();

  const g1eCheck = validateParentEmail(normG1E);
  if (!g1eCheck.valid) throw new Error(`Guardian 1: ${g1eCheck.error}`);

  if (normSE === normG1E) {
    throw new Error('Parent emails cannot be identical to the student email');
  }

  let normG2E = null;
  if (hasGuardian2) {
    normG2E = (guardian2.email || '').trim().toLowerCase();
    const g2eCheck = validateParentEmail(normG2E);
    if (!g2eCheck.valid) throw new Error(`Guardian 2: ${g2eCheck.error}`);

    if (normSE === normG2E) {
      throw new Error('Parent emails cannot be identical to the student email');
    }
    if (normG1E === normG2E) {
      throw new Error('Guardian 1 email and Guardian 2 email must be distinct from each other');
    }
  }

  return {
    studentPhoneE164: spCheck.e164,
    g1PhoneE164: g1pCheck.e164,
    g2PhoneE164: g2pCheck ? g2pCheck.e164 : null,
    normG1E,
    normG2E,
  };
};

/**
 * Link initial guardians for a student.
 * Rule: Students can submit guardian details ONLY when none exist.
 */
const linkInitialGuardians = async ({ studentId, guardian1, guardian2, ip = '', actorId = null }) => {
  const existingGuardians = await Guardian.find({ student_id: studentId });
  const hasActiveGuardian = existingGuardians.some((g) => g.status === 'ACTIVE');
  const isSelf = actorId && String(actorId) === String(studentId);

  // If student already has a verified active guardian, require warden for changes
  if (hasActiveGuardian && isSelf) {
    throw new Error('A verified guardian account is already active for your profile. Please contact the Hostel Warden to update your registered guardian details.');
  }

  // Clean up any previous unactivated or stale guardian records before re-linking
  if (existingGuardians.length > 0) {
    const existingIds = existingGuardians.map((g) => g._id);
    await GuardianInvitation.deleteMany({ guardian_id: { $in: existingIds } });
    await Guardian.deleteMany({ _id: { $in: existingIds } });
  }

  const student = await User.findById(studentId);
  if (!student) throw new Error('Student record not found');

  const { g1PhoneE164, g2PhoneE164, normG1E, normG2E } = validateGuardianInputs({
    studentPhone: student.phone,
    studentEmail: student.email,
    guardian1,
    guardian2,
  });

  // Check if parents already have an activated parent user account with a password (Sibling support)
  const existingUser1 = await User.findOne({ email: normG1E, role: 'parent', passwordHash: { $exists: true, $ne: null } });
  const existingUser2 = normG2E
    ? await User.findOne({ email: normG2E, role: 'parent', passwordHash: { $exists: true, $ne: null } })
    : null;

  // Create Guardian 1
  const g1 = await Guardian.create({
    student_id: studentId,
    guardian_slot: 1,
    name: guardian1.name.trim(),
    relationship: guardian1.relationship,
    phone: g1PhoneE164,
    email: normG1E,
    status: existingUser1 ? 'ACTIVE' : 'INVITED',
    linked_at: existingUser1 ? new Date() : null,
    user_id: existingUser1 ? existingUser1._id : null,
    last_invite_sent_at: new Date(),
  });

  // Create Guardian 2 if provided
  let g2 = null;
  if (normG2E && g2PhoneE164 && guardian2?.name) {
    g2 = await Guardian.create({
      student_id: studentId,
      guardian_slot: 2,
      name: guardian2.name.trim(),
      relationship: guardian2.relationship,
      phone: g2PhoneE164,
      email: normG2E,
      status: existingUser2 ? 'ACTIVE' : 'INVITED',
      linked_at: existingUser2 ? new Date() : null,
      user_id: existingUser2 ? existingUser2._id : null,
      last_invite_sent_at: new Date(),
    });
  }

  // Persist parent contact details on student document for instant lookups & notifications
  student.parentPhone = g1PhoneE164;
  student.parentEmail = normG1E;
  student.parentName = guardian1.name.trim();
  if (g2PhoneE164) {
    student.parentPhone2 = g2PhoneE164;
  }
  await student.save();

  const baseUrl = getCleanFrontendUrl();
  const inviteUrls = {};

  // Issue invitations and send emails
  const sendInviteFor = async (guardian, existingUser) => {
    if (!guardian) return;
    if (existingUser) {
      // Sibling parent already active — notify them
      logger.info(`[GuardianService] Guardian ${guardian.email} already has account — linked to sibling ${student.name}`);
      await ApprovalAuditLog.create({
        event: 'PARENT_ACTIVATED',
        student_id: studentId,
        guardian_id: guardian._id,
        actor_id: actorId || studentId,
        actor_role: 'system',
        actor_email: guardian.email,
        ip_address: ip,
        details: { note: 'Auto-linked to existing parent account for sibling' },
      });

      const { sendWardenNoticeEmail } = require('./mailService');
      await sendWardenNoticeEmail({
        to: guardian.email,
        recipientName: guardian.name,
        subject: `HEIMDALL: Student ${student.name} Linked to Your Parent Account`,
        messageContent: `Hello ${guardian.name},\n\nYour ward ${student.name} (${student.rollNo || 'Student'}) has linked you as their authorized guardian on the HEIMDALL Smart Campus platform.\n\nYou can log in with your existing parent credentials to review and approve their leave requests:\n${baseUrl}/parent/login\n\nRegards,\nCampus Hostel Administration`,
        wardenName: 'Campus Administration',
      }).catch((e) => logger.warn('[GuardianService] Sibling notification failed:', e.message));
      return;
    }

    const { rawToken } = await GuardianInvitation.createForGuardian(guardian._id, 7);
    const inviteUrl = `${baseUrl}/parent/onboard?token=${rawToken}`;
    inviteUrls[guardian._id.toString()] = inviteUrl;

    await ApprovalAuditLog.create({
      event: 'INVITE_SENT',
      student_id: studentId,
      guardian_id: guardian._id,
      actor_id: actorId || studentId,
      actor_role: actorId ? 'staff' : 'student',
      actor_email: guardian.email,
      ip_address: ip,
      details: { guardian_slot: guardian.guardian_slot, inviteUrl },
    });

    try {
      const emailRes = await sendGuardianInviteEmail({
        to: guardian.email,
        guardianName: guardian.name,
        studentName: student.name,
        collegeName: 'IIIT Campus',
        inviteUrl,
        expiryDays: 7,
      });
      if (emailRes && emailRes.success === false && !emailRes.mocked) {
        logger.error(`[GuardianService] Live invite email failed for ${guardian.email}: ${emailRes.error}`);
      }
    } catch (err) {
      logger.error(`[GuardianService] Failed to send email invite to ${guardian.email}`, { error: err.message });
    }
  };

  await sendInviteFor(g1, existingUser1);
  if (g2) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await sendInviteFor(g2, existingUser2);
  }

  return { guardian1: g1, guardian2: g2, inviteUrls };
};

/**
 * Verify invitation token without consuming it (Idempotent GET check).
 */
const verifyInvitationToken = async (rawToken) => {
  if (!rawToken || typeof rawToken !== 'string') {
    return { valid: false, message: 'Invitation token is missing' };
  }

  const tokenHash = GuardianInvitation.hashToken(rawToken);
  const invitation = await GuardianInvitation.findOne({
    token_hash: tokenHash,
    used_at: null,
    expires_at: { $gt: new Date() },
  }).populate({
    path: 'guardian_id',
    populate: { path: 'student_id', select: 'name rollNo hostel roomNo branch email' },
  });

  if (!invitation || !invitation.guardian_id) {
    return { valid: false, message: 'Invitation link is invalid, expired, or already used' };
  }

  const guardian = invitation.guardian_id;
  const student = guardian.student_id;

  return {
    valid: true,
    guardian: {
      id: guardian._id,
      name: guardian.name,
      email: guardian.email,
      phone: guardian.phone,
      relationship: guardian.relationship,
    },
    student: {
      name: student?.name || 'Student',
      rollNo: student?.rollNo || 'N/A',
      hostel: student?.hostel || 'N/A',
      roomNo: student?.roomNo || 'N/A',
    },
    expiresAt: invitation.expires_at,
  };
};

/**
 * Accept invitation and activate parent account (Consumes single-use token).
 */
const acceptInvitation = async ({ rawToken, password, ip = '' }) => {
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const tokenHash = GuardianInvitation.hashToken(rawToken);

  // Atomic conditional update to prevent double-consumption race conditions
  const invitation = await GuardianInvitation.findOneAndUpdate(
    {
      token_hash: tokenHash,
      used_at: null,
      expires_at: { $gt: new Date() },
    },
    { $set: { used_at: new Date() } },
    { new: true }
  ).populate('guardian_id');

  if (!invitation || !invitation.guardian_id) {
    throw new Error('Invitation link has expired or has already been used');
  }

  const guardian = invitation.guardian_id;
  const studentId = guardian.student_id;

  // Check if a parent user already exists for this email
  let parentUser = await User.findOne({ email: guardian.email });
  const passwordHash = await bcrypt.hash(password, 10);

  if (parentUser) {
    parentUser.passwordHash = passwordHash;
    parentUser.role = 'parent';
    parentUser.isActive = true;
    await parentUser.save();
  } else {
    parentUser = await User.create({
      name: guardian.name,
      email: guardian.email,
      phone: guardian.phone,
      role: 'parent',
      passwordHash,
      isActive: true,
      isEmailVerified: true,
    });
  }

  // Update guardian status to ACTIVE
  guardian.status = 'ACTIVE';
  guardian.linked_at = new Date();
  guardian.user_id = parentUser._id;
  await guardian.save();

  // Also link any other guardian records with this same email (Siblings)
  await Guardian.updateMany(
    { email: guardian.email, status: 'INVITED' },
    { $set: { status: 'ACTIVE', linked_at: new Date(), user_id: parentUser._id } }
  );

  await ApprovalAuditLog.create({
    event: 'PARENT_ACTIVATED',
    student_id: studentId,
    guardian_id: guardian._id,
    actor_id: parentUser._id,
    actor_role: 'parent',
    actor_email: guardian.email,
    ip_address: ip,
    details: { note: 'Parent activated account via invitation link' },
  });

  return { parentUser, guardian };
};

/**
 * Resend invite to an invited guardian with rate limiting (max once per 2 minutes)
 */
const resendInvitation = async ({ guardianId, actorUser, ip = '' }) => {
  const guardian = await Guardian.findById(guardianId).populate('student_id');
  if (!guardian) throw new Error('Guardian record not found');
  if (guardian.status === 'ACTIVE') {
    throw new Error('This guardian is already active. They can log in directly.');
  }

  const now = Date.now();
  if (guardian.last_invite_sent_at && now - new Date(guardian.last_invite_sent_at).getTime() < 120_000) {
    const waitSec = Math.ceil((120_000 - (now - new Date(guardian.last_invite_sent_at).getTime())) / 1000);
    throw new Error(`Rate limit exceeded. Please wait ${waitSec}s before resending.`);
  }

  // Revoke older unconsumed invitations
  await GuardianInvitation.updateMany(
    { guardian_id: guardianId, used_at: null },
    { $set: { used_at: new Date() } }
  );

  const { rawToken } = await GuardianInvitation.createForGuardian(guardianId, 7);
  const baseUrl = getCleanFrontendUrl();
  const inviteUrl = `${baseUrl}/parent/onboard?token=${rawToken}`;

  guardian.last_invite_sent_at = new Date();
  await guardian.save();

  const mailResult = await sendGuardianInviteEmail({
    to: guardian.email,
    guardianName: guardian.name,
    studentName: guardian.student_id?.name || 'Student',
    collegeName: 'IIIT Campus',
    inviteUrl,
    expiryDays: 7,
  });

  if (mailResult && mailResult.success === false && !mailResult.mocked) {
    throw new Error(mailResult.error || 'Failed to dispatch invitation email');
  }

  await ApprovalAuditLog.create({
    event: 'INVITE_RESENT',
    student_id: guardian.student_id?._id || null,
    guardian_id: guardian._id,
    actor_id: actorUser._id,
    actor_role: actorUser.role,
    actor_email: actorUser.email,
    ip_address: ip,
    details: { inviteUrl },
  });

  return { success: true, inviteUrl };
};

/**
 * Update guardian details by Warden/Admin
 * If email is changed: revoke old invitation, reset status to INVITED, and issue new invite.
 */
const updateGuardianDetails = async ({ guardianId, updates, actorUser, ip = '' }) => {
  const guardian = await Guardian.findById(guardianId).populate('student_id');
  if (!guardian) throw new Error('Guardian record not found');

  const before = {
    name: guardian.name,
    phone: guardian.phone,
    email: guardian.email,
    relationship: guardian.relationship,
    status: guardian.status,
  };

  let emailChanged = false;
  if (updates.email && updates.email.trim().toLowerCase() !== guardian.email) {
    const emailCheck = validateParentEmail(updates.email);
    if (!emailCheck.valid) throw new Error(emailCheck.error);

    // Ensure distinct from other guardian of same student
    const siblingGuardian = await Guardian.findOne({
      student_id: guardian.student_id._id,
      _id: { $ne: guardian._id },
      email: updates.email.trim().toLowerCase(),
    });
    if (siblingGuardian) {
      throw new Error('Guardian 1 and Guardian 2 cannot have the same email address');
    }

    guardian.email = updates.email.trim().toLowerCase();
    emailChanged = true;
  }

  if (updates.name) guardian.name = updates.name.trim();
  if (updates.relationship) guardian.relationship = updates.relationship;
  if (updates.phone) {
    const phoneCheck = validateIndianPhone(updates.phone, 'Guardian Phone');
    if (!phoneCheck.valid) throw new Error(phoneCheck.error);
    guardian.phone = phoneCheck.e164;
  }

  if (emailChanged) {
    // Revoke previous invitations
    await GuardianInvitation.updateMany(
      { guardian_id: guardian._id, used_at: null },
      { $set: { used_at: new Date() } }
    );
    guardian.status = 'INVITED';
    guardian.linked_at = null;
    guardian.user_id = null;
    guardian.last_invite_sent_at = new Date();
  }

  await guardian.save();

  // If email changed, immediately issue new invitation email
  if (emailChanged) {
    const { rawToken } = await GuardianInvitation.createForGuardian(guardian._id, 7);
    const baseUrl = getCleanFrontendUrl();
    const inviteUrl = `${baseUrl}/parent/onboard?token=${rawToken}`;

    await sendGuardianInviteEmail({
      to: guardian.email,
      guardianName: guardian.name,
      studentName: guardian.student_id?.name || 'Student',
      collegeName: 'IIIT Campus',
      inviteUrl,
      expiryDays: 7,
    });
  }

  await ApprovalAuditLog.create({
    event: 'GUARDIAN_UPDATED',
    student_id: guardian.student_id?._id || null,
    guardian_id: guardian._id,
    actor_id: actorUser._id,
    actor_role: actorUser.role,
    actor_email: actorUser.email,
    ip_address: ip,
    details: { before, after: { name: guardian.name, phone: guardian.phone, email: guardian.email, relationship: guardian.relationship }, emailChanged },
  });

  return guardian;
};

module.exports = {
  getAllowedCollegeDomains,
  validateCollegeDomain,
  validateParentEmail,
  validateGuardianInputs,
  linkInitialGuardians,
  verifyInvitationToken,
  acceptInvitation,
  resendInvitation,
  updateGuardianDetails,
};
