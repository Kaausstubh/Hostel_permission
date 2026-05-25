const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Ensure output folder exists
const docsDir = path.join(__dirname, '../docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir);
}

const pdfPath = path.join(docsDir, 'Heimdall_User_Guide.pdf');
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 60, bottom: 60, left: 50, right: 50 },
  bufferPages: true
});

const writeStream = fs.createWriteStream(pdfPath);
doc.pipe(writeStream);

// Colors (Elegant Navy/Purple Tech Theme)
const PRIMARY = '#1e1b4b';     // Deep dark navy
const ACCENT = '#4f46e5';      // Indigo
const TEXT_DARK = '#1f2937';   // Gray 800
const TEXT_MUTED = '#4b5563';  // Gray 600
const SUCCESS = '#16a34a';     // Green
const ERROR = '#dc2626';       // Red

// Helper: Header banner for cover page
function drawCoverPage() {
  // Decorative geometric accent
  doc.rect(0, 0, 595.28, 20).fill(PRIMARY);
  
  doc.moveDown(4);
  
  // Title
  doc.fillColor(PRIMARY)
     .font('Helvetica-Bold')
     .fontSize(36)
     .text('HEIMDALL', { align: 'center', characterSpacing: 2 });
  
  doc.moveDown(0.2);
  doc.fillColor(ACCENT)
     .font('Helvetica')
     .fontSize(16)
     .text('Smart Campus Access & Hostel Management System', { align: 'center' });
  
  doc.moveDown(1.5);
  
  // Decorative separator
  doc.moveTo(150, doc.y)
     .lineTo(445, doc.y)
     .strokeColor(ACCENT)
     .lineWidth(2)
     .stroke();
  
  doc.moveDown(2);
  
  // Tagline
  doc.fillColor(TEXT_DARK)
     .font('Helvetica-Bold')
     .fontSize(18)
     .text('END-TO-END PORTALS GUIDE', { align: 'center' });
  
  doc.moveDown(0.5);
  doc.fillColor(TEXT_MUTED)
     .font('Helvetica-Oblique')
     .fontSize(12)
     .text('A comprehensive manual detailing operations for Students, Guards, Wardens, and Admins.', { align: 'center' });
  
  doc.moveDown(4);
  
  // Metadata box
  doc.rect(80, doc.y, 435, 120)
     .fillOpacity(0.04)
     .fill(PRIMARY);
  
  doc.fillOpacity(1); // Restore opacity
  
  const boxTop = doc.y + 15;
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(11);
  doc.text('Version:', 100, boxTop).font('Helvetica').text('v1.1 (Production)', 170, boxTop);
  
  doc.font('Helvetica-Bold').text('Author:', 100, boxTop + 20).font('Helvetica').text('Heimdall DevOps & Engineering Team', 170, boxTop + 20);
  doc.font('Helvetica-Bold').text('System URL:', 100, boxTop + 40).font('Helvetica').text('https://heimdall-hostel.vercel.app', 170, boxTop + 40);
  doc.font('Helvetica-Bold').text('Date:', 100, boxTop + 60).font('Helvetica').text('May 2026', 170, boxTop + 60);

  // Footer on cover
  doc.fontSize(9)
     .fillColor(TEXT_MUTED)
     .text('© 2026 Heimdall System Inc. All rights reserved.', 50, 780, { align: 'center' });
  
  doc.addPage();
}

// Helper: Section Title
function addSectionHeader(title) {
  doc.moveDown(1.5);
  doc.fillColor(PRIMARY)
     .font('Helvetica-Bold')
     .fontSize(20)
     .text(title);
  
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y)
     .lineTo(545, doc.y)
     .strokeColor(ACCENT)
     .lineWidth(1)
     .stroke();
  
  doc.moveDown(1);
}

// Helper: Subsection Title
function addSubsection(title) {
  doc.moveDown(1);
  doc.fillColor(ACCENT)
     .font('Helvetica-Bold')
     .fontSize(14)
     .text(title);
  doc.moveDown(0.5);
}

