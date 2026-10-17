/**
 * Resend invitations to all pending guardians using live SMTP
 * Usage: node scripts/resendPendingParentInvites.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Guardian = require('../models/Guardian');
const GuardianInvitation = require('../models/GuardianInvitation');
const User = require('../models/User');
const { sendGuardianInviteEmail, isMailConfigured } = require('../services/mailService');

async function resendAll() {
  console.log('\n======================================================');
  console.log('   RESENDING INVITATIONS TO PENDING PARENT INBOXES    ');
  console.log('======================================================\n');

  if (!isMailConfigured()) {
    console.error('❌ ERROR: SMTP credentials are not configured in backend/.env!');
    console.error('Please fill in SMTP_USER and SMTP_PASS in backend/.env and save the file (Ctrl + S).\n');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const pendingGuardians = await Guardian.find({ status: 'INVITED' }).populate('student_id');
  if (pendingGuardians.length === 0) {
    console.log('ℹ️ No guardians in "INVITED" status found.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${pendingGuardians.length} pending guardian(s):\n`);

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  for (const guardian of pendingGuardians) {
    console.log(`Processing: ${guardian.name} (${guardian.email})...`);
    try {
      // Invalidate old unconsumed invitations
      await GuardianInvitation.updateMany(
        { guardian_id: guardian._id, used_at: null },
        { $set: { used_at: new Date() } }
      );

      // Issue fresh single-use 7-day token
      const { rawToken } = await GuardianInvitation.createForGuardian(guardian._id, 7);
      const inviteUrl = `${baseUrl}/parent/onboard?token=${rawToken}`;

      guardian.last_invite_sent_at = new Date();
      await guardian.save();

      const result = await sendGuardianInviteEmail({
        to: guardian.email,
        guardianName: guardian.name,
        studentName: guardian.student_id?.name || 'Student',
        collegeName: 'IIIT Campus',
        inviteUrl,
        expiryDays: 7,
      });

      if (result.success && !result.mocked) {
        console.log(`  ✅ Dispatched email to ${guardian.email} (MessageID: ${result.messageId})`);
        console.log(`     Direct link: ${inviteUrl}\n`);
      } else if (result.mocked) {
        console.log(`  ⚠️ Mock dispatched (SMTP not recognized as configured).`);
        console.log(`     Direct link: ${inviteUrl}\n`);
      } else {
        console.error(`  ❌ Failed to send to ${guardian.email}:`, result.error);
      }
    } catch (err) {
      console.error(`  ❌ Exception sending to ${guardian.email}:`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log('======================================================');
  console.log('Done! Please check the parent email inboxes (and spam folder).');
  console.log('======================================================\n');
}

resendAll().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
