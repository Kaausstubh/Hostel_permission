# Go-Live Checklist

## Pre-Launch
- [ ] Backend deployed with production env vars.
- [ ] Frontend deployed with `VITE_API_URL` pointing to backend `/api`.
- [ ] MongoDB Atlas connected and indexes built.
- [ ] Redis connected (`REDIS_URL`) and queue enabled.
- [ ] Health endpoint returns `ok`: `/api/health`
- [ ] Readiness endpoint returns `ready`: `/api/ready`

## Load Testing
- Run:
  - `cd backend`
  - `LOADTEST_BASE_URL=https://<backend-domain> LOADTEST_CONNECTIONS=200 LOADTEST_DURATION=60 npm run loadtest`
- Optional authenticated endpoint test:
  - Add `LOADTEST_JWT=<valid_student_jwt>`

## SLO Validation Targets
- p95 latency:
  - `/api/health` < 200 ms
  - `/api/student/status` < 600 ms
- Error rate < 1%
- Timeout rate < 0.5%

## Smoke Test Flows
- [ ] Student login/logout
- [ ] In/Out QR generation and scan
- [ ] Home-visit request and approval flow
- [ ] Complaint filing and warden resolution
- [ ] WhatsApp simulation/live notification path

## Rollback Plan
- [ ] Keep previous deploy available in host platform.
- [ ] If new deploy fails SLOs, rollback backend first.
- [ ] Re-run smoke tests after rollback.
