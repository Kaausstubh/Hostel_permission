# HEIMDALL API & Architecture Map (Discovered Codebase Specification)

> **Document Type:** Production API & System Architecture Map  
> **Target Scale:** 5,000 Registered Students | Peak 500–1,500 Concurrent Users  
> **Source Base:** Inspected directly from `/Users/kaustubh/Documents/HEMDALL/Hostel_permission`

---

## 1. System Technology Overview

| Layer | Technology | Details |
|---|---|---|
| **Frontend Framework** | React 18 + Vite (SPA) | Single-Page Application using React Router DOM v6, Axios with JWT interceptor & prewarm connection, custom Tailwind + Vanilla CSS design tokens (`index.css`), jsPDF client-side reporting, `html5-qrcode` scanner |
| **Backend Framework** | Node.js + Express 4.19 | Express REST API server, Helmet HTTP security headers, CORS origin whitelisting + credential support, Gzip compression, centralized async request ID tagging (`req.requestId`) |
| **Database** | MongoDB (Mongoose 8.4) | Connection pool size 100 max, lean queries, indexed collections (`users`, `inoutlogs`, `homevisitlogs`, `complaints`, `auditlogs`, `archivejobs`) |
| **Cache & Distributed Locking** | Redis (ioredis 5.10 / redis 5.12) | Redis cache for session caching (`session:uid:<id>`, TTL 300s), dashboard summary cache (`dashboard:summary`, TTL 30s), active QR store (`active_qr:<token>`), distributed scan locking (`scan_lock:<token>`). In-memory LRU fallback when Redis is absent. |
| **Job Queues** | BullMQ 5.76 | `scan-events` queue for asynchronous QR scan event persistence; `whatsapp` queue for background notification dispatch; `archive` queue for historical compression & Cloudflare R2 backup. In-memory synchronous fallback when Redis is absent. |
| **Real-time WebSockets** | Socket.IO 4.8.3 | Real-time events (`scan:update`, `inout:new`, `homevisit:new`) emitted to security guards and warden dashboards. |
| **QR Generation & Verification** | JWT + QRCode NPM | Signed with `QR_SECRET` (HMAC SHA-256), embeds student/visit payload, TTL 1h (daily) / 7d (home visit). Dynamic PNG rendering via `/api/qr/render`. |

---

## 2. Authentication & Authorization Mechanism

### Flow
1. **Google OAuth 2.0**:
   - Client initiates by visiting `GET /api/auth/google?portal=<student|warden|security>`.
   - Google authenticates and redirects to `GET /api/auth/google/callback?state=<portal>`.
   - Server checks email against allowed domains / whitelists (`COLLEGE_EMAIL_DOMAIN`, `WARDEN_ALLOWED_EMAILS`, `SECURITY_ALLOWED_EMAILS`).
   - Issues a stateless JWT signed with `JWT_SECRET` (`{ id: user._id }`, valid for 15 days).
   - Server redirects to frontend: `${FRONTEND_URL}/auth/callback?token=<JWT>&user=<BASE64>`.
2. **Session / Token Layer**:
   - All subsequent authenticated requests attach HTTP Header: `Authorization: Bearer <token>`.
   - `protect` middleware verifies JWT, reads user from Redis cache (`session:uid:<userId>`), falling back to MongoDB if missed.
   - `authorize('student' | 'warden' | 'security' | 'admin')` verifies user role.
3. **Logout**:
   - `POST /api/auth/logout` invalidates the Redis/in-memory session cache key (`session:uid:<userId>`).

---

## 3. Discovered API Routes

### 3.1 Authentication (`/api/auth`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/auth/google` | No | Public | Initiates Google OAuth redirect with `portal` query param |
| `GET` | `/api/auth/google/callback` | No | Public | Google callback, verifies identity, issues JWT |
| `GET` | `/api/auth/me` | Bearer JWT | Any | Returns currently authenticated user profile |
| `POST` | `/api/auth/logout` | Bearer JWT | Any | Invalidates cached session token |
| `GET` | `/api/auth/temp-reset-user` | Secret | Dev/Admin | Maintenance endpoint to reset/delete user role with secret |

### 3.2 Student Portal (`/api/student`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/student/status` | Bearer JWT | `student` | Gets active gate pass status, IN/OUT status, recent logs |
| `POST` | `/api/student/request-inout` | Bearer JWT | `student` | Requests daily gate pass QR (generates signed QR token) |
| `POST` | `/api/student/home-visit` | Bearer JWT | `student` | Submits multi-day home leave application |
| `POST` | `/api/student/complaint` | Bearer JWT | `student` | Files maintenance complaint |
| `GET` | `/api/student/complaints` | Bearer JWT | `student` | Lists student's submitted complaints with pagination |
| `GET` | `/api/student/home-visits` | Bearer JWT | `student` | Lists student's home visit applications & status |
| `POST` | `/api/student/validate-place` | Bearer JWT | `student` | Validates travel destination using geocoding service |
| `PUT` | `/api/student/onboard` | Bearer JWT | `student` | Updates onboarding profile (hostel, rollNo, phones) |
| `PUT` | `/api/student/photo` | Bearer JWT | `student` | Updates student profile face photo |

