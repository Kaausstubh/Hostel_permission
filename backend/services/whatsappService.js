/**
 * WhatsApp Service
 * Abstraction over Twilio WhatsApp API with simulation fallback.
 * Set SIMULATE_WHATSAPP=true in .env to log messages instead of sending.
 *
 * Supports both text messages and media (image) messages.
 */

const twilio = require('twilio');

let client;

// Initialize Twilio client only if credentials are provided
if (
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_ACCOUNT_SID !== 'your_twilio_account_sid'
) {
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// In-memory store for simulated messages (text + image)
const simulatedMessages = [];

/**
 * Send a WhatsApp text message to a phone number.
 * @param {string} to   - Recipient phone (E.164, e.g., "+919876543210")
 * @param {string} body - Message text
 * @returns {Promise<object>} Twilio message object or simulation log
 */
const sendWhatsAppMessage = async (to, body) => {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  if (process.env.SIMULATE_WHATSAPP === 'true' || !client) {
    const simulated = {
      simulated: true,
      sender: 'bot',
      type: 'text',
      to: toFormatted,
      body,
      timestamp: new Date().toISOString(),
    };
    _pushSimulated(simulated);
    console.log('\n📱 [WHATSAPP SIMULATION]');
    console.log(`   To:   ${toFormatted}`);
    console.log(`   Body: ${body}`);
    console.log('─'.repeat(50));
    return simulated;
  }

  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: toFormatted,
      body,
    });
    console.log(`✅ WhatsApp sent to ${to} | SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error(`❌ WhatsApp send failed to ${to}: ${error.message}`);
    throw error;
  }
};

/**
 * Send a WhatsApp media (image) message.
 * In simulation mode the image data URL is stored so the simulator can render it.
 *
 * @param {string} to          - Recipient phone (E.164)
 * @param {string} mediaUrl    - Publicly accessible URL of the image (for live Twilio)
 * @param {string} qrDataUrl   - Base64 data URL of the image (for simulation rendering)
 * @param {string} [caption]   - Optional caption text sent with the image
 * @returns {Promise<object>}
 */
const sendWhatsAppMediaMessage = async (to, mediaUrl, qrDataUrl, caption = '') => {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  if (process.env.SIMULATE_WHATSAPP === 'true' || !client) {
    const simulated = {
      simulated: true,
      sender: 'bot',
      type: 'image',
      to: toFormatted,
      mediaUrl,      // public URL (may be localhost in simulation)
      qrDataUrl,     // base64 data URL — used by simulator UI to render inline
      body: caption,
      timestamp: new Date().toISOString(),
    };
    _pushSimulated(simulated);
    console.log('\n📱 [WHATSAPP SIMULATION — IMAGE]');
    console.log(`   To:       ${toFormatted}`);
    console.log(`   MediaUrl: ${mediaUrl}`);
    console.log(`   Caption:  ${caption}`);
    console.log('─'.repeat(50));
    return simulated;
  }

  // Live Twilio — media must be at a publicly reachable HTTPS URL
  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: toFormatted,
      mediaUrl: [mediaUrl],
      body: caption,
    });
    console.log(`✅ WhatsApp media sent to ${to} | SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error(`❌ WhatsApp media send failed to ${to}: ${error.message}`);
    throw error;
  }
};

/** @private Push to simulated store, keep last 200 */
const _pushSimulated = (msg) => {
  simulatedMessages.push(msg);
  if (simulatedMessages.length > 200) simulatedMessages.shift();
};

/**
 * Get all simulated messages for a given phone number.
 * Returns both text and image messages.
 */
const getSimulatedMessages = (phone) => {
  const normPhone = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  return simulatedMessages.filter(
    (m) => m.to === normPhone || m.from === normPhone
  );
};

/** Record an inbound user message into the simulation store. */
const recordUserMessage = (phone, body) => {
  const normPhone = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  _pushSimulated({
    simulated: true,
    sender: 'user',
    type: 'text',
    from: normPhone,
    body,
    timestamp: new Date().toISOString(),
  });
};

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppMediaMessage,
  getSimulatedMessages,
  recordUserMessage,
};
