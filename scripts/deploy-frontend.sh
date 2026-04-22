#!/usr/bin/env bash
# Non-interactive Vercel production deploy.
# 1) Create a token: Vercel Dashboard → Settings → Tokens
# 2) First time only, link the project (once): cd frontend && npx vercel link
# 3) export VERCEL_TOKEN=... && ./scripts/deploy-frontend.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "VERCEL_TOKEN is not set."
  echo "Create one: https://vercel.com/account/tokens"
  echo "Then: export VERCEL_TOKEN=your_token && ./scripts/deploy-frontend.sh"
  exit 1
fi

# --yes avoids prompts; first deploy may still need `npx vercel link` run once from this machine
exec npx vercel deploy --prod --yes --token "$VERCEL_TOKEN"
