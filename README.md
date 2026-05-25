HEIMDALL: Smart Campus Access & Hostel Management Platform
Heimdall is a high-performance, production-ready, secure, and highly scalable QR-based campus access and hostel management system. Built with Node.js/Express, React/Vite, MongoDB, and Redis/BullMQ, it is designed to manage up to 15,000+ students and handle heavy traffic spikes (e.g., 500–1,000 simultaneous QR scans during peak hostel rush hours).

🚀 Key Features
⚡ Sub-Second QR Scan Verification:
Dynamic QR generation with time-based OTP keys to prevent replay attacks and screenshots.
Double-scan prevention via a atomic Redis/in-memory lock mechanism (ScanLockService).
🧑‍✈️ Guard Scanner Dashboard:
Webcam/Camera-based QR scanner using html5-qrcode on the frontend.
Instantaneous real-time update of student check-in/check-out logs.
👥 Role-Based Access Control (RBAC):
Student: Generate gate-pass QR codes, check log history, file complaints, and request Home Visit passes.
Guard: Scan and authorize entry/exit QR codes instantly.
Warden: Approve/reject home visits, search/filter student records, and manage complaints.
Admin: Complete campus oversight, user management, and performance telemetry.
🏡 Home Visit & Parent Approval Workflow:
Students request home visits with custom duration.
Interactive parent approval via WhatsApp simulation / webhook responses.
Dedicated QR flow for Home Visits separate from normal daily in/out entries.
📬 Scalable Notification Engine:
Asynchronous messaging queue via BullMQ and Redis to process parent notifications without blocking the API thread.
⚙️ Free-Tier Optimization Mode:
Tuned connection pools (maxPoolSize: 5 on M0 clusters) to prevent MongoDB Atlas connection exhaustion.
Response compression, aggressive static asset caching, request rate-limiting, and debounced/throttled API polling.
🛠️ Tech Stack
Frontend: React (Vite), React Router v6, Recharts (Analytics), HTML5-QRCode, Tailwind/Vanilla CSS.
Backend: Node.js, Express, Socket.io (Real-time logs), Twilio API (WhatsApp notifications).
Database: MongoDB Atlas + Mongoose.
Caching & Queue: Redis Cloud (ioredis) + BullMQ.
Load Testing: Autocannon (Built-in load test scripts).
Containerization: Docker & Docker Compose.
📂 Project Structure

├── DEPLOYMENT.md              # Deployment guide (Render + Vercel)
├── GO_LIVE_CHECKLIST.md       # Pre-launch verification checklist
├── STAGED_ROLLOUT.md          # Stage-by-stage rollout runbook
├── package.json               # Root monorepo scripts
├── docker-compose.yml         # Dev docker orchestration
├── backend/                   # Backend API (Express & services)
│   ├── config/                # DB and Redis configuration
│   ├── loadtest/              # Autocannon stress testing scripts
│   ├── middleware/            # Auth, rate-limiter, validator middlewares
│   ├── models/                # MongoDB Schema models (User, InOutLog, HomeVisitLog, Complaint)
│   ├── routes/                # API route controllers
│   ├── services/              # Business logic (QR, ScanLock, Cache, WebSockets, WhatsApp)
│   ├── utils/                 # Logging, Twilio client, helpers
│   ├── Dockerfile             # Production container recipe for backend
│   └── server.js              # Entrypoint server
└── frontend/                  # Frontend Client (React)
    ├── src/
    │   ├── components/        # Reusable UI elements (Loader, Navbar, Modal)
    │   ├── context/           # Global Authentication state context
    │   ├── pages/             # App Pages (Dashboard, Scan, NotReturned, Register, Simulator)
    │   ├── security/          # Security utilities & XSS sanitation
    │   ├── services/          # API Axios instance & route endpoints
    │   ├── App.jsx            # Routing and pages layout
    │   └── main.jsx           # App entrypoint
    ├── Dockerfile             # Nginx static server for production frontend
    ├── nginx.conf             # Production Nginx SPA redirect config
    └── vercel.json            # Vercel deployment configurations
⚙️ Environment Variables
Backend Configuration (backend/.env)
Copy backend/.env.example to backend/.env and configure:

ini

PORT=5000
MONGODB_URI=mongodb+srv://...           # MongoDB Connection String
MONGODB_TIER=free                       # "free" or "paid" (optimizes pool size)
MONGODB_MAX_POOL_SIZE=5                 # Set to 5 for Atlas M0, up to 100 for production
JWT_SECRET=your_jwt_signing_secret      # Strong HS256 key
REDIS_URL=redis://default:...           # Redis url (Upstash / RedisLabs)
NODE_ENV=development                    # "production" or "development"
# Twilio Credentials (WhatsApp)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
PARENT_SIMULATION_MODE=true             # Emulates parent approval requests without sending real Twilio texts
Frontend Configuration (frontend/.env.development / .env.production)
ini

VITE_API_URL=http://localhost:5000/api  # Your backend URL
🏃 Local Development Quickstart
1. Prerequisite Checklist
Install Node.js (v18+ recommended)
Install MongoDB (locally or use MongoDB Atlas free tier)
Install Redis (locally or use Upstash free tier)
2. Install Dependencies
Install all frontend and backend dependencies in one command from the project root:

bash

npm run install:all
3. Seed Database
Seed standard testing roles (Admin, Warden, Guard, Students) to get started immediately:

bash

npm run seed
This will print default login credentials for testing (e.g., student, guard, warden, admin).

4. Run the Project
Start both services concurrently:

Backend Developer Server:
bash

npm run backend
Frontend Developer Server:
bash

npm run frontend
🐳 Docker Deployment (Development)
Alternatively, spin up the entire application locally using Docker Compose (includes Backend, Frontend, and Redis in local containers):

bash

docker-compose up --build
Access the frontend on http://localhost:5173 and backend API on http://localhost:5000.

📊 Performance Testing
Heimdall includes automated performance validation using Autocannon.

To run a load test on the backend:

Ensure your backend server is running.
Run the load test script:
bash

cd backend
npm run loadtest
For high-concurrency enterprise stress testing simulations:

bash

npm run loadtest:enterprise
🚢 Production Deployment
For step-by-step guides on production deployment, go-live compliance, and traffic rolling strategies, please consult the operational manuals:

📘 
DEPLOYMENT.md
: Deployment steps for Render (API) and Vercel (Frontend).
📋 
GO_LIVE_CHECKLIST.md
: Production SLOs and performance targets to satisfy.
🏁 
STAGED_ROLLOUT.md
: Safe rollout strategies, monitoring, and failover runbooks.
🛡️ Security Best Practices Implemented
Helmet Integration: Configures HTTP headers properly to secure headers and prevent sniffing attacks.
Strict CORS Policy: Allows only configured origins (e.g. your Vercel frontend) to call the API.
XSS Protection: HTML sanitization on the client-side and strict JSON parsing.
Rate Limiting: Limits maximum connection requests per IP to protect backend services from DDoS attacks during rush hours.
Lock Prevention: Redis-backed distributed lock ensures that duplicate QR scans in quick succession (e.g., within 5 seconds) are rejected atomically at the DB entry level.