// Helper: Bullet list point
function addBullet(boldText, regularText) {
  doc.fillColor(TEXT_DARK)
     .font('Helvetica-Bold')
     .fontSize(10)
     .text('  • ' + boldText + ': ', { continued: true })
     .font('Helvetica')
     .text(regularText);
  doc.moveDown(0.3);
}

// Helper: Add image with caption
function addPortalImage(imagePath, caption) {
  if (fs.existsSync(imagePath)) {
    doc.moveDown(1);
    
    // Draw box shadow or border around image
    const imgWidth = 440;
    const imgHeight = 440; // 1:1 aspect ratio matching the generated square image
    const xPos = (595.28 - imgWidth) / 2; // Center horizontally
    
    doc.rect(xPos - 2, doc.y - 2, imgWidth + 4, imgHeight + 4)
       .strokeColor('#e5e7eb')
       .lineWidth(1.5)
       .stroke();
       
    doc.image(imagePath, xPos, doc.y, { width: imgWidth, height: imgHeight });
    doc.moveDown(imgHeight / 72 + 0.5); // Move down based on rendered height points
    
    doc.fillColor(TEXT_MUTED)
       .font('Helvetica-Oblique')
       .fontSize(10)
       .text(`Figure: ${caption}`, { align: 'center' });
    
    doc.moveDown(1);
  } else {
    doc.moveDown(1);
    doc.fillColor(ERROR)
       .font('Helvetica-Bold')
       .text(`[Image Missing: ${path.basename(imagePath)}]`, { align: 'center' });
    doc.moveDown(1);
  }
}

// Draw cover page
drawCoverPage();

// TABLE OF CONTENTS & INTRODUCTION
addSectionHeader('1. Executive Overview');
doc.fillColor(TEXT_DARK)
   .font('Helvetica')
   .fontSize(11)
   .text('Heimdall is a high-availability campus gate control system designed to streamline permission checking, outpasses, and student movement tracking using dynamic QR codes. By integrating real-time Socket.io dashboards, parent-approval WhatsApp automation (via BullMQ queues), and a multi-level role authorization schema, Heimdall bridges the security gap between students, security guards, wardens, and administrative headers.', { lineGap: 4 });

doc.moveDown(1);
doc.fillColor(TEXT_DARK)
   .font('Helvetica-Bold')
   .fontSize(12)
   .text('Core Portals & Workflows Covered in This Guide:');
doc.moveDown(0.5);

addBullet('1. Student Portal', 'Self-service dashboard to generate QR gate-passes, track active status, file complaints, and request parent-approved home visits.');
addBullet('2. Guard Portal', 'Hardware-integrated camera scanning page with immediate gate clearance validation, status alerts, and access beep indicators.');
addBullet('3. Warden Portal', 'Operational hub for auditing out-of-campus logs, managing complaints, and performing final approvals on home visits.');
addBullet('4. Admin Portal', 'Telemetry and system health console showing connection status, resource charts, API performance, and config stats.');

doc.addPage();

// SECTION 1: STUDENT PORTAL
addSectionHeader('2. The Student Portal');
doc.fillColor(TEXT_DARK)
   .font('Helvetica')
   .fontSize(11)
   .text('The Student Portal acts as the central interface for students living in the campus hostels. The interface uses a dark glassmorphic design system that ensures optimal legibility on both mobile screens (at the gates) and desktop environments.', { lineGap: 3 });

addSubsection('Key Functions and Step-by-Step Flow:');
addBullet('Dynamic QR Generation', 'Every student gets a unique QR code generated using their encrypted token mixed with a time-based OTP salt. QR codes automatically expire to prevent screenshot sharing or duplicate entries.');
addBullet('Quick Status Indicator', 'Displays in real-time whether the student is marked "IN HOSTEL" (green) or "Checked OUT" (orange).');
addBullet('Home Visit Pass Request', 'Students submit outpass dates and destinations. This triggers an automated WhatsApp permission SMS to the parent.');
addBullet('Real-Time Logging', 'Maintains a live, audit-ready log of the student\'s individual past entries and exits.');

