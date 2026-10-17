/**
 * Generate direct parent onboarding links without waiting for email delivery
 * Usage: node scripts/generateDirectParentLinks.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Guardian = require('../models/Guardian');
const GuardianInvitation = require('../models/GuardianInvitation');
const User = require('../models/User');

async function generate() {
  await mongoose.connect(process.env.MONGODB_URI);

  const guardians = await Guardian.find({}).populate('student_id');
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  console.log('\n=== DIRECT ONBOARDING LINKS ===\n');

  for (const g of guardians) {
    if (g.status === 'INVITED') {
      // Invalidate previous unconsumed invitations
      await GuardianInvitation.updateMany(
        { guardian_id: g._id, used_at: null },
        { $set: { used_at: new Date() } }
      );

      // Create new fresh token
      const { rawToken } = await GuardianInvitation.createForGuardian(g._id, 7);
      const url = `${baseUrl}/parent/onboard?token=${rawToken}`;
      console.log(`Guardian:    ${g.name} (${g.relationship})`);
      console.log(`Email:       ${g.email}`);
      console.log(`Student:     ${g.student_id?.name || 'N/A'} (${g.student_id?.rollNo || 'N/A'})`);
      console.log(`Direct Link: ${url}`);
      console.log('--------------------------------------------------\n');
    } else {
      console.log(`Guardian:    ${g.name} (${g.email}) is already ACTIVE (no onboarding token needed).\n`);
    }
  }

  await mongoose.disconnect();
}

generate().catch(console.error);
