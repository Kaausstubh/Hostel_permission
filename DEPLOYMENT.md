# Deployment Guide (Scale-Ready)

## Recommended Stack
- Frontend: Vercel
- Backend API: Render (always-on Node service)
- Database: MongoDB Atlas
- Cache/Queue: Redis Cloud or Upstash
- DNS/SSL: Cloudflare

## 1) Prepare Environment Variables
- Backend template: `backend/.env.example`
- Frontend template: `frontend/.env.example`
- Never commit real `.env` values.

## 2) Deploy Backend (Render)
1. Create a new Render Web Service from this repo.
2. Set root directory to `backend`.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all backend env vars from `backend/.env.example`.
6. Verify:
   - `GET /api/health` returns `ok`
   - `GET /api/ready` returns `ready`

## 3) Deploy Frontend (Vercel)
### Option A — Dashboard (no CLI)
1. Import repo and set root directory to `frontend`.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set `VITE_API_URL` to your deployed backend API URL (`https://.../api`).
5. `frontend/vercel.json` handles SPA route rewrites.

### Option B — CLI (fully scriptable)
Vercel device login must be done in a browser; this environment cannot complete OAuth for you. For non-interactive deploys use a [Vercel token](https://vercel.com/account/tokens):

1. `cd frontend` and run **once** to link the project: `npx vercel link`
2. Set `VITE_API_URL` in the Vercel project **Environment Variables** (Production), or in a local `frontend/.env.production` before deploy.
3. Deploy from repo root:
   - `export VERCEL_TOKEN=your_token`
   - `chmod +x scripts/deploy-frontend.sh && ./scripts/deploy-frontend.sh`
   - Or: `cd frontend && VERCEL_TOKEN=... npm run deploy:vercel`

## 4) DNS and HTTPS
1. Point domain/subdomain via Cloudflare to Vercel/Render targets.
2. Ensure HTTPS is enabled on both frontend and backend domains.

## 5) Post-Deploy Verification
- Login, QR generation, gate scan, complaint flow, and home-visit approval.
- Check queue behavior with Redis enabled (`WhatsApp Queue: ENABLED` in backend logs).
- Verify health and readiness endpoints.

## 6) Rollback Strategy
- Keep previous working Render deploy.
- If critical issue appears:
  1. Roll back backend to previous deploy.
  2. Keep frontend pointing to stable backend.
  3. Re-run smoke tests and health checks.