addPortalImage(path.join(__dirname, '../docs/assets/student_portal.png'), 'Student Portal Dashboard (Dynamic QR & Quick Actions)');

doc.addPage();

// SECTION 2: GUARD PORTAL
addSectionHeader('3. The Guard Scanner Portal');
doc.fillColor(TEXT_DARK)
   .font('Helvetica')
   .fontSize(11)
   .text('Deployed on terminals at campus entrance and exit gates, this portal allows guards to scan student QR codes in milliseconds. The scanner interface uses a fast native camera view and integrates socket-driven notifications to broadcast entry events immediately.', { lineGap: 3 });

addSubsection('Detailed Operations Flow:');
addBullet('Dynamic Video Feed Scanner', 'Connects directly to the guard\'s camera (desktop webcam or mobile lens) using a high-fps scanning engine.');
addBullet('Instant Alert Indicators', 'Upon scanner capture, the system queries the Heimdall API. A successful scan renders a large neon green "ACCESS GRANTED" banner accompanied by an audible beep.');
addBullet('Access Denied Handling', 'Displays a solid red warning when a QR code is expired, already scanned, or invalid. The system blocks double-scanning via an in-memory lock mechanism to prevent crowd gate-crashing.');
addBullet('Live Gate Feed', 'Shows the last 5 scanned logs on the left sidebar in real-time, allowing security heads to review recently cleared students without loading logs screens.');

addPortalImage(path.join(__dirname, '../docs/assets/guard_portal.png'), 'Guard Scanner Console (Active QR Scan with Access Granted Alert)');

doc.addPage();

// SECTION 3: WARDEN PORTAL
addSectionHeader('4. The Warden Portal');
doc.fillColor(TEXT_DARK)
   .font('Helvetica')
   .fontSize(11)
   .text('The Warden Dashboard focuses on accountability, approvals, and student welfare. Wardens supervise outpasses, verify parental responses, and resolve grievances.', { lineGap: 3 });

addSubsection('Detailed Approval Flow:');
addBullet('Queue Auditing', 'Shows all pending home-visit applications. The dashboard aggregates student profile details, destination, and visit dates.');
addBullet('WhatsApp Status Tracking', 'The portal displays real-time webhook status updates from parents. It clearly flags whether parent approval is "PENDING" (yellow warning), "APPROVED via WhatsApp" (green checkmark), or "REJECTED by Parent" (red error).');
addBullet('One-Click Override Actions', 'Wardens can instantly "Grant Final Pass" to authorize the outpass, or "Reject Pass". This updates the database and releases a valid home-visit QR code directly to the student\'s portal.');
addBullet('Analytical Widgets', 'Visual charts on weekly outpass volume, request status breakdown, and hostel distribution help wardens manage hostel capacity.');

addPortalImage(path.join(__dirname, '../docs/assets/warden_portal.png'), 'Warden Portal (Pending Outpass Approval Dashboard with Parent Approval indicators)');

doc.addPage();

// SECTION 4: ADMIN PORTAL
addSectionHeader('5. The Admin Analytics & Telemetry Portal');
doc.fillColor(TEXT_DARK)
   .font('Helvetica')
   .fontSize(11)
   .text('The Administrative Console is designed for IT managers and campus directors. It provides high-level telemetry, server performance metrics, and configuration controls.', { lineGap: 3 });

addSubsection('Telemetry and Server Analytics:');
addBullet('Real-Time Traffic Graphs', 'Charts active gate scans per minute to detect peak rush hours (e.g. 5:00 PM weekend returns).');
addBullet('System Health Gauges', 'Displays CPU load and MongoDB connection count. Shows actual database connections (e.g., 5/100 connections) to ensure Atlas Free Tier caps are never exceeded.');
addBullet('Diagnostic Metrics', 'Lists system uptime, active server versions, status of Redis caching, and error logs (zero-error status).');
addBullet('Active Campus Count', 'Displays counts of students currently logged "IN CAMPUS" versus "OUT OF CAMPUS".');

