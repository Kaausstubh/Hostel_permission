/**
 * Parent Approval Service
 * Core business engine for parent approvals, policy execution (ANY_ONE vs ALL),
 * conditional atomic concurrency, append-only audit logging, and staff phone overrides.
 */

const mongoose = require('mongoose');
const HomeVisitLog = require('../models/HomeVisitLog');
const Guardian = require('../models/Guardian');
const ParentApproval = require('../models/ParentApproval');
const ApprovalAuditLog = require('../models/ApprovalAuditLog');
const User = require('../models/User');
const GatePass = require('../models/GatePass');
const { issueHomeVisitGatePass } = require('./homeVisitQrService');
const { sendLeaveOutcomeEmailToStudent } = require('./mailService');
const logger = require('../utils/logger');

const getApprovalPolicy = () => {
  return (process.env.PARENT_APPROVAL_POLICY || 'ANY_ONE').toUpperCase();
};

/**
 * Record a parent's digital decision via Parent Portal
 */
const recordParentDecision = async ({ visitId, parentUser, decision, remarks = '', ip = '', userAgent = '' }) => {
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new Error("Decision must be either 'APPROVED' or 'REJECTED'");
  }

  const visit = await HomeVisitLog.findById(visitId).populate('student_id');
  if (!visit) {
    throw new Error('Home visit request not found');
  }

  // 1. Strict Authorization Isolation:
  // Verify that parentUser is an active guardian linked to this specific student
  const studentId = visit.student_id?._id || visit.student_id;
  const guardian = await Guardian.findOne({
    student_id: studentId,
    $or: [
      { user_id: parentUser._id },
      { email: parentUser.email.toLowerCase() },
    ],
  });

  if (!guardian) {
    throw new Error('Unauthorized: You are not registered as an authorized guardian for this student');
  }

  // 2. Pre-check: Has staff override already finalized this?
  if (visit.parent_decision_source === 'STAFF_PHONE_OVERRIDE') {
    throw new Error('This request has already been processed via Hostel Staff Phone Confirmation.');
  }

  // 3. Pre-check: Has this guardian already submitted for this request?
  const existingDecisionByGuardian = await ParentApproval.findOne({
    home_visit_request_id: visit._id,
    guardian_id: guardian._id,
  });
  if (existingDecisionByGuardian) {
    throw new Error('You have already submitted your decision for this request.');
  }

  const cleanRemarks = String(remarks || '').trim().slice(0, 500);
  const policy = getApprovalPolicy();

  // ── ANY_ONE Policy (Default) ────────────────────────────────────────────────
  if (policy === 'ANY_ONE') {
    // Conditional atomic update on parent_approval_status === 'pending'
    const finalParentStatus = decision === 'APPROVED' ? 'parent_approved' : 'parent_rejected';
    const finalOverallStatus = decision === 'APPROVED' ? 'approved' : 'rejected';

    const updatedVisit = await HomeVisitLog.findOneAndUpdate(
      {
        _id: visitId,
        parent_approval_status: 'pending',
      },
      {
        $set: {
          parent_approval_status: finalParentStatus,
          overall_status: finalOverallStatus,
          warden_status: decision === 'APPROVED' ? 'approved' : 'rejected',
          warden_response_time: new Date(),
          parent_decision_source: 'PARENT_PORTAL',
          final_parent_decision_at: new Date(),
        },
      },
      { new: true }
    );

    if (!updatedVisit) {
      // Race condition: another parent or staff override completed the request in the exact same moment
      const latest = await HomeVisitLog.findById(visitId);
      if (latest?.parent_decision_source === 'STAFF_PHONE_OVERRIDE') {
        throw new Error('This request was already finalized via Hostel Staff Phone Confirmation.');
      }
      const existingApproval = await ParentApproval.findOne({ home_visit_request_id: visitId }).sort({ decided_at: 1 });
      const decider = existingApproval?.decided_by_name || 'the other guardian';
      throw new Error(`This request has already been decided by ${decider}.`);
    }

    if (decision === 'APPROVED') {
      const visitLean = updatedVisit.toObject ? updatedVisit.toObject() : updatedVisit;
      visitLean.student_id = visit.student_id;
      const qrPass = await issueHomeVisitGatePass(visitLean).catch((err) => {
        logger.warn('[ParentApproval] QR gate pass issuance error:', err.message);
        return null;
      });
      if (qrPass?.token && qrPass.token !== updatedVisit.qr_token) {
        updatedVisit.qr_token = qrPass.token;
        await HomeVisitLog.updateOne({ _id: updatedVisit._id }, { qr_token: qrPass.token });
      }
      await GatePass.updateOne(
        { home_visit_id: updatedVisit._id },
        { status: 'APPROVED', qr_token: qrPass?.token || updatedVisit.qr_token }
      ).catch(() => {});
    } else {
      await GatePass.updateOne(
        { home_visit_id: updatedVisit._id },
        { status: 'REJECTED' }
      ).catch(() => {});
    }

    // Create append-only audit record
    const approvalRecord = await ParentApproval.create({
      home_visit_request_id: visit._id,
      student_id: studentId,
      guardian_id: guardian._id,
      decision,
      decided_at: new Date(),
      decided_by_email: guardian.email,
      decided_by_name: guardian.name,
      decided_by_phone: guardian.phone,
      remarks: cleanRemarks,
      decision_source: 'PARENT_PORTAL',
      ip_address: ip,
      user_agent: userAgent,
    });

    await ApprovalAuditLog.create({
      event: 'DECISION_MADE',
      home_visit_request_id: visit._id,
      student_id: studentId,
      guardian_id: guardian._id,
      actor_id: parentUser._id,
      actor_role: 'parent',
      actor_email: guardian.email,
      ip_address: ip,
      details: { decision, remarks: cleanRemarks, policy: 'ANY_ONE' },
    });

    // If approved, issue scannable QR gate pass immediately; if rejected, cancel GatePass
    if (decision === 'APPROVED') {
      try {
        const passLean = updatedVisit.toObject ? updatedVisit.toObject() : { ...updatedVisit };
        passLean.student_id = visit.student_id;
        const { token } = await issueHomeVisitGatePass(passLean);
        updatedVisit.qr_token = token;
        await GatePass.updateOne(
          { home_visit_id: updatedVisit._id },
          { $set: { status: 'PENDING', qr_token: token } }
        ).catch(() => {});
      } catch (passErr) {
        logger.warn('[ParentApproval] GatePass generation notice:', { error: passErr.message });
      }
    } else {
      await GatePass.updateOne(
        { home_visit_id: updatedVisit._id },
        { $set: { status: 'CANCELLED' } }
      ).catch(() => {});
    }

    // Notify student via email
    if (visit.student_id?.email) {
      sendLeaveOutcomeEmailToStudent({
        to: visit.student_id.email,
        studentName: visit.student_id.name || visit.name,
        decision,
        parentName: guardian.name,
        remarks: cleanRemarks,
        place: visit.place,
        leaveDate: visit.leave_date,
        returnDate: visit.return_date,
      }).catch((e) => logger.warn('[ParentApproval] Email notification to student failed:', e.message));
    }

    return { success: true, decision, visit: updatedVisit, approval: approvalRecord };
  }

  // ── ALL Policy ──────────────────────────────────────────────────────────────
  // In ALL policy: any REJECT rejects immediately. Both must APPROVE to pass.
  if (decision === 'REJECTED') {
    const updatedVisit = await HomeVisitLog.findOneAndUpdate(
      { _id: visitId, parent_approval_status: 'pending' },
      {
        $set: {
          parent_approval_status: 'parent_rejected',
          overall_status: 'rejected',
          warden_status: 'rejected',
          warden_response_time: new Date(),
          parent_decision_source: 'PARENT_PORTAL',
          final_parent_decision_at: new Date(),
        },
      },
      { new: true }
    );
    await GatePass.updateOne({ home_visit_id: visitId }, { status: 'CANCELLED' }).catch(() => {});

    const approvalRecord = await ParentApproval.create({
      home_visit_request_id: visit._id,
      student_id: studentId,
      guardian_id: guardian._id,
      decision: 'REJECTED',
      decided_at: new Date(),
      decided_by_email: guardian.email,
      decided_by_name: guardian.name,
      decided_by_phone: guardian.phone,
      remarks: cleanRemarks,
      decision_source: 'PARENT_PORTAL',
      ip_address: ip,
      user_agent: userAgent,
    });

    await ApprovalAuditLog.create({
      event: 'DECISION_MADE',
      home_visit_request_id: visit._id,
      student_id: studentId,
      guardian_id: guardian._id,
      actor_id: parentUser._id,
      actor_role: 'parent',
      actor_email: guardian.email,
      ip_address: ip,
      details: { decision: 'REJECTED', remarks: cleanRemarks, policy: 'ALL' },
    });

    return { success: true, decision: 'REJECTED', visit: updatedVisit, approval: approvalRecord };
  }

  // Decision is APPROVED under ALL policy
  // Record this guardian's approval first
  const approvalRecord = await ParentApproval.create({
    home_visit_request_id: visit._id,
    student_id: studentId,
    guardian_id: guardian._id,
    decision: 'APPROVED',
    decided_at: new Date(),
    decided_by_email: guardian.email,
    decided_by_name: guardian.name,
    decided_by_phone: guardian.phone,
    remarks: cleanRemarks,
    decision_source: 'PARENT_PORTAL',
    ip_address: ip,
    user_agent: userAgent,
  });

  // Check how many guardians exist for this student
  const totalGuardians = await Guardian.countDocuments({ student_id: studentId });
  const approvedDecisionsCount = await ParentApproval.countDocuments({
    home_visit_request_id: visit._id,
    decision: 'APPROVED',
    decision_source: 'PARENT_PORTAL',
  });

  let finalVisit = visit;
  if (approvedDecisionsCount >= totalGuardians) {
    // All guardians have approved!
    finalVisit = await HomeVisitLog.findByIdAndUpdate(
      visitId,
      {
        $set: {
          parent_approval_status: 'parent_approved',
          overall_status: 'approved',
          warden_status: 'approved',
          warden_response_time: new Date(),
          parent_decision_source: 'PARENT_PORTAL',
          final_parent_decision_at: new Date(),
        },
      },
      { new: true }
    );

    const finalVisitLean = finalVisit.toObject ? finalVisit.toObject() : finalVisit;
    finalVisitLean.student_id = visit.student_id;
    const qrPass = await issueHomeVisitGatePass(finalVisitLean).catch((err) => {
      logger.warn('[ParentApproval] QR gate pass issuance error:', err.message);
      return null;
    });
    if (qrPass?.token && qrPass.token !== finalVisit.qr_token) {
      finalVisit.qr_token = qrPass.token;
      await HomeVisitLog.updateOne({ _id: finalVisit._id }, { qr_token: qrPass.token });
    }
    await GatePass.updateOne(
      { home_visit_id: finalVisit._id },
      { status: 'APPROVED', qr_token: qrPass?.token || finalVisit.qr_token }
    ).catch(() => {});

    if (visit.student_id?.email) {
      sendLeaveOutcomeEmailToStudent({
        to: visit.student_id.email,
        studentName: visit.student_id.name || visit.name,
        decision: 'APPROVED',
        parentName: 'Both Guardians',
        remarks: cleanRemarks,
        place: visit.place,
        leaveDate: visit.leave_date,
        returnDate: visit.return_date,
      }).catch((e) => logger.warn('[ParentApproval] Email notification to student failed:', e.message));
    }
  }

  await ApprovalAuditLog.create({
    event: 'DECISION_MADE',
    home_visit_request_id: visit._id,
    student_id: studentId,
    guardian_id: guardian._id,
    actor_id: parentUser._id,
    actor_role: 'parent',
    actor_email: guardian.email,
    ip_address: ip,
    details: { decision: 'APPROVED', approvalsCount: approvedDecisionsCount, totalNeeded: totalGuardians, policy: 'ALL' },
  });

  return { success: true, decision: 'APPROVED', visit: finalVisit, approval: approvalRecord };
};

