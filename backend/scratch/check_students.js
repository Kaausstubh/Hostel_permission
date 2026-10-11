const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = await mongoose.connection.collection('users').find({ role: 'student' }).toArray();
    console.log('STUDENT USERS COUNT:', users.length);
    if (users.length > 0) {
      console.log('SAMPLE STUDENTS:', JSON.stringify(users.slice(0, 5).map(u => ({ id: u._id, name: u.name, email: u.email, rollNo: u.rollNo, googleId: u.googleId })), null, 2));
    }
    const nonStudents = await mongoose.connection.collection('users').find({ role: { $ne: 'student' } }).toArray();
    console.log('STAFF / WARDEN / SECURITY USERS COUNT:', nonStudents.length, nonStudents.map(u => ({ email: u.email, role: u.role })));
    
    const allocations = await mongoose.connection.collection('roomallocations').find({}).toArray();
    console.log('ROOM ALLOCATIONS COUNT:', allocations.length);
    
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();
