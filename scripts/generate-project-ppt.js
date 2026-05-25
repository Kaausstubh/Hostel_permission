const pptx = require('pptxgenjs');
const path = require('path');
const fs = require('fs');

// Ensure output folder exists
const docsDir = path.join(__dirname, '../docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir);
}

let pres = new pptx();

// Configure 16:9 widescreen layout
pres.layout = 'LAYOUT_16x9';

// Define Color Scheme (HEX)
const COLOR_PRIMARY = '0F172A';   // Slate 900 (Dark background)
const COLOR_SECONDARY = '1E293B'; // Slate 800
const COLOR_LIGHT = 'F8FAFC';     // Slate 50 (Light background)
const COLOR_ACCENT = '06B6D4';    // Cyan 500
const COLOR_PURPLE = '8B5CF6';    // Violet 500
const COLOR_TEXT_DARK = '1F2937'; // Gray 800
const COLOR_TEXT_MUTED = '6B7280';// Gray 500
const COLOR_TEXT_LIGHT = 'FFFFFF';// White
const COLOR_SUCCESS = '10B981';   // Emerald 500

// Helper to set background on slides
function setSlideBackground(slide, hexColor) {
  slide.background = { color: hexColor };
}

// Helper to add standard title to content slides
function addSlideHeader(slide, titleText, isDarkTheme = true) {
  slide.addText(titleText, {
    x: 0.5,
    y: 0.4,
    w: 12.33,
    h: 0.8,
    fontSize: 28,
    fontFace: 'Arial',
    bold: true,
    color: isDarkTheme ? COLOR_TEXT_LIGHT : COLOR_PRIMARY,
  });
  
  // Decorative underline bar
  slide.addShape(pres.ShapeType.rect, {
    x: 0.5,
    y: 1.1,
    w: 1.5,
    h: 0.05,
    fill: { color: COLOR_ACCENT }
  });
}

// Helper to add a footer to slides
function addSlideFooter(slide, pageNumText, isDarkTheme = true) {
  slide.addText(`Heimdall Smart Hostel Management Platform   |   ${pageNumText}`, {
    x: 0.5,
    y: 7.0,
    w: 12.33,
    h: 0.3,
    fontSize: 10,
    fontFace: 'Arial',
    color: isDarkTheme ? '64748B' : '94A3B8',
    align: 'right'
  });
}

// ── SLIDE 1: COVER SLIDE (DARK THEME) ──────────────────────────────────────────
let s1 = pres.addSlide();
setSlideBackground(s1, COLOR_PRIMARY);

s1.addText('HEIMDALL', {
  x: 1.0,
  y: 2.2,
  w: 11.33,
  h: 1.2,
  fontSize: 64,
  fontFace: 'Arial',
  bold: true,
  color: COLOR_TEXT_LIGHT,
  characterSpacing: 3
});

s1.addText('Campus Access & Hostel Management System', {
  x: 1.0,
  y: 3.4,
  w: 11.33,
  h: 0.6,
  fontSize: 22,
  fontFace: 'Arial',
  color: COLOR_ACCENT,
  bold: true
});

s1.addShape(pres.ShapeType.rect, {
  x: 1.0,
  y: 4.1,
  w: 4.0,
  h: 0.05,
  fill: { color: COLOR_ACCENT }
});

s1.addText('A production-grade, highly scalable, and secure QR permission architecture.', {
  x: 1.0,
  y: 4.4,
  w: 9.0,
  h: 0.8,
  fontSize: 14,
  fontFace: 'Arial',
  color: '94A3B8'
});

s1.addText('VITE/REACT  •  EXPRESS  •  REDIS  •  MONGODB', {
  x: 1.0,
  y: 5.6,
  w: 9.0,
  h: 0.4,
  fontSize: 12,
  fontFace: 'Courier New',
  color: COLOR_PURPLE,
  bold: true
});

addSlideFooter(s1, 'Slide 1', true);


// ── SLIDE 2: THE CAMPUS GATE CHALLENGE (LIGHT THEME) ───────────────────────────
let s2 = pres.addSlide();
setSlideBackground(s2, COLOR_LIGHT);
addSlideHeader(s2, 'The Campus Gate Challenge', false);

