# HEIMDALL: Smart Campus Access & Hostel Management Platform

[![Frontend Deployed](https://img.shields.io/badge/Frontend-Vercel-black?style=flat&logo=vercel)](https://iiitpune-hosteel-gate-management.vercel.app)
[![Backend Deployed](https://img.shields.io/badge/Backend-Render-46E3B7?style=flat&logo=render)](https://hostel-permission-7c0k.onrender.com)
[![Node.js Version](https://img.shields.io/badge/Node.js-v18%2B-green?style=flat&logo=node.js)](https://nodejs.org)
[![React Version](https://img.shields.io/badge/React-18-blue?style=flat&logo=react)](https://react.dev)
[![Database](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat&logo=mongodb)](https://www.mongodb.com/)
[![Cache & Queue](https://img.shields.io/badge/Redis-BullMQ-DC382D?style=flat&logo=redis)](https://redis.io/)
[![Storage](https://img.shields.io/badge/Object%20Storage-Cloudflare%20R2-F38020?style=flat&logo=cloudflare)](https://www.cloudflare.com/)

**HEIMDALL** is a high-availability, production-grade, secure, and horizontally scalable campus gate access and digital hostel administration platform. Engineered with **Node.js/Express**, **React/Vite**, **MongoDB Atlas**, **Redis/BullMQ**, and **Google Apps Script**, Heimdall is engineered to manage thousands of residential students and sustain intense rush-hour throughput (500–1,500 simultaneous QR scans and concurrent attendance verifications) with sub-second response times.

---

## 🌐 Live Production Deployments

*   **Production Frontend (Vercel)**: [https://iiitpune-hosteel-gate-management.vercel.app](https://iiitpune-hosteel-gate-management.vercel.app)
*   **Production API (Render)**: [https://hostel-permission-7c0k.onrender.com](https://hostel-permission-7c0k.onrender.com)
*   **Health Check Endpoint**: [https://hostel-permission-7c0k.onrender.com/api/health](https://hostel-permission-7c0k.onrender.com/api/health)

---

## 🚀 Key Features & Modules

### 1. ⚡ Sub-Second QR Scan Verification & Gate Control
*   **Dynamic Anti-Screenshot QR Codes**: Time-salted HMAC-signed QR tokens (JWT) with automatic TTL expiry (15m–1h for daily in/out passes; multi-day for home visits). Prevents static screenshot sharing and replay attacks.
*   **Atomic Distributed Double-Scan Lock (`ScanLockService`)**: Redis-backed atomic lock (with in-memory fallback) rejects rapid duplicate scans (<5s) at the DB entry level to prevent gate-crashing and database race conditions.
*   **High-FPS Webcam & Camera Scanner**: Native browser camera scanning powered by `html5-qrcode` with instant sound effects, visual grant/denial banners, and live Socket.IO gate feed.

### 2. 🏡 Digital Parent Approval System (100% Free ₹0 Budget via Google Apps Script)
*   **Zero-Cost Email Dispatch Relay**: Utilizes an automated Google Apps Script Web App (`backend/gas/Code.gs`) that harnesses free Google `MailApp` quota (100 emails/day) to dispatch branded, secure outpass approval emails without recurring SendGrid or Twilio fees.
*   **Tokenized 1-Click Action Links**: Parents receive an email containing a secure HMAC-signed token link (`/parent/home-visit/:token`) allowing instant "Approve" or "Reject" directly from their mobile browser without requiring app installation.
*   **Dedicated Parent Portal**: Comprehensive parent dashboard (`/parent/login`, `/parent/dashboard`, `/parent/request/:id`) with secure onboarding, password reset, and historical leave audit trails.
*   **Instant QR Activation & GatePass Sync**: The second a parent approves the home leave, the student's pass is instantly activated in the database and synchronized via Socket.IO, displaying a valid gate QR pass on the student's dashboard immediately.
*   **Student Guardian Linking (`StudentGuardianPrompt`)**: Students are prompted to link verified parent/guardian contacts (name, relationship, mobile, email) with duplicate-entry validation. Home visit requests are restricted to registered guardians.
*   **1-Tap Overlap Cancellation**: Clean "Cancel Previous Request & Create New" workflow enables students to immediately cancel an unscanned or overlapping pass and issue a new one in one click, preventing infinite approval deadlocks.

### 3. 📍 Geofenced Room-by-Room Attendance Module
*   **Server-Side Geofencing**: Validates student coordinates against institutional hostel perimeter polygons using Ray-Casting Point-in-Polygon and geodesic calculations, featuring a 25m indoor drift buffer and 50m accuracy threshold.
*   **App-Open Auto-Verification**: Auto-verifies student GPS location directly upon loading the student dashboard (`StudentAttendancePrompt.jsx`) with live progress feedback and automatic retry fallback.
*   **Hardware-Free Staff Night Rounds**: Hostel wardens and floor staff conduct nightly rounds room-by-room on their mobile device or tablet—tapping "Request Attendance" for a room without needing wall beacons or fingerprint scanners.
*   **Student Attendance History Modal**: Students can view their complete attendance history with dates, exact verification timestamps, and status badges.
*   **Official Institutional Reporting**: Wardens can export complete attendance registers in structured Excel (`.xlsx`) and PDF formats with date filters and room summaries.

### 4. 🚗 Campus Visitor & Vehicle Access Control
*   **Headcount Tracking**: Accurately tracks party size (`visitorCount`: 1–20) for true live campus population headcounts.
*   **Vehicle Registration Logging**: Captures and normalizes vehicle license plates (`MH12AB1234`) with exit-verification workflows.
*   **Google Form Self-Check-In Integration**: Guests scan a QR at the campus entrance to self-register via Google Forms; submissions are parsed via Google Apps Script webhook integration and pushed directly into the visitor register.
*   **Audit Exports**: Official Excel and PDF visitor logs with CSV formula injection protection (`=` / `+` / `-` / `@` neutralization).

### 5. 🗄️ Automated Data Archival to Cloudflare R2
*   **Hybrid Storage Architecture**: Active operational records reside in MongoDB Atlas for sub-10ms scans; historical records older than 3 months (`ARCHIVE_RETENTION_MONTHS`) are automatically compressed (`.json.gz`), cryptographically verified via SHA-256 checksums, uploaded to Cloudflare R2 object storage, and pruned from MongoDB.
*   **Atlas M0 Free Tier Protection**: Keeps Atlas storage well below the 512 MB free tier quota while maintaining perpetual, queryable archives.

### 6. 👥 Role-Based Access Control (RBAC) & Institutional OAuth
*   **Google OAuth 2.0 Integration**: Domain-restricted sign-in (`ALLOWED_COLLEGE_EMAIL_DOMAINS` e.g., `iiitpune.ac.in`).
*   **Five Distinct Portals**:
    *   **Student**: Dynamic gate pass QR, Home Visit chatbot with 1-tap re-create, GPS attendance, and complaints.
    *   **Parent**: Tokenized email review, student leave history, and parent dashboard.
    *   **Guard**: High-speed camera scanner, entry/exit logging, visitor check-in, and double-scan defense.
    *   **Warden / Hostel Staff**: Leave approvals/overrides, room allocation, daily attendance rounds, and report downloads.
    *   **Admin**: Role administration, guardian oversight, telemetry metrics, and archival controls.
*   **Role Whitelisting**: Granular access control via `WARDEN_ALLOWED_EMAILS` and `SECURITY_ALLOWED_EMAILS`.

### 7. 🏢 Room Allocation Module
*   Digital room and bed allocation matrix (`ROOM_ALLOCATION_MODULE_ENABLED=true`) mapping students to specific hostel buildings, wings, floors, and room numbers.

---

## 🛠️ Tech Stack Matrix

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, React Router DOM v6, Axios, Recharts, `html5-qrcode`, Leaflet, Canvas Confetti, Vanilla CSS & CSS Variables |
| **Backend API** | Node.js (v18+), Express 4.19, Socket.IO 4.8, Passport.js (Google OAuth 2.0), Helmet, Compression, CORS |
| **Database** | MongoDB Atlas (Mongoose 8.4) with tuned connection pooling (`MONGODB_MAX_POOL_SIZE=50`) |
| **Cache & Queues** | Redis Cloud / Upstash (ioredis 5.10) + BullMQ 5.76 (with in-memory LRU fallback) |
| **Email Relay** | Google Apps Script (Web App relay using `MailApp` quota, ₹0 cost), Nodemailer (SMTP fallback) |
| **Historical Archival** | Cloudflare R2 (S3-compatible Object Storage), Archiver / Zlib Gzip compression |
| **Load Testing** | Autocannon, Node.js concurrency harness (`load-tests/runner.js`, `qrStressTester.js`) |
| **Hosting & Infra** | Render (API Web Service), Vercel (SPA Frontend), Docker / Docker Compose, Caddy Reverse Proxy |

---

## 📂 Project Directory Structure

```
HEIMDALL/
├── Hostel_permission/
│   ├── ARCHIVING.md                  # Cloudflare R2 hybrid archival guide
│   ├── Caddyfile                     # Caddy reverse proxy HTTPS configuration
│   ├── DEPLOYMENT.md                 # Production deployment runbook (Render + Vercel)
│   ├── Dockerfile                    # Multi-stage production container build
│   ├── GO_LIVE_CHECKLIST.md          # Pre-flight deployment verification checklist
│   ├── ORACLE_DEPLOYMENT.md          # Oracle Cloud Always-Free VM setup guide
│   ├── STAGED_ROLLOUT.md             # Stage-by-stage rollout strategy
│   ├── USER_GUIDE.md                 # System user manual & portal guide
│   ├── docker-compose.yml            # Local development orchestration
│   ├── docker-compose.prod.yml       # Production container orchestration
│   ├── package.json                  # Root scripts & dev dependencies
│   │
│   ├── backend/                      # Express REST API Server
│   │   ├── config/                   # Database, Redis, OAuth, and env configuration
│   │   ├── gas/                      # Google Apps Script Web App source (Code.gs)
│   │   ├── jobs/                     # Schedulers (parent approval expiry, archival)
│   │   ├── middleware/               # Auth (JWT), rate-limiting, error handlers
│   │   ├── models/                   # Mongoose Schemas (User, GatePass, HomeVisitLog,
│   │   │                             #   Guardian, AttendanceRound, HostelGeofence, etc.)
│   │   ├── routes/                   # API Endpoints (auth, student, warden, guard,
│   │   │                             #   parent, attendance, visitor, adminGuardians)
│   │   ├── services/                 # Business services (gasMailService, mailService,
│   │   │                             #   scanLock, gatePassService, archiveService)
│   │   ├── utils/                    # Geofence math, token generation, report helpers
│   │   ├── server.js                 # Express application entrypoint
│   │   └── Dockerfile                # Backend container recipe
│   │
│   ├── frontend/                     # React + Vite Single-Page Application
│   │   ├── src/
│   │   │   ├── components/           # StudentAttendancePrompt, StudentGuardianPrompt,
│   │   │   │                         #   Navbar, Sidebar, Modals, Camera Scanner
│   │   │   ├── context/              # AuthContext (stateless JWT authentication)
│   │   │   ├── pages/                # StudentDashboard, ParentDashboard, ParentLogin,
│   │   │   │                         #   ParentHomeVisitRespond, AttendanceReports,
│   │   │   │                         #   GuardianManagement, Scan, Visitors, Login, etc.
│   │   │   ├── services/             # Axios API instance, backendUrl resolver
│   │   │   ├── utils/                # excelReportGenerator, pdfReportGenerator
│   │   │   ├── App.jsx               # Route definitions & protected routes
│   │   │   └── main.jsx              # React DOM entrypoint
│   │   ├── vercel.json               # SPA routing & API proxy rules
│   │   └── Dockerfile                # Production Nginx SPA container
│   │
│   └── docs/                         # Specialized module technical specs
│       ├── attendance-module.md      # Geofenced attendance technical documentation
│       ├── google-form-setup.md      # Visitor check-in Google Form setup guide
│       ├── room-allocation-module.md # Room allocation architecture guide
│       └── HEIMDALL_MASTER_PROMPT.md # Complete system specification
│
└── load-tests/                       # Enterprise Load & Stress Testing Suite
    ├── API-MAP.md                    # Discovered route map & scale specifications
    ├── runner.js                     # Multi-scenario Autocannon load test orchestrator
    ├── qrStressTester.js             # High-concurrency QR scan stress tester
    ├── seedUsers.js                  # Synthetic test user generation script
    └── cleanupUsers.js               # Synthetic test user cleanup script
```

---

## ⚙️ Environment Variables Reference

### Backend Configuration (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and configure:

```ini
# ── Core Server ───────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=5001
FRONTEND_URL=http://localhost:5173
PUBLIC_BACKEND_URL=http://localhost:5001

# ── Database & Caching ────────────────────────────────────────────────────────
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/hostel?retryWrites=true&w=majority
MONGODB_MAX_POOL_SIZE=50
MONGODB_MIN_POOL_SIZE=5

# Redis (required in prod for scan locks, pending passes, rate limits)
REDIS_URL=redis://127.0.0.1:6379

# ── Secrets (Minimum 32 characters each) ──────────────────────────────────────
JWT_SECRET=replace_with_long_random_secret_min_32_chars
QR_SECRET=replace_with_different_long_random_secret_min_32_chars
SESSION_SECRET=replace_with_another_long_random_secret_min_32_chars

# ── Google OAuth 2.0 ──────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# ── Role Whitelisting & Domain Security ───────────────────────────────────────
ALLOWED_COLLEGE_EMAIL_DOMAINS=iiitpune.ac.in,iiitp.ac.in,college.edu
WARDEN_ALLOWED_EMAILS=warden@iiitp.ac.in,hostelstaff@iiitp.ac.in
SECURITY_ALLOWED_EMAILS=guard1@iiitp.ac.in,guard2@iiitp.ac.in

# ── 100% Free Google Apps Script Email Relay (₹0 Budget) ─────────────────────
GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
GOOGLE_APPS_SCRIPT_SECRET=your_strong_shared_secret_here
APP_BASE_URL=https://iiitpune-hosteel-gate-management.vercel.app

# ── Feature Flags ─────────────────────────────────────────────────────────────
ATTENDANCE_MODULE_ENABLED=true
ROOM_ALLOCATION_MODULE_ENABLED=true
ARCHIVE_ENABLED=true
ARCHIVE_RETENTION_MONTHS=3

# ── Cloudflare R2 Historical Storage (Optional / Production) ──────────────────
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=heimdall-archives
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
```

### Frontend Configuration (`frontend/.env.development` / `frontend/.env.production`)

```ini
# Backend API destination
VITE_API_URL=https://hostel-permission-7c0k.onrender.com/api
```

---

## 🏃 Local Development Quickstart

### 1. Prerequisites
*   **Node.js**: v18.0.0 or higher
*   **MongoDB**: Local instance running on port `27017` or a free MongoDB Atlas URI
*   **Redis**: Local instance running on port `6379` or a free Upstash/Redis Cloud instance

### 2. Install Dependencies
Run from the `Hostel_permission` directory:
```bash
npm run install:all
```
*(Installs both backend and frontend dependencies concurrently).*

### 3. Seed Database with Default Test Roles
```bash
npm run seed
```
This populates sample test accounts across all roles:

| Role | Default Email / Username | Default Password | Access Portal |
|---|---|---|---|
| **Student** | `student@college.edu` | `student123` | Student Dashboard & Pass Generator |
| **Guard** | `guard@college.edu` | `guard123` | Fast Camera Scanner (`/scan`) |
| **Warden** | `warden@college.edu` | `warden123` | Approvals, Attendance, Reports |
| **Admin** | `admin@college.edu` | `admin123` | System Control, Guardian Management |

### 4. Start Development Servers
In two separate terminal windows:
```bash
# Terminal 1: Backend API (runs on http://localhost:5001)
npm run backend

# Terminal 2: Frontend Client (runs on http://localhost:5173)
npm run frontend
```

---

## 📧 Free Google Apps Script Email Relay Setup (5 Minutes)

To send parent approval emails 100% free with zero monthly cost:

1. Open [Google Apps Script](https://script.google.com/) and click **New Project**.
2. Rename project to `Heimdall-Mail-Relay`.
3. Copy the code from [`backend/gas/Code.gs`](./backend/gas/Code.gs) into the editor.
4. Click **Project Settings** (gear icon) > **Script Properties** > **Add script property**:
   *   **Property**: `HEIMDALL_SHARED_SECRET`
   *   **Value**: `<generate a secure random 32+ character string>`
5. Click **Deploy** > **New Deployment**:
   *   Select type: **Web app**
   *   Description: `Heimdall Email Relay v1`
   *   Execute as: **Me (your Gmail account)**
   *   Who has access: **Anyone** *(authentication is secured via `HEIMDALL_SHARED_SECRET` header/body validation)*
6. Click **Deploy**, authorize permissions, and copy the **Web app URL**.
7. In your backend `.env`, set:
   ```ini
   GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
   GOOGLE_APPS_SCRIPT_SECRET=your_configured_secret
   ```

---

## 🐳 Docker Deployment

To launch the full stack locally (Backend, Frontend, and Redis) using Docker Compose:

```bash
docker-compose up --build
```

*   **Frontend**: [http://localhost:5173](http://localhost:5173)
*   **Backend API**: [http://localhost:5001](http://localhost:5001)
*   **Redis**: `localhost:6379`

---

## 📊 Enterprise Performance & Stress Testing

Heimdall includes a comprehensive testing suite in `/load-tests` powered by **Autocannon**.

```bash
# 1. Seed 100 synthetic test student accounts with valid QR tokens
npm run seed-test-users

# 2. Run standard high-concurrency API performance benchmark
npm run loadtest

# 3. Run high-stress Gate QR Scanner load test (500+ scans/sec)
npm run qr-loadtest

# 4. Run exhaustive system stress test
npm run stress-test

# 5. Clean up synthetic test accounts from MongoDB
npm run cleanup-test-users
```

A complete interactive HTML load test report is automatically generated upon completion in `report.html` and `load-tests/reports/`.

---

## 🛡️ Security & Architectural Safeguards

1.  **Distributed Double-Scan Guard (`ScanLockService`)**: Atomic Redis distributed lock rejects identical QR passes presented within a 5-second interval, eliminating double-swipes and scanner race conditions.
2.  **Privacy-Preserving Geofencing**: All GPS ray-casting calculations execute strictly on the server. Exact student coordinates are never broadcast over WebSockets or stored in plaintext audit files.
3.  **CSV / Excel Injection Defense**: All exported institutional reports (Visitor and Attendance sheets) automatically sanitize cell entries beginning with `=`, `+`, `-`, or `@` to neutralize formula injection attacks.
4.  **HMAC Time-Salted Token Expiry**: QR codes are encrypted with `QR_SECRET` and include short-lived salt timestamps; screenshots become invalid after expiration.
5.  **Strict Security Headers & CORS**: Uses Helmet for defensive HTTP security headers, CORS origin whitelisting for the Vercel frontend, and rate-limiting across all student and guard API endpoints.
6.  **MongoDB Free-Tier Optimization**: Connection pooling is dynamically capped (`maxPoolSize: 5` on M0 tier; up to `50` in production) with automated idle connection cleanup.

---

## 📚 Operational Manuals & Guides

*   📘 **[DEPLOYMENT.md](./DEPLOYMENT.md)**: Full production deployment guide for Render and Vercel.
*   🗄️ **[ARCHIVING.md](./ARCHIVING.md)**: Cloudflare R2 automated data archival pipeline documentation.
*   ☁️ **[ORACLE_DEPLOYMENT.md](./ORACLE_DEPLOYMENT.md)**: Oracle Cloud Always-Free ARM VM deployment manual.
*   📋 **[GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)**: Production release verification checklist and SLO targets.
*   📖 **[USER_GUIDE.md](./USER_GUIDE.md)**: Comprehensive user and administrator portal manual.
*   📍 **[attendance-module.md](./docs/attendance-module.md)**: Deep dive into the geofenced room-by-room attendance system.
*   📋 **[google-form-setup.md](./docs/google-form-setup.md)**: Visitor self check-in Google Form and webhook setup guide.
*   🗺️ **[API-MAP.md](../load-tests/API-MAP.md)**: Complete system route map, payload specifications, and scale benchmarks.

---

## 👥 Contributors & Maintainers

Developed and maintained for smart, secure, and resilient campus management. Contributions and PRs are welcomed. Please review the [Go-Live Checklist](./GO_LIVE_CHECKLIST.md) before submitting production changes.