### 3.3 Gate Scan & Unified Scanner (`/api/gatescan`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/gatescan/pending-qrs` | Bearer JWT | `warden`, `security` | Returns active pending QR requests (daily + approved home visits) |
| `POST` | `/api/gatescan/scan` | Bearer JWT | `warden`, `security` | **CRITICAL HIGH PRIORITY**: Atomically validates QR token, acquires distributed scan lock (`scan_lock:<token>`), updates InOutLog/HomeVisitLog, transitions status OUT <-> IN, emits Socket.IO update |

### 3.4 In/Out Daily Gate Passes (`/api/inout`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `POST` | `/api/inout/generate-qr` | Bearer JWT | `student` | Generates QR pass for student daily egress |
| `POST` | `/api/inout/scan` | Bearer JWT | `security`, `warden` | Gate officer scan endpoint (handles OUT then IN transitions) |
| `GET` | `/api/inout/logs` | Bearer JWT | `warden`, `security` | Filterable, paginated audit log of campus entries & exits |
| `GET` | `/api/inout/not-returned` | Bearer JWT | `warden`, `security` | Real-time list of students currently marked OUT after curfew |
| `GET` | `/api/inout/history/:id` | Bearer JWT | Any | Gate movement history for a specific student ID |
| `DELETE` | `/api/inout/:id` | Bearer JWT | `warden`, `admin` | Deletes specific log record |
| `POST` | `/api/inout/purge` | Bearer JWT | `warden`, `admin` | Purges selected logs after verification |

### 3.5 Home Visits (`/api/homevisit`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `POST` | `/api/homevisit/request` | Bearer JWT | `student` | Submits home visit leave application |
| `POST` | `/api/homevisit/warden-confirm-call` | Bearer JWT | `warden` | Records warden telephonic confirmation with parents |
| `POST` | `/api/homevisit/parent-approve` | Token/Body | Public/Parent | Tokenized endpoint for parent approval link |
| `POST` | `/api/homevisit/warden-approve` | Bearer JWT | `warden` | Warden approval or rejection of home visit leave |
| `POST` | `/api/homevisit/scan` | Bearer JWT | `security`, `warden` | Guard scan for home visit departure (HOME OUT) or arrival (HOME IN) |
| `GET` | `/api/homevisit/list` | Bearer JWT | `warden`, `security` | Warden list of home leave requests with status filters |
| `GET` | `/api/homevisit/my` | Bearer JWT | `student` | Student's active and historical home leaves |
| `DELETE` | `/api/homevisit/:id` | Bearer JWT | `warden`, `admin` | Delete visit record |
| `POST` | `/api/homevisit/purge` | Bearer JWT | `warden`, `admin` | Purge home visit logs |

### 3.6 Complaints (`/api/complaints`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `POST` | `/api/complaints/file` | Bearer JWT | `student` | Files a hostel maintenance complaint |
| `GET` | `/api/complaints/status/:student_id` | Bearer JWT | Any | Returns complaint records for a student |
| `GET` | `/api/complaints/all` | Bearer JWT | `warden` | Paginated list of complaints across hostels |
| `PATCH` | `/api/complaints/:id/resolve` | Bearer JWT | `warden` | Marks complaint resolved with notes |

### 3.7 Dashboards (`/api/dashboard`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/dashboard/summary` | Bearer JWT | `warden`, `security` | Aggregate metrics (total students, out now, pending home visits, open complaints). Cached in Redis (TTL 30s) |
| `GET` | `/api/dashboard/students` | Bearer JWT | `warden`, `security` | Filterable, paginated student directory with live status |

### 3.8 WhatsApp & Webhooks (`/api/whatsapp`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `POST` | `/api/whatsapp/webhook` | Twilio Sig | Public | Inbound WhatsApp webhook for conversational bot |
| `POST` | `/api/whatsapp/test` | Secret/Dev | Dev | Test WhatsApp notification dispatcher |
| `GET` | `/api/whatsapp/simulated-messages` | Query (phone) | Public/Simulator | Polls simulated messages for in-browser WhatsApp testing |