s2.addText('Traditional systems fail during rush hours (5 PM returns, weekend exit crowds):', {
  x: 0.5,
  y: 1.6,
  w: 12.33,
  h: 0.5,
  fontSize: 15,
  fontFace: 'Arial',
  color: COLOR_TEXT_DARK,
  bold: true
});

// Pain points cards
const painPoints = [
  { title: 'Logbook Bottlenecks', desc: 'Manual logs create massive queues, holding students at the gate for up to 30 mins.' },
  { title: 'Proxy Outpasses', desc: 'No check on screenshot sharing, manual slip falsification, or fake permissions.' },
  { title: 'Approval Delays', desc: 'Hostel wardens and parents disconnected from gate logs, resulting in manual validation.' },
  { title: 'No Real-time Auditing', desc: 'IT & admin cannot monitor active students in campus or track emergency missing students.' }
];

painPoints.forEach((p, idx) => {
  const x = 0.5 + (idx * 3.1);
  s2.addShape(pres.ShapeType.rect, {
    x: x,
    y: 2.3,
    w: 2.8,
    h: 3.8,
    fill: { color: 'FFFFFF' },
    line: { color: 'E2E8F0', width: 1.5 },
  });
  
  // Card index number in purple
  s2.addText(`0${idx + 1}`, {
    x: x + 0.2,
    y: 2.5,
    w: 2.4,
    h: 0.4,
    fontSize: 20,
    fontFace: 'Arial',
    bold: true,
    color: COLOR_PURPLE
  });
  
  s2.addText(p.title, {
    x: x + 0.2,
    y: 3.0,
    w: 2.4,
    h: 0.8,
    fontSize: 16,
    fontFace: 'Arial',
    bold: true,
    color: COLOR_PRIMARY
  });
  
  s2.addText(p.desc, {
    x: x + 0.2,
    y: 3.9,
    w: 2.4,
    h: 2.0,
    fontSize: 12,
    fontFace: 'Arial',
    color: COLOR_TEXT_MUTED,
    lineSpacing: 18
  });
});

addSlideFooter(s2, 'Slide 2', false);


// ── SLIDE 3: SYSTEM ARCHITECTURE (DARK THEME) ──────────────────────────────────
let s3 = pres.addSlide();
setSlideBackground(s3, COLOR_PRIMARY);
addSlideHeader(s3, 'High-Availability Architecture', true);

// Columns for frontend, backend, databases
const layers = [
  { name: 'CLIENT LAYER (SPA)', items: ['React / Vite Web Portal', 'Tailwind & Custom CSS UI', 'html5-qrcode Web Scanner', 'Socket.io Event Client'] },
  { name: 'ROUTING & API LAYER', items: ['Express REST Endpoints', 'Socket.io Event Servers', 'Helmet & CORS Middleware', 'Brute-force Rate Limiters'] },
  { name: 'MEMCACHE & TASK QUEUE', items: ['Redis Cache (Dashboard)', 'Scan Lock Service (Lua NX)', 'BullMQ Asynchronous Workers', 'JWT Token Blacklist'] },
  { name: 'PERSISTENCE LAYER', items: ['MongoDB Atlas (M0/M30)', 'Indexed Query Collections', 'Mongoose Schemas', 'Auto Reconnection Pool'] }
];

layers.forEach((l, idx) => {
  const x = 0.5 + (idx * 3.1);
  s3.addShape(pres.ShapeType.rect, {
    x: x,
    y: 1.8,
    w: 2.8,
    h: 4.6,
    fill: { color: COLOR_SECONDARY },
    line: { color: COLOR_ACCENT, width: 1 }
  });
  
  s3.addText(l.name, {
    x: x + 0.15,
    y: 2.0,
    w: 2.5,
    h: 0.5,
    fontSize: 12,
    fontFace: 'Arial',
    bold: true,
    color: COLOR_ACCENT,
    align: 'center'
  });
  
  l.items.forEach((item, itemIdx) => {
    s3.addText(`▪  ${item}`, {
      x: x + 0.2,
      y: 2.7 + (itemIdx * 0.8),
      w: 2.4,
      h: 0.6,
      fontSize: 11,
      fontFace: 'Arial',
      color: COLOR_TEXT_LIGHT
    });
  });
});