/**
 * Record manual phone confirmation override by hostel staff / warden
 * Works even if no guardian is linked (using free-text contact and phone)
 * and works on 'pending', 'parent_no_response', and 'legacy' requests.
 */
const recordStaffPhoneOverride = async ({
  visitId,
  staffUser,
  guardianId = null,
  contactName = '',
  contactPhone = '',
  overrideReason,
  ip = '',
  userAgent = '',
}) => {
  if (!overrideReason || overrideReason.trim().length < 5) {
    throw new Error('A mandatory call note / override reason (minimum 5 characters) is required');
  }

  const visit = await HomeVisitLog.findById(visitId).populate('student_id');
  if (!visit) {
    throw new Error('Home visit request not found');
  }

  // Allowed on pending, parent_no_response, or legacy requests
  if (!['pending', 'parent_no_response', 'legacy'].includes(visit.parent_approval_status)) {
    throw new Error(`Cannot override request in status '${visit.parent_approval_status}'`);
  }

  let guardian = null;
  if (guardianId && mongoose.Types.ObjectId.isValid(guardianId)) {
    guardian = await Guardian.findById(guardianId);
  }

  const studentId = visit.student_id?._id || visit.student_id;
  const decName = contactName.trim() || guardian?.name || visit.student_id?.parentPhone || 'Parent (Phone Contact)';
  const decPhone = contactPhone.trim() || guardian?.phone || visit.parent_phone || visit.student_id?.parentPhone || 'N/A';
  const decEmail = guardian?.email || staffUser.email;

  // Atomic update
  const updatedVisit = await HomeVisitLog.findOneAndUpdate(
    {
      _id: visitId,
      parent_approval_status: { $in: ['pending', 'parent_no_response', 'legacy'] },
    },
    {
      $set: {
        parent_approval_status: 'parent_approved',
        overall_status: 'approved',
        warden_status: 'approved',
        warden_response_time: new Date(),
        parent_call_confirmed: true,
        parent_call_confirmed_at: new Date(),
        parent_call_confirmed_by: staffUser._id,
        parent_decision_source: 'STAFF_PHONE_OVERRIDE',
        final_parent_decision_at: new Date(),
      },
    },
    { new: true }
  );

  if (!updatedVisit) {
    throw new Error('Failed to apply override — request status was updated concurrently');
  }

  const overrideVisitLean = updatedVisit.toObject ? updatedVisit.toObject() : updatedVisit;
  overrideVisitLean.student_id = visit.student_id;
  const qrPass = await issueHomeVisitGatePass(overrideVisitLean).catch((err) => {
    logger.warn('[ParentApproval] QR gate pass issuance error on override:', err.message);
    return null;
  });
  if (qrPass?.token && qrPass.token !== updatedVisit.qr_token) {
    updatedVisit.qr_token = qrPass.token;
    await HomeVisitLog.updateOne({ _id: updatedVisit._id }, { qr_token: qrPass.token });
  }
  await GatePass.updateOne(
    { home_visit_id: updatedVisit._id },
    { status: 'APPROVED', qr_token: qrPass?.token || updatedVisit.qr_token }
  ).catch(() => {});

  // Create append-only ParentApproval record (guardian_id can be null)
  const approvalRecord = await ParentApproval.create({
    home_visit_request_id: visit._id,
    student_id: studentId,
    guardian_id: guardian ? guardian._id : null,
    decision: 'APPROVED',
    decided_at: new Date(),
    decided_by_email: decEmail,
    decided_by_name: decName,
    decided_by_phone: decPhone,
    remarks: overrideReason.trim().slice(0, 500),
    decision_source: 'STAFF_PHONE_OVERRIDE',
    ip_address: ip,
    user_agent: userAgent,
    staff_user_id: staffUser._id,
    override_reason: overrideReason.trim().slice(0, 500),
  });

  await ApprovalAuditLog.create({
    event: 'OVERRIDE_USED',
    home_visit_request_id: visit._id,
    student_id: studentId,
    guardian_id: guardian ? guardian._id : null,
    actor_id: staffUser._id,
    actor_role: staffUser.role || 'warden',
    actor_email: staffUser.email,
    ip_address: ip,
    details: {
      overrideReason: overrideReason.trim(),
      contactName: decName,
      contactPhone: decPhone,
    },
  });

  return { success: true, visit: updatedVisit, approval: approvalRecord };
};

module.exports = {
  getApprovalPolicy,
  recordParentDecision,
  recordStaffPhoneOverride,
};
