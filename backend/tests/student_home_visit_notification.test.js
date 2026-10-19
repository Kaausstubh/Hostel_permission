/**
 * Test: Student Home Visit Request Email Notification Dispatch
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

async function testHomeVisitNotification() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hostel';
  await mongoose.connect(uri);

  const User = require('../models/User');
  const Guardian = require('../models/Guardian');
  const HomeVisitLog = require('../models/HomeVisitLog');
  const ApprovalAuditLog = require('../models/ApprovalAuditLog');
  const { linkInitialGuardians } = require('../services/guardianService');
  const { sendLeaveRequestEmail } = require('../services/mailService');

  const STUDENT_EMAIL = 'notif.test.student@cse.iiitp.ac.in';
  const PARENT_EMAIL = 'notif.test.parent@gmail.com';

  try {
    // Teardown
    await User.deleteMany({ email: { $in: [STUDENT_EMAIL, PARENT_EMAIL] } });
    await Guardian.deleteMany({ email: PARENT_EMAIL });

    // 1. Create Student
    const student = await User.create({
      name: 'Notification Test Student',
      email: STUDENT_EMAIL,
      role: 'student',
      rollNo: '112415888',
      phone: '+919876511111',
      parentPhone: '+919876522222',
      hostel: 'BH1',
      roomNo: '202',
      isActive: true,
      isEmailVerified: true,
    });

    // 2. Link Guardian
    await linkInitialGuardians({
      studentId: student._id,
      guardian1: {
        name: 'Parent Notif Test',
        relationship: 'Father',
        phone: '9876522222',
        email: PARENT_EMAIL,
      },
      ip: '127.0.0.1',
      actorId: student._id,
    });

    const linkedGuardians = await Guardian.find({ student_id: student._id });
    console.log('✅ Linked guardians count:', linkedGuardians.length);

    // 3. Simulate Student Home Visit creation and notification dispatch as implemented in routes/student.js
    const persistentToken = 'compact_test_token_123';
    const visit = await HomeVisitLog.create({
      student_id: student._id,
      name: student.name,
      rollNo: student.rollNo,
      hostel: student.hostel,
      room_no: student.roomNo,
      phone: student.phone,
      parent_phone: student.parentPhone,
      place: 'Goa',
      reason: 'Vacation',
      leave_date: '2026-11-01',
      return_date: '2026-11-05',
      parent_approval_status: 'pending',
      overall_status: 'pending',
      qr_token: persistentToken,
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const requestUrl = `${baseUrl}/parent/requests/${visit._id}`;

    for (const g of linkedGuardians) {
      await sendLeaveRequestEmail({
        to: g.email,
        guardianName: g.name,
        studentName: student.name,
        leaveDate: visit.leave_date,
        returnDate: visit.return_date,
        reason: visit.reason,
        place: visit.place,
        requestUrl,
      });

      await ApprovalAuditLog.create({
        event: 'REQUEST_NOTIFIED',
        home_visit_request_id: visit._id,
        student_id: student._id,
        guardian_id: g._id,
        actor_id: student._id,
        actor_role: 'student',
        actor_email: student.email,
        ip_address: '127.0.0.1',
        details: { requestUrl, guardianEmail: g.email },
      });
    }

    const auditLog = await ApprovalAuditLog.findOne({
      home_visit_request_id: visit._id,
      event: 'REQUEST_NOTIFIED',
    });

    console.log('✅ Audit log created for parent email notification:', Boolean(auditLog));
    console.log('✅ Notification target email:', auditLog?.details?.guardianEmail);
    console.log('✅ Direct request review URL:', auditLog?.details?.requestUrl);

    if (!auditLog) throw new Error('REQUEST_NOTIFIED audit log missing');
    console.log('\n🎉 Student home visit notification test passed successfully!');
  } finally {
    await User.deleteMany({ email: { $in: [STUDENT_EMAIL, PARENT_EMAIL] } });
    await Guardian.deleteMany({ email: PARENT_EMAIL });
    await HomeVisitLog.deleteMany({ name: 'Notification Test Student' });
    await mongoose.connection.collection('parentapprovals').deleteMany({ student_id: STUDENT_EMAIL });
    await mongoose.disconnect();
  }
}

testHomeVisitNotification()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Test failed:', e);
    process.exit(1);
  });