addSlideFooter(s3, 'Slide 3', true);


// ── SLIDE 4: THE STUDENT PORTAL (DARK THEME) ───────────────────────────────────
let s4 = pres.addSlide();
setSlideBackground(s4, COLOR_PRIMARY);
addSlideHeader(s4, 'Student Portal & Dynamic QR Flow', true);

s4.addText('Features for Students:', {
  x: 0.5,
  y: 1.6,
  w: 5.5,
  h: 0.4,
  fontSize: 18,
  bold: true,
  color: COLOR_ACCENT
});

const studentPoints = [
  'Dynamic QR Codes: Uses cryptographically signed JWT tokens and dynamic OTP salts that change every 60 seconds.',
  'Screenshots Prevention: Prevents QR reuse, sharing, and out-of-campus code generation.',
  'Home-Visit Requests: Input travel destination and date targets to request outpass approvals.',
  'Parent Webhook Integration: Sends SMS alerts and monitors replies in the background.'
];

studentPoints.forEach((p, idx) => {
  s4.addText(`✔  ${p}`, {
    x: 0.5,
    y: 2.2 + (idx * 1.1),
    w: 5.5,
    h: 0.9,
    fontSize: 13,
    fontFace: 'Arial',
    color: COLOR_TEXT_LIGHT,
    lineSpacing: 18
  });
});

// Embed Student Portal Image
const studentImgPath = path.join(__dirname, '../docs/assets/student_portal.png');
if (fs.existsSync(studentImgPath)) {
  s4.addImage({
    path: studentImgPath,
    x: 6.8,
    y: 1.6,
    w: 4.8,
    h: 4.8
  });
}

addSlideFooter(s4, 'Slide 4', true);


// ── SLIDE 5: THE GUARD SCANNER (DARK THEME) ────────────────────────────────────
let s5 = pres.addSlide();
setSlideBackground(s5, COLOR_PRIMARY);
addSlideHeader(s5, 'Security Guard Scanner Dashboard', true);

s5.addText('High-Throughput Gate Terminal Features:', {
  x: 0.5,
  y: 1.6,
  w: 5.5,
  h: 0.4,
  fontSize: 18,
  bold: true,
  color: COLOR_ACCENT
});

const guardPoints = [
  'Zero-Latency Scanner: Instant camera capture on laptop webcams or mobile tablet lenses.',
  'Access Approved Signal: Renders a fullscreen neon green indicator and emits a confirmation audio beep.',
  'Scan Lock Service: Prevents double-scans and multiple entry trials at different gates via atomic Redis locking.',
  'Live Gate Feed: Lists last 5 scanned logs on a live sidebar for security personnel monitoring.'
];

guardPoints.forEach((p, idx) => {
  s5.addText(`✔  ${p}`, {
    x: 0.5,
    y: 2.2 + (idx * 1.1),
    w: 5.5,
    h: 0.9,
    fontSize: 13,
    fontFace: 'Arial',
    color: COLOR_TEXT_LIGHT,
    lineSpacing: 18
  });
});

// Embed Guard Portal Image
const guardImgPath = path.join(__dirname, '../docs/assets/guard_portal.png');
if (fs.existsSync(guardImgPath)) {
  s5.addImage({
    path: guardImgPath,
    x: 6.8,
    y: 1.6,
    w: 4.8,
    h: 4.8
  });
}

addSlideFooter(s5, 'Slide 5', true);


// ── SLIDE 6: THE WARDEN PORTAL (DARK THEME) ────────────────────────────────────
let s6 = pres.addSlide();
setSlideBackground(s6, COLOR_PRIMARY);
addSlideHeader(s6, 'Warden Operations & Approvals', true);

s6.addText('Home Visits & Grievance Controls:', {
  x: 0.5,
  y: 1.6,
  w: 5.5,
  h: 0.4,
  fontSize: 18,
  bold: true,
  color: COLOR_ACCENT
});