addPortalImage(path.join(__dirname, '../docs/assets/admin_portal.png'), 'Admin Analytics Dashboard (Real-time Telemetry, System Health & API Metrics)');

doc.addPage();

// OPERATIONS & SYSTEM TUNING
addSectionHeader('6. System Design & Security Safeguards');
doc.fillColor(TEXT_DARK)
   .font('Helvetica')
   .fontSize(11)
   .text('To support large campuses of 15,000+ students on modern hosting environments, Heimdall implements multiple defensive engineering architectures:', { lineGap: 4 });

doc.moveDown(1);
addBullet('1. Anti-Duplicate Lock (`ScanLockService`)', 'An atomic locking service that blocks a student\'s QR code from being scanned twice within a 5-second window. This eliminates double-read database race conditions.');
addBullet('2. Free-Tier DB Optimizations', 'MongoDB connection pool capped at 5 in free tier (`MONGODB_TIER=free`) with 15-second idle cleanups. This leaves connection headroom for cloud monitoring.');
addBullet('3. Queue-Driven Notifications', 'Parental WhatsApp notifications are handled in the background by BullMQ worker threads. If a WhatsApp API limit is hit, BullMQ automatically retries the job later without failing the gate scanner request.');
addBullet('4. Dynamic QR Encryption', 'QR payloads include JWT structures containing user identifiers signed with an HS256 secret. QRs cannot be modified or forged by students.');

doc.moveDown(2);
doc.moveTo(50, doc.y)
   .lineTo(545, doc.y)
   .strokeColor('#d1d5db')
   .lineWidth(1)
   .stroke();

doc.moveDown(2);
doc.fillColor(PRIMARY)
   .font('Helvetica-Bold')
   .fontSize(14)
   .text('Summary of Default Credentials for System Testing:');
doc.moveDown(0.5);

doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT_DARK);
doc.text('Role', 60, doc.y, { width: 100, continued: true });
doc.text('Default Email', 180, doc.y, { width: 220, continued: true });
doc.text('Password', 400, doc.y);
doc.moveDown(0.3);

// Underline table header
doc.moveTo(60, doc.y)
   .lineTo(500, doc.y)
   .strokeColor('#d1d5db')
   .lineWidth(0.5)
   .stroke();
doc.moveDown(0.5);

doc.font('Helvetica').fontSize(10);
doc.text('Admin', 60, doc.y, { width: 100, continued: true });
doc.text('admin@heimdall.com', 180, doc.y, { width: 220, continued: true });
doc.text('admin123', 400, doc.y);
doc.moveDown(0.3);

doc.text('Warden', 60, doc.y, { width: 100, continued: true });
doc.text('warden@heimdall.com', 180, doc.y, { width: 220, continued: true });
doc.text('warden123', 400, doc.y);
doc.moveDown(0.3);

doc.text('Guard', 60, doc.y, { width: 100, continued: true });
doc.text('guard@heimdall.com', 180, doc.y, { width: 220, continued: true });
doc.text('guard123', 400, doc.y);
doc.moveDown(0.3);

doc.text('Student', 60, doc.y, { width: 100, continued: true });
doc.text('kaustubh@student.com', 180, doc.y, { width: 220, continued: true });
doc.text('student123', 400, doc.y);

// Finalize PDF (write page numbers dynamically)
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  if (i > 0) { // Do not print page numbers on cover page
    doc.fillColor(TEXT_MUTED)
       .font('Helvetica')
       .fontSize(9)
       .text(`Page ${i + 1} of ${range.count}`, 50, 785, { align: 'right' });
    
    doc.text('HEIMDALL USER GUIDE — CONFIDENTIAL', 50, 785, { align: 'left' });
  }
}

doc.end();

writeStream.on('finish', () => {
  console.log('✅ PDF generated successfully at docs/Heimdall_User_Guide.pdf');
});
writeStream.on('error', (err) => {
  console.error('❌ Error generating PDF:', err);
});
