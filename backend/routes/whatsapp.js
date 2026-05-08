/**
 * WhatsApp Webhook Route
 * POST /api/whatsapp/webhook  - Receives messages from Twilio
 * POST /api/whatsapp/test     - Simulate a message (dev only)
 *
 * CHATBOT STATE MACHINE:
 * IDLE → greeting → MENU
 * MENU (1) → INOUT_CONFIRM
 * MENU (2) → HV_REASON → HV_LEAVE_DATE → HV_RETURN_DATE → HV_DONE
 * MENU (3) → COMPLAINT_HOSTEL → COMPLAINT_TEXT → COMPLAINT_DONE
 * MENU (4) → VIEW_STATUS
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const InOutLog = require('../models/InOutLog');
const HomeVisitLog = require('../models/HomeVisitLog');
const Complaint = require('../models/Complaint');
const {
  getSimulatedMessages,
  recordUserMessage,
} = require('../services/whatsappService');
const { enqueueWhatsAppMessage, enqueueWhatsAppMediaMessage } = require('../queues/whatsappQueue');
const { getSession, updateSession, clearSession } = require('../services/sessionService');
const { generateQR, registerActiveQR } = require('../services/qrService');
const {
  INOUT_REQUEST_EXPIRY,
  createPendingInOutRequest,
  getPendingInOutRequest,
} = require('../services/inOutRequestService');

const sendWhatsAppMessage = (to, body) => enqueueWhatsAppMessage({ to, body });
const sendWhatsAppMediaMessage = (to, mediaUrl, qrDataUrl, caption = '') =>
  enqueueWhatsAppMediaMessage({ to, mediaUrl, qrDataUrl, caption });
const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const parseLocalDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const getMaxReturnDateFromLeave = (leaveDateStr) => {
  const leaveDate = parseLocalDate(leaveDateStr);
  leaveDate.setMonth(leaveDate.getMonth() + 4);
  return formatLocalDate(leaveDate);
};

// ─── Message Processor ────────────────────────────────────────────────────────
const processMessage = async (from, body) => {
  const phone = from.replace('whatsapp:', ''); // Normalize to +91...
  const text = body.trim();
  const textLower = text.toLowerCase();

  // Lookup user by phone
  const user = await User.findOne({ phone });

  const session = await getSession(phone);

  // ── Handle parent approval replies (outside normal flow) ──────────────────
  if (textLower.startsWith('approve ') || textLower.startsWith('reject ')) {
    const parts = text.split(' ');
    const action = textLower.startsWith('approve') ? 'approve' : 'reject';
    const visitId = parts[1];
    if (visitId && visitId.length === 24) {
      return await handleParentReply(phone, visitId, action);
    }
  }

  // ── Handle warden WhatsApp approval replies ────────────────────────────────
  if (textLower.startsWith('warden_approve ') || textLower.startsWith('warden_reject ')) {
    const parts = text.split(' ');
    const action = textLower.startsWith('warden_approve') ? 'approve' : 'reject';
    const visitId = parts[1];
    if (visitId && visitId.length === 24) {
      return await handleWardenReply(phone, visitId, action);
    }
  }

  // ── Greeting → show main menu ─────────────────────────────────────────────
  const greetings = ['hi', 'hii', 'hello', 'hey', 'start', 'menu'];
  if (greetings.includes(textLower) || session.step === 'IDLE') {
    await clearSession(phone);

    if (!user) {
      return await sendWhatsAppMessage(
        phone,
        `👋 Hello! You are not registered in our system.\nPlease contact the hostel office to register your number.`
      );
    }

    return await sendMainMenu(phone, user.name);
  }

  // ── Process based on current session state ────────────────────────────────
  switch (session.step) {
    case 'MENU':
      return await handleMenuChoice(phone, textLower, user);

    // ── In/Out ───────────────────────────────────────────────────────────────
    case 'INOUT_CONFIRM':
      return await handleInOutConfirm(phone, textLower, user);

    // ── Home Visit ────────────────────────────────────────────────────────────
    case 'HV_REASON':
      await updateSession(phone, 'HV_LEAVE_DATE', { reason: text });
      return await sendWhatsAppMessage(phone, `📅 What is your *date of leaving*?\nFormat: YYYY-MM-DD (e.g., 2024-12-25)`);

    case 'HV_LEAVE_DATE':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return await sendWhatsAppMessage(phone, '❌ Invalid date format. Please use YYYY-MM-DD (e.g., 2024-12-25)');
      }
      {
        const today = formatLocalDate(new Date());
        if (text < today) {
          return await sendWhatsAppMessage(phone, '❌ Leave date cannot be before today.');
        }
      }
      await updateSession(phone, 'HV_RETURN_DATE', { leave_date: text });
      return await sendWhatsAppMessage(phone, `📅 What is your *expected return date*?\nFormat: YYYY-MM-DD\nIt can be up to 4 months after your leave date.`);

    case 'HV_RETURN_DATE':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return await sendWhatsAppMessage(phone, '❌ Invalid date format. Please use YYYY-MM-DD');
      }
      {
        const today = formatLocalDate(new Date());
        if (text < today) {
          return await sendWhatsAppMessage(phone, '❌ Return date cannot be before today.');
        }
        if (session.data.leave_date && text <= session.data.leave_date) {
          return await sendWhatsAppMessage(phone, '❌ Return date must be after leave date.');
        }
        if (session.data.leave_date) {
          const maxReturnDate = getMaxReturnDateFromLeave(session.data.leave_date);
          if (text > maxReturnDate) {
            return await sendWhatsAppMessage(phone, `❌ Return date cannot be more than 4 months after leave date. Maximum allowed return date is ${maxReturnDate}.`);
          }
        }
      }
      return await finalizeHomeVisitRequest(phone, text, user, session);

    // ── Complaint ─────────────────────────────────────────────────────────────
    case 'COMPLAINT_HOSTEL':
      const hostelUpper = text.toUpperCase();
      if (!['BH1', 'BH2', 'GH'].includes(hostelUpper)) {
        return await sendWhatsAppMessage(phone, '❌ Invalid hostel. Please reply with *BH1*, *BH2*, or *GH*');
      }
      await updateSession(phone, 'COMPLAINT_TEXT', { hostel: hostelUpper });
      return await sendWhatsAppMessage(phone, `📝 Please describe your complaint in detail:`);

    case 'COMPLAINT_TEXT':
      return await finalizeComplaint(phone, text, user, session);

    default:
      await clearSession(phone);
      return await sendMainMenu(phone, user ? user.name : 'there');
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sendMainMenu = async (phone, name) => {
  await updateSession(phone, 'MENU', {});
  return await sendWhatsAppMessage(
    phone,
    `👋 Hello, *${name}*!\n\nWelcome to *Smart Campus Hostel System* 🏢\n\nPlease choose an option:\n\n1️⃣ In/Out Request\n2️⃣ Home Visit Request\n3️⃣ File Complaint\n4️⃣ View Complaint Status\n\nReply with the number (1-4)`
  );
};

const handleMenuChoice = async (phone, choice, user) => {
  switch (choice) {
    case '1':
      if (!user || user.role !== 'student') {
        return await sendWhatsAppMessage(phone, '❌ This option is for students only.');
      }
      await updateSession(phone, 'INOUT_CONFIRM', {});
      return await sendWhatsAppMessage(
        phone,
        `🔄 *In/Out Request*\n\nThis will generate a QR code for gate entry/exit.\n\nReply *YES* to generate your QR code, or *MENU* to go back.`
      );

    case '2':
      if (!user || user.role !== 'student') {
        return await sendWhatsAppMessage(phone, '❌ This option is for students only.');
      }
      await updateSession(phone, 'HV_REASON', {});
      return await sendWhatsAppMessage(phone, `🏠 *Home Visit Request*\n\nStep 1/3: Please state the *reason* for your home visit:`);

    case '3':
      if (!user || user.role !== 'student') {
        return await sendWhatsAppMessage(phone, '❌ This option is for students only.');
      }
      await updateSession(phone, 'COMPLAINT_HOSTEL', {});
      return await sendWhatsAppMessage(
        phone,
        `🧾 *File a Complaint*\n\nWhich hostel is your complaint for?\nReply with: *BH1*, *BH2*, or *GH*`
      );

    case '4':
      return await handleViewComplaints(phone, user);

    default:
      return await sendWhatsAppMessage(phone, '❌ Invalid choice. Please reply with 1, 2, 3, or 4.');
  }
};

const handleInOutConfirm = async (phone, choice, user) => {
  if (choice === 'yes' || choice === 'y') {
    try {
      const todayStr = new Date().toISOString().split('T')[0];

      // Determine scan type
      const existingOut = await InOutLog.findOne({
        student_id: user._id,
        status: 'OUT',
        returned: false,
        date: todayStr,
      });

      const scanType = existingOut ? 'IN' : 'OUT';
      let request = await getPendingInOutRequest(user._id.toString());
      if (!request || request.scanType !== scanType) {
        request = await createPendingInOutRequest({
          studentId: user._id.toString(),
          studentName: user.name,
          hostel: user.hostel || 'N/A',
          rollNumber: user.rollNo || user.rollNumber || 'N/A',
          scanType,
        });
      }

      await clearSession(phone);

      await sendWhatsAppMessage(
        phone,
        `✅ *In/Out Request Sent!*\n\n` +
        `👤 Student: *${user.name}*\n` +
        `🔄 Request Type: *${scanType}*\n` +
        `⏳ Valid for: ${INOUT_REQUEST_EXPIRY} seconds\n\n` +
        `🛂 Your request is now visible on the security dashboard. Show the QR below at the gate within 10 minutes for scanning.`
      );

      await sendWhatsAppMediaMessage(
        phone,
        request.qrPublicUrl,
        request.qrDataUrl,
        `🏫 Smart Campus — Gate ${scanType} Request\nStudent: ${user.name} | ${user.hostel || ''}`
      );
    } catch (err) {
      return await sendWhatsAppMessage(phone, `❌ Error sending request: ${err.message}`);
    }
  } else if (choice === 'menu' || choice === 'no' || choice === 'n') {
    await clearSession(phone);
    return await sendMainMenu(phone, user.name);
  } else {
    return await sendWhatsAppMessage(phone, 'Please reply *YES* to confirm or *MENU* to go back.');
  }
};

const finalizeHomeVisitRequest = async (phone, returnDate, user, session) => {
  try {
    const maxReturnDate = getMaxReturnDateFromLeave(session.data.leave_date);
    if (returnDate > maxReturnDate) {
      await clearSession(phone);
      return await sendWhatsAppMessage(
        phone,
        `❌ Return date cannot be more than 4 months after leave date. Maximum allowed return date is ${maxReturnDate}.`
      );
    }

    const visit = await HomeVisitLog.create({
      student_id: user._id,
      reason: session.data.reason,
      leave_date: session.data.leave_date,
      return_date: returnDate,
    });

    // Notify parent
    if (user.parentPhone) {
      await sendWhatsAppMessage(
        user.parentPhone,
        `🏠 *Home Visit Request — Action Required*\n\n👤 Student: *${user.name}*\n🏢 Hostel: ${user.hostel || 'N/A'}\n📝 Reason: ${session.data.reason}\n📅 Leave: ${session.data.leave_date}\n📅 Return: ${returnDate}\n\nPlease reply:\n✅ *APPROVE ${visit._id}*\n❌ *REJECT ${visit._id}*`
      );
    }

    await clearSession(phone);
    await sendWhatsAppMessage(
      phone,
      `✅ *Home Visit Request Submitted!*\n\nDetails:\n📝 Reason: ${session.data.reason}\n📅 Leave: ${session.data.leave_date}\n📅 Return: ${returnDate}\n\n⏳ Awaiting parent approval. You will be notified once approved.\n\nRequest ID: ${visit._id}`
    );
  } catch (err) {
    await clearSession(phone);
    await sendWhatsAppMessage(phone, `❌ Error submitting request: ${err.message}`);
  }
};

const finalizeComplaint = async (phone, text, user, session) => {
  try {
    const complaint = await Complaint.create({
      student_id: user._id,
      hostel: session.data.hostel,
      complaint_text: text,
    });

    await clearSession(phone);
    await sendWhatsAppMessage(
      phone,
      `✅ *Complaint Filed Successfully!*\n\n🏢 Hostel: ${session.data.hostel}\n📝 Complaint: ${text}\n🔖 ID: ${complaint._id}\n📊 Status: *Pending*\n\nThe warden will review your complaint shortly.`
    );
  } catch (err) {
    await clearSession(phone);
    await sendWhatsAppMessage(phone, `❌ Error filing complaint: ${err.message}`);
  }
};

const handleViewComplaints = async (phone, user) => {
  if (!user || user.role !== 'student') {
    return await sendWhatsAppMessage(phone, '❌ This option is for students only.');
  }

  const complaints = await Complaint.find({ student_id: user._id })
    .sort({ timestamp: -1 })
    .limit(5);

  if (complaints.length === 0) {
    await clearSession(phone);
    return await sendWhatsAppMessage(phone, `📋 You have no complaints filed.\n\nType *hi* to return to the menu.`);
  }

  let msg = `📋 *Your Recent Complaints:*\n\n`;
  complaints.forEach((c, i) => {
    const date = new Date(c.timestamp).toLocaleDateString('en-IN');
    const statusEmoji = c.status === 'resolved' ? '✅' : c.status === 'in_progress' ? '🔄' : '⏳';
    msg += `${i + 1}. ${statusEmoji} *${c.hostel}* — ${date}\n`;
    msg += `   "${c.complaint_text.substring(0, 50)}..."\n`;
    msg += `   Status: *${c.status.toUpperCase()}*\n\n`;
  });

  msg += `Type *hi* to return to the main menu.`;
  await clearSession(phone);
  return await sendWhatsAppMessage(phone, msg);
};

const handleParentReply = async (phone, visitId, action) => {
  const visit = await HomeVisitLog.findById(visitId).populate('student_id');
  if (!visit) {
    return await sendWhatsAppMessage(phone, `❌ Request ID not found: ${visitId}`);
  }

  if (visit.parent_status !== 'pending') {
    return await sendWhatsAppMessage(phone, `ℹ️ This request has already been ${visit.parent_status}.`);
  }

  visit.parent_status = action === 'approve' ? 'approved' : 'rejected';
  visit.parent_response_time = new Date();
  const student = visit.student_id;

  if (action === 'approve') {
    visit.overall_status = 'parent_approved';
    await visit.save();

    await sendWhatsAppMessage(
      phone,
      `✅ You have *approved* ${student.name}'s home visit request.\nThe warden will now review it.`
    );

    // Notify student
    await sendWhatsAppMessage(
      student.phone,
      `✅ Your parent has *approved* your home visit request!\n📅 Leave: ${visit.leave_date} → Return: ${visit.return_date}\n\n⏳ Awaiting warden approval...`
    );

    // Notify warden
    const warden = await User.findOne({ role: 'warden' });
    if (warden && warden.phone) {
      await sendWhatsAppMessage(
        warden.phone,
        `🏠 *Home Visit — Parent Approved*\n\nStudent: *${student.name}* (${student.rollNumber || 'N/A'})\nHostel: ${student.hostel}\nReason: ${visit.reason}\n📅 Leave: ${visit.leave_date} → Return: ${visit.return_date}\n\nReply:\n✅ *WARDEN_APPROVE ${visit._id}*\n❌ *WARDEN_REJECT ${visit._id}*`
      );
    }
  } else {
    visit.overall_status = 'rejected';
    await visit.save();

    await sendWhatsAppMessage(phone, `❌ You have *rejected* ${student.name}'s home visit request.`);
    await sendWhatsAppMessage(
      student.phone,
      `❌ Your home visit request has been *rejected by your parent*.\nDates: ${visit.leave_date} → ${visit.return_date}`
    );
  }
};

const handleWardenReply = async (phone, visitId, action) => {
  const visit = await HomeVisitLog.findById(visitId).populate('student_id');
  if (!visit) {
    return await sendWhatsAppMessage(phone, `❌ Request ID not found: ${visitId}`);
  }

  if (visit.parent_status !== 'approved') {
    return await sendWhatsAppMessage(phone, `⚠️ Parent has not yet approved this request.`);
  }

  if (visit.warden_status !== 'pending') {
    return await sendWhatsAppMessage(phone, `ℹ️ This request has already been ${visit.warden_status} by the warden.`);
  }

  visit.warden_status = action === 'approve' ? 'approved' : 'rejected';
  visit.warden_response_time = new Date();
  const student = visit.student_id;

  if (action === 'approve') {
    visit.overall_status = 'approved';
    const payload = {
      type: 'home_visit',
      student_id: student._id.toString(),
      visit_id: visit._id.toString(),
    };
    const { token, qrDataUrl, qrPublicUrl } = await generateQR(
      payload,
      `hv_${student._id}_${visit._id}`
    );
    visit.qr_token = token;
    await visit.save();

    await sendWhatsAppMessage(
      phone,
      `✅ You have *approved* ${student.name}'s home visit request. QR code sent to student.`
    );

    // Send text first, then QR image
    await sendWhatsAppMessage(
      student.phone,
      `🎉 *Home Visit APPROVED by Warden!*\n\n📅 Leave: ${visit.leave_date}\n📅 Return: ${visit.return_date}\n\n📲 Your gate pass QR code is below — show it to the guard when leaving and returning.`
    );
    await sendWhatsAppMediaMessage(
      student.phone,
      qrPublicUrl,
      qrDataUrl,
      `🏫 Home Visit Gate Pass\nStudent: ${student.name}\nLeave: ${visit.leave_date} → Return: ${visit.return_date}`
    );
  } else {
    visit.overall_status = 'rejected';
    await visit.save();

    await sendWhatsAppMessage(phone, `❌ You have *rejected* ${student.name}'s home visit request.`);
    await sendWhatsAppMessage(
      student.phone,
      `❌ Your home visit request has been *rejected by the warden*.\nDates: ${visit.leave_date} → ${visit.return_date}`
    );
  }
};

// ─── Twilio Webhook Endpoint ──────────────────────────────────────────────────
// Twilio sends a POST with URL-encoded form data
router.post('/webhook', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const from = req.body.From; // e.g., "whatsapp:+919876543210"
    const body = req.body.Body;

    if (!from || !body) {
      return res.status(400).send('Missing From or Body');
    }

    console.log(`📩 Incoming WhatsApp | From: ${from} | Body: "${body}"`);

    // Process asynchronously — respond 200 immediately to Twilio
    processMessage(from, body).catch((err) =>
      console.error('processMessage error:', err)
    );

    // Twilio expects empty TwiML or 200 within 5 seconds
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// ─── Dev/Test Endpoint: Simulate a WhatsApp Message ──────────────────────────
router.post('/test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'phone and message required' });
    }

    recordUserMessage(phone, message);
    await processMessage(phone, message);
    res.json({ success: true, message: 'Message processed (check server logs for responses)' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── Dev/Test Endpoint: Get Simulated Message History ────────────────────────
router.get('/simulated-messages', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ success: false, message: 'phone query param required' });
  const messages = getSimulatedMessages(phone);
  res.json({ success: true, messages });
});

module.exports = router;
