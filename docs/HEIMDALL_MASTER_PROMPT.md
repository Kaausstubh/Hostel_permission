# HEIMDALL — Master System Specification & Generation Prompt

> **System Prompt for Generative Coding & Full-Stack Deployment**

```markdown
Build a production-ready, full-stack Campus & Hostel Gate Management, Room Allocation, and Geofenced Attendance System called "HEIMDALL" for institutional campuses (e.g., IIIT Pune). The platform provides role-based access for Students, Hostel Staff/Wardens, Security Guards, and Administrators with high-security anti-replay measures, real-time WebSockets, and clean dark/light glassmorphic UI.

### 1. Technology Stack & Architecture
- **Frontend**: React (Vite), React Router, React Hot Toast, Vanilla CSS (with CSS variables for sleek dark/light mode and glassmorphism), Socket.IO client, html5-qrcode, jsPDF/autoTable for PDF reports, SheetJS (xlsx) for Excel exports.
- **Backend**: Node.js, Express, MongoDB (Mongoose), Socket.IO, JWT Authentication with role-based access control (`student`, `hostel_staff`, `warden`, `security`, `admin`), Winston logger, Redis/in-memory rate limiter and anti-replay cache.
- **Timezone**: Strict Indian Standard Time (`IST`, `Asia/Kolkata`, UTC+5:30) for all timestamps, logs, and report exports.

---

### 2. Core Modules & Specifications

#### A. Automated Night Attendance & Geofenced Self-Verification
1. **Geofencing & Accuracy Engine**:
   - Geofence calculation (Haversine formula) per hostel building (e.g., BH1, BH2, GH1, GH2) with configurable allowed radius (e.g., 22m) and strict GPS accuracy threshold (<25m).
   - Mock-location and anti-tamper detection with audit logging.
2. **Two-Attempt Rule & Auto-Finalization**:
   - Students get a maximum of 2 verification attempts per night attendance round.
   - If outside the geofence or with GPS permission denied, Attempt 1 stays `PENDING` (1 attempt remaining). Attempt 2 immediately finalizes as `ABSENT`.
   - Successful geofence check immediately finalizes as `PRESENT`.
3. **Immediate Dismissal ("Leave")**:
   - As soon as status is finalized (`PRESENT` or `ABSENT`), the verification prompt completely unmounts and vanishes from the student portal with zero nag popups.
4. **Staff Room Rounds & Overrides**:
   - Warden/Staff can trigger a floor round, send real-time socket verification alerts to room occupants, and perform manual present/absent overrides with logged justifications.

#### B. Attendance Reports & Master Roster Reconciliation
1. **Zero-Omission Student Ledger**:
   - The daily attendance report must reflect **every student** enrolled in the hostel roster, even if they never opened the app:
     - Verified via GPS / staff override → `PRESENT` (Green)
     - On approved home visit leave → `ON LEAVE` (Purple)
     - Unverified / missed round → `ABSENT` (Red)
2. **Executive Multi-Format Exports**:
   - **Excel (.xlsx)**: Formatted workbook with auto-fitted columns, room numbers, floors, attendance percentages, and verification methods.
   - **PDF**: Formal institutional report with header logos, officer badge, metadata box, room round breakdown, and signature line for Hostel Warden / Chief Warden.

#### C. Student Dashboard & Conversational Portal
1. **WhatsApp-Style Interactive Chatbot ("HEIMDALL Bot")**:
   - State-machine chat options: In/Out Gate Pass, Home Visit Request, File Complaint, and "📊 View My Status".
   - Status response comprehensively includes: Current gate state (`IN`/`OUT`), active QR pass, pending/approved home visits, and **Today's Night Attendance Status** with verification timestamp.
2. **Personal Attendance History Modal**:
   - **Today's Status Hero Card**: Shows live state (`✅ Present`, `❌ Absent`, `🏠 On Approved Leave`, or `⏳ Verification Pending`) with timestamp and one-tap button: *"Verify Attendance via GPS Now"*.
   - **Summary Counter**: Quick counts of Verified Present, Absent, and Approved Leaves.
   - **Historical Ledger**: Backfills every past round conducted for their hostel so unverified dates show as `ABSENT` and leaves show as `ON LEAVE`.
3. **Sidebar & Profile Badges**:
   - Real-time dot indicator and pills on the `Attendance History` navigation item (`[Present]`, `[Absent]`, `[On Leave]`, or `[Pending]`).

#### D. 3D Room Allocation & Vacancy Console
1. **Multi-Tier Navigation**:
   - `Step 1: Select Hostel` → `Step 2: Select Floor` (Basement, Ground Floor, 1st Floor, 2nd Floor, 3rd Floor) → `Step 3: Select Room`.
   - Natural floor ordering with explicit Ground Floor representation (e.g. `Room 02`, `15`, `24`, `30`, or `G` prefix).
2. **Room Cards & 4-Bed Layout**:
   - Visual bed slots (Bed 1 to Bed 4) with occupancy status (`OCCUPIED` / `VACANT`), student details, bed transfers, vacating, and add-room modals.

#### E. Anti-Screenshot Dynamic QR Passes & Gate Security
1. **Dynamic Anti-Replay Gate Passes**:
   - 20-second dynamic TOTP/HMAC rotation in the QR code prevents static screenshots, forwarding, and token sharing.
   - Single-use scan policy: Scanning at gate validates against Redis/memory cache; duplicate scans are instantly blocked (`ALREADY_USED`).
   - Daily In/Out pass has a strict 15-minute validity window. Home visit pass retains multi-day validity for departure and return.
2. **Gate Security Dashboard**:
   - Real-time camera scanner with instant audio/visual green/red validation cards showing student photo, roll number, and pass validity.

#### F. Campus Visitor & Parent Entry System
1. **Two-Step Student Authorization**:
   - When parents arrive at the campus gate, security inputs visitor details.
   - Student's phone/laptop receives an instant socket alert popup to **Allow Entry** or **Decline**.
   - Upon student approval, security is notified to admit visitors with printed/digital slip.
2. **Pre-Fill Digital Visitor Pass**:
   - Public pre-fill web pass allowing parents to submit vehicle number and headcount in advance.

---

### 3. Polish & UI/UX Standards
- Consistent role formatting (`Hostel Staff` instead of snake_case `hostel_staff`).
- Full dark glassmorphism and clean light mode support with no unstyled components or raw placeholders.
- Robust error handling with graceful offline fallback and zero duplicate socket listeners.
```
