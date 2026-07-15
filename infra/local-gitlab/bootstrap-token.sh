#!/usr/bin/env bash
# Mint a known admin PAT inside the local GitLab so integration tests can auth.
# Writes the token to .local-admin-token (gitignored). Test infra only.
set -euo pipefail
CONTAINER="${1:-werknario-gitlab}"
TOKEN_VALUE="werknario-local-admin-token-0001"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

docker exec "$CONTAINER" gitlab-rails runner "
  u = User.find_by_username('root')
  u.personal_access_tokens.where(name: 'werknario-local').destroy_all
  t = u.personal_access_tokens.create!(scopes: ['api','sudo','read_repository','write_repository'], name: 'werknario-local', expires_at: 90.days.from_now)
  t.set_token('${TOKEN_VALUE}')
  t.save!
  puts 'OK token minted'
"
printf '%s' "$TOKEN_VALUE" > "$DIR/.local-admin-token"
echo "wrote $DIR/.local-admin-token"