### 3.9 Archiving & R2 Storage (`/api/archive`)
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/archive/status` | Bearer JWT | Any | Status of automated monthly archival jobs |
| `GET` | `/api/archive/jobs` | Bearer JWT | Any | Historical archival execution logs |
| `POST` | `/api/archive/trigger` | Bearer JWT | `warden`, `admin` | Manual trigger for monthly cold-storage archival |
| `POST` | `/api/archive/retrieve` | Bearer JWT | `warden`, `admin` | Retrieval request for archived logs |
| `GET` | `/api/archive/download-url/:id` | Bearer JWT | Any | Signed S3/R2 presigned download URL |
| `GET` | `/api/archive/local-download` | Bearer JWT | Any | Fallback download from local disk |
| `GET` | `/api/archive/audit-logs` | Bearer JWT | Any | Archival audit log trail |
| `GET` | `/api/archive/storage-stats` | Bearer JWT | `warden`, `security`, `admin` | Live MongoDB vs R2 storage footprint calculations |
| `GET` | `/api/archive/export-data` | Bearer JWT | `warden`, `security`, `admin` | Export logs to CSV/JSON format |
| `POST` | `/api/archive/secure-purge` | Bearer JWT | `warden`, `admin` | Purges archived records from primary MongoDB |

### 3.10 System Health & Metrics
| Method | Path | Auth Required | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/health` | No | Public | Fast health probe with uptime and request ID |
| `GET` | `/api/ready` | No | Public | Readiness probe checking MongoDB connection & Redis |
| `GET` | `/api/metrics` | Bearer JWT | `warden` | Operational metrics snapshot (event loop, memory, latency) |
| `GET` | `/api/qr/render` | No | Public | Dynamic QR image renderer (`token` query param) |
| `POST` | `/api/dev/trigger-alert`| No | Dev only | Triggers not-returned nightly curfew check |

---

## 4. Frontend Route & Portal Architecture

| Route | Role Access | Component | Purpose |
|---|---|---|---|
| `/login` | Public | `Login.jsx` | Portal selector (Student, Guard, Warden) with Google OAuth buttons |
| `/auth/callback` | Public | `OAuthCallback.jsx` | Captures JWT token and profile from OAuth redirect |
| `/student` | `student` | `StudentDashboard.jsx` | Student home: QR pass generation, status card, complaints, leave requests |
| `/onboarding` | `student` | `Onboarding.jsx` | Mandatory first-time profile completion (hostel, roll number, emergency contacts) |
| `/scanner` | `security`, `warden` | `SecurityDashboard.jsx` | High-speed QR scanner camera, manual token input, pending request queue |
| `/dashboard` | `warden` | `WardenDashboard.jsx` | Warden campus overview: active counts, curfew breaches, quick actions |
| `/students` | `warden` | `WardenStudents.jsx` | Complete student roster with room numbers, contact info, photo avatars |
| `/students-out` | `warden`, `security` | `StudentsOut.jsx` | Students currently outside campus perimeter |
| `/not-returned` | `warden` | `NotReturned.jsx` | Overdue students past curfew with emergency contact triggers |
| `/home-visits` | `warden` | `HomeVisits.jsx` | Multi-day leave requests pending parent/warden authorization |
| `/complaints` | `warden` | `ComplaintDashboard.jsx` | Facility maintenance complaints with resolution workflow |
| `/logs` | `warden`, `security` | `ScanLogs.jsx (gate)` | Real-time and historical gate entry/exit logs |
| `/home-logs` | `warden`, `admin` | `ScanLogs.jsx (home)` | Historical home visit departures and arrivals |
| `/simulator` | Public | `StudentSimulator.jsx` | Simulated WhatsApp chatbot interaction interface |
| `/home-visit/respond/:id` | Public | `ParentHomeVisitRespond.jsx` | Parent 1-click WhatsApp authorization interface |

---

## 5. Critical Concurrency & Safety Control Points

1. **Distributed Scan Lock (`scan_lock:<token>`)**:
   - Location: `backend/services/scanLockService.js`
   - Mechanism: Redis `SETNX scan_lock:<token> 1 EX 10` (or atomic in-memory mutex fallback).
   - Behavior: If Guard 1 and Guard 2 scan the identical QR within the same window, one proceeds and the second receives `HTTP 409 Conflict: Scan already in progress`.
2. **Phase Re-scan Guard (`SCAN_PHASE_GUARD_MS`)**:
   - Location: `backend/routes/gateScan.js`
   - Mechanism: Default 8-second debounce window preventing immediate accidental re-scans of the same pass before a student clears the physical turnstile.
3. **Daily Egress Transition State**:
   - Location: `backend/models/InOutLog.js` + `backend/routes/gateScan.js`
   - Initial State: OUT recorded (`returned = false`).
   - Second Scan: IN recorded (`returned = true`, `in_time = now`).
   - Third Scan: Rejected (`400: No active OUT record found` or idempotent `200: Student already marked as IN`).
