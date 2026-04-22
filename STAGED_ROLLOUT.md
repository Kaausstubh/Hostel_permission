# Staged Rollout Runbook

## Stage 0: Prechecks
- Confirm `DEPLOYMENT.md` and `GO_LIVE_CHECKLIST.md` pre-launch items.
- Ensure latest DB indexes are created after deployment.
- Verify Redis connectivity and queue startup logs.

## Stage 1: Internal Validation
- Deploy backend to staging.
- Deploy frontend to staging.
- Run smoke tests with internal users only.
- Run `npm run loadtest` against staging backend.

## Stage 2: Limited Production Exposure
- Deploy backend to production.
- Keep feature usage limited to selected users (hostel admins + small student set).
- Monitor:
  - `/api/health`
  - `/api/ready`
  - error logs and queue failure logs

## Stage 3: Full Rollout
- Open access to all users.
- Monitor p95 latency and error rates for first 24 hours.
- Keep rollback path ready in hosting panel.

## Rollback Trigger Conditions
- Sustained 5xx spikes.
- Queue job failure spikes.
- Critical workflow regressions (QR scan, login, approval flow).

## Rollback Steps
1. Roll back backend to previous stable deployment.
2. Keep frontend unchanged if API contract is compatible.
3. Re-run smoke tests and readiness checks.
4. Announce incident and ETA for fix.
