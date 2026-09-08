/**
 * Utility Script to Reset or Delete a User in MongoDB
 * 
 * Usage:
 *   node backend/scripts/resetUserRole.js <mongodb_uri> <email> [delete/student/warden/security]
 */

const mongoose = require('mongoose');
const User = require('../models/User');

const uri = process.argv[2];
const email = process.argv[3];
const action = process.argv[4] || 'student'; // Default to changing role to 'student'

if (!uri || !email) {
  console.error('Usage: node backend/scripts/resetUserRole.js <mongodb_uri> <email> [delete/student/warden/security]');
  process.exit(1);
}

mongoose.connect(uri)
  .then(async () => {
    console.log('Connected to MongoDB.');
    const query = { email: email.toLowerCase().trim() };
    
    const user = await User.findOne(query);
    if (!user) {
      console.log(`User with email "${email}" not found.`);
      process.exit(0);
    }

    if (action === 'delete') {
      const res = await User.deleteOne(query);
      console.log(`Successfully deleted user "${email}" from the database.`, res);
    } else {
      const res = await User.updateOne(query, { $set: { role: action } });
      console.log(`Successfully updated user "${email}" role to "${action}".`, res);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('Database connection error:', err);
    process.exit(1);
  });