const wardenPoints = [
  'Pending Outpass Auditing: Shows student outpass details, destinations, and visit timeframes.',
  'WhatsApp Approval Status: Indicates if parent approved (green), rejected (red) or is pending response.',
  'One-Click Pass Controls: Wardens can "Grant Final Pass" or "Reject Pass" directly from their panel.',
  'Aggregated Analytics: Visualization charts on outpass counts, hostel ratios, and pending tasks.'
];

wardenPoints.forEach((p, idx) => {
  s6.addText(`✔  ${p}`, {
    x: 0.5,
    y: 2.2 + (idx * 1.1),
    w: 5.5,
    h: 0.9,
    fontSize: 13,
    fontFace: 'Arial',
    color: COLOR_TEXT_LIGHT,
    lineSpacing: 18
  });
});

// Embed Warden Portal Image
const wardenImgPath = path.join(__dirname, '../docs/assets/warden_portal.png');
if (fs.existsSync(wardenImgPath)) {
  s6.addImage({
    path: wardenImgPath,
    x: 6.8,
    y: 1.6,
    w: 4.8,
    h: 4.8
  });
}

addSlideFooter(s6, 'Slide 6', true);


// ── SLIDE 7: ADMIN ANALYTICS & TELEMETRY (DARK THEME) ───────────────────────────
let s7 = pres.addSlide();
setSlideBackground(s7, COLOR_PRIMARY);
addSlideHeader(s7, 'Admin Telemetry & Health', true);

s7.addText('System Configuration & Monitoring:', {
  x: 0.5,
  y: 1.6,
  w: 5.5,
  h: 0.4,
  fontSize: 18,
  bold: true,
  color: COLOR_ACCENT
});

const adminPoints = [
  'Live Telemetry Monitors: Real-time graphs showing scan traffic, server uptime, and active connection ratios.',
  'Database Connection Pools: Checks pool status (max 5 in free tier mode, up to 100 on paid cluster).',
  'Cache Validation Stats: Real-time monitoring of Redis client and BullMQ workers.',
  'Active Occupancy Tracking: Charts current campus/hostel ratios and lists recent system warnings.'
];

adminPoints.forEach((p, idx) => {
  s7.addText(`✔  ${p}`, {
    x: 0.5,
    y: 2.2 + (idx * 1.1),
    w: 5.5,
    h: 0.9,
    fontSize: 13,
    fontFace: 'Arial',
    color: COLOR_TEXT_LIGHT,
    lineSpacing: 18
  });
});

// Embed Admin Portal Image
const adminImgPath = path.join(__dirname, '../docs/assets/admin_portal.png');
if (fs.existsSync(adminImgPath)) {
  s7.addImage({
    path: adminImgPath,
    x: 6.8,
    y: 1.6,
    w: 4.8,
    h: 4.8
  });
}

addSlideFooter(s7, 'Slide 7', true);


// ── SLIDE 8: SCALABILITY & CONCURRENCY CONTROLS (LIGHT THEME) ───────────────────
let s8 = pres.addSlide();
setSlideBackground(s8, COLOR_LIGHT);
addSlideHeader(s8, 'Scalability & Performance Benchmarks', false);

// Text left column
s8.addText('Engineered Concurrency Mitigations:', {
  x: 0.5,
  y: 1.6,
  w: 5.5,
  h: 0.4,
  fontSize: 18,
  bold: true,
  color: COLOR_PRIMARY
});

const perfPoints = [
  'Atomic Redis Lock: Blocks double-scanning at separate gate terminals concurrently.',
  'Aggressive Dashboard Caching: Saves MongoDB aggregate CPU loads by caching Warden counters in Redis.',
  'BullMQ Notification Queues: Offloads Twilio SMS & WhatsApp notifications to background threads.',
  'Atlas Free-Tier Caps: Caps pool size and schedules idle timeouts to run reliably on free plans.'
];

perfPoints.forEach((p, idx) => {
  s8.addText(`▪  ${p}`, {
    x: 0.5,
    y: 2.2 + (idx * 1.0),
    w: 5.5,
    h: 0.8,
    fontSize: 12,
    fontFace: 'Arial',
    color: COLOR_TEXT_DARK,
    lineSpacing: 18
  });
});

// Performance table right column
s8.addText('API Latency & Capacity Benchmarks:', {
  x: 6.5,
  y: 1.6,
  w: 5.8,
  h: 0.4,
  fontSize: 15,
  bold: true,
  color: COLOR_PRIMARY
});

