#!/usr/bin/env bash
# Check the three existing Agents-vault items by stable ID.
# Never create duplicate credential items.
set -euo pipefail

vault="${OP_VAULT:-mep374l3cpdtzwibf5fswsimbi}"

if ! command -v op >/dev/null 2>&1; then
  echo "1Password CLI (op) is not on PATH." >&2
  exit 1
fi

if ! op whoami >/dev/null 2>&1; then
  echo "1Password CLI has no active session. Run 'op signin' in this terminal, then retry." >&2
  exit 1
fi

fields=(
  AGENT_API_KEY
  KV_REST_API_URL
  KV_REST_API_TOKEN
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  R2_PUBLIC_BASE_URL
  CLEANROOM_URL
  CLEANROOM_SERVICE_CREDENTIAL
  CLEANROOM_WEBHOOK_SECRET
)

for title in \
  "y4tyhoe2snpl2eki4baltvlmwi" \
  "otnqsmx6g7jpkrq2ttqlj7m4fu" \
  "wsx7fzegvrckenlgc4ov7zt25m"; do
  if op item get "$title" --vault "$vault" >/dev/null 2>&1; then
    echo "exists ${title}" >&2
    continue
  fi

  echo "Required existing item ${title} was not found in vault ${vault}." >&2
  echo "Restore the saved item; do not create a duplicate credential item." >&2
  exit 1

done
