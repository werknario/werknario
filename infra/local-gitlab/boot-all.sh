#!/usr/bin/env bash
# One-shot: start Docker Desktop, boot local GitLab CE, mint an admin token.
# Designed to run unattended in the background. Logs to boot.log, final
# state to .boot-status (READY / FAILED:<reason>). Test infra only.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$DIR/boot.log"
STATUS="$DIR/.boot-status"
: > "$LOG"
echo "STARTING" > "$STATUS"
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "ensuring Docker Desktop is running"
open -a Docker 2>>"$LOG" || log "open -a Docker returned non-zero (may already be starting)"

# wait for daemon (max 4 min)
for i in $(seq 1 48); do
  if docker info >/dev/null 2>&1; then log "docker daemon up"; break; fi
  sleep 5
  if [ "$i" -eq 48 ]; then log "docker daemon never came up"; echo "FAILED:docker-daemon" > "$STATUS"; exit 1; fi
done

log "compose up gitlab (pull may take a while)"
if ! docker compose -f "$DIR/docker-compose.yml" up -d >>"$LOG" 2>&1; then
  log "compose up failed"; echo "FAILED:compose-up" > "$STATUS"; exit 1
fi

# wait for GitLab to answer 200/302 on the login page (max ~18 min)
log "waiting for GitLab HTTP (this is the slow part, 5-12 min typical)"
for i in $(seq 1 108); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:9180/users/sign_in 2>/dev/null || echo 000)
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then log "GitLab HTTP up (code $code)"; break; fi
  sleep 10
  if [ "$i" -eq 108 ]; then log "GitLab never answered HTTP"; echo "FAILED:gitlab-http" > "$STATUS"; exit 1; fi
done

# GitLab can answer HTTP before rails is fully ready; give reconfigure a moment then mint token (retry)
log "minting admin token"
for i in $(seq 1 12); do
  if bash "$DIR/bootstrap-token.sh" werknario-gitlab >>"$LOG" 2>&1; then log "token minted"; echo "READY" > "$STATUS"; exit 0; fi
  log "token mint attempt $i failed, retrying in 20s"
  sleep 20
done
log "token mint never succeeded"; echo "FAILED:token-mint" > "$STATUS"; exit 1