s8.addTable([
  [
    { text: 'Endpoint', opts: { bold: true, fill: COLOR_PRIMARY, color: COLOR_TEXT_LIGHT } },
    { text: 'Average Latency', opts: { bold: true, fill: COLOR_PRIMARY, color: COLOR_TEXT_LIGHT } },
    { text: 'Status', opts: { bold: true, fill: COLOR_PRIMARY, color: COLOR_TEXT_LIGHT } }
  ],
  ['GET /api/ready', '2 ms', 'Fast Healthcheck'],
  ['GET /api/dashboard/summary', '5 ms (Cached)', 'Redis Cache Hit'],
  ['POST /api/gatescan/scan', '35 ms', 'DB Auth + Lock'],
  ['POST /api/auth/login', '120 ms', 'Bcrypt verification'],
  ['GET /api/student/status', '24 ms', 'Indexed query']
], {
  x: 6.5,
  y: 2.2,
  w: 5.8,
  h: 3.5,
  fontSize: 10,
  fontFace: 'Arial',
  border: { type: 'solid', color: 'CBD5E1', width: 1 }
});

addSlideFooter(s8, 'Slide 8', false);


// ── SLIDE 9: GETTING STARTED & ROLLOUT (DARK THEME) ────────────────────────────
let s9 = pres.addSlide();
setSlideBackground(s9, COLOR_PRIMARY);
addSlideHeader(s9, 'Local Run & Operational Rollout', true);

// Cards for setup and deploy
s9.addShape(pres.ShapeType.rect, {
  x: 0.5,
  y: 1.8,
  w: 5.5,
  h: 4.8,
  fill: { color: COLOR_SECONDARY },
  line: { color: COLOR_ACCENT, width: 1 }
});

s9.addText('DEVELOPMENT INITIALIZATION', {
  x: 0.7,
  y: 2.0,
  w: 5.1,
  h: 0.4,
  fontSize: 14,
  bold: true,
  color: COLOR_ACCENT
});

s9.addText('1. Install dependencies across client & server:\n   $ npm run install:all\n\n2. Seed database with credentials:\n   $ npm run seed\n\n3. Start concurrent backend & frontend:\n   $ npm run dev\n\n4. Orchestrate complete local services:\n   $ docker-compose up --build', {
  x: 0.7,
  y: 2.6,
  w: 5.1,
  h: 3.5,
  fontSize: 11,
  fontFace: 'Courier New',
  color: COLOR_TEXT_LIGHT,
  lineSpacing: 18
});

s9.addShape(pres.ShapeType.rect, {
  x: 6.8,
  y: 1.8,
  w: 5.5,
  h: 4.8,
  fill: { color: COLOR_SECONDARY },
  line: { color: COLOR_PURPLE, width: 1 }
});

s9.addText('PRODUCTION DEPLOYMENT', {
  x: 7.0,
  y: 2.0,
  w: 5.1,
  h: 0.4,
  fontSize: 14,
  bold: true,
  color: COLOR_PURPLE
});

s9.addText('1. Deploy frontend client to Vercel CDN\n   Root directory: frontend/\n   Redirect config: vercel.json\n\n2. Deploy stateless API backend to Render\n   Root directory: backend/\n   Configured with auto-scaling instances\n\n3. Provision Atlas & Redis Cloud instances\n   Cap MongoDB connections pool to 5 on free tier\n   Set redis memory-policy = allkeys-lru', {
  x: 7.0,
  y: 2.6,
  w: 5.1,
  h: 3.5,
  fontSize: 11,
  fontFace: 'Courier New',
  color: COLOR_TEXT_LIGHT,
  lineSpacing: 18
});

addSlideFooter(s9, 'Slide 9', true);


// Save presentation
pres.writeFile({ fileName: path.join(docsDir, 'Heimdall_Presentation.pptx') })
  .then((fileName) => {
    console.log(`✅ Slide Presentation generated successfully at docs/Heimdall_Presentation.pptx`);
  })
  .catch((err) => {
    console.error(`❌ Error generating Slide Presentation:`, err);
  });
