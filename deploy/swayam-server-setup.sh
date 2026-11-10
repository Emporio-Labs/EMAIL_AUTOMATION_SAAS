#!/usr/bin/env bash
# Swayam Mail: one-time server setup on Chatplug-SAAS (Ubuntu, Docker already installed).
# Leaves Chatplug alone: mail uses only port 443 (HTTPS). Chatplug keeps port 80.
# Run with:  bash ~/swayam-server-setup.sh
set -euo pipefail

API_DOMAIN="api.swayammail.yugaas.in"
DIR="$HOME/swayamail"

echo "== Swayam Mail setup =="
echo "You will be asked for two secrets. Nothing you type is shown on screen."
echo
GH_TOKEN="${GH_TOKEN:-}"
[ -n "$GH_TOKEN" ] || { read -rsp "1) GitHub token (read access to EMAIL_AUTOMATION_SAAS and GO_EMAIL_WORKER): " GH_TOKEN; echo; }
read -rsp "2) Supabase service_role key (project swayam-mail > Project Settings > API Keys): " SB_SERVICE; echo
# Some web terminals paste everything twice; undo that.
undouble() { local v="$1" h=$(( ${#1} / 2 )); if [ $(( ${#v} % 2 )) -eq 0 ] && [ "${v:0:h}" = "${v:h}" ]; then echo "${v:0:h}"; else echo "$v"; fi; }
GH_TOKEN="$(undouble "$GH_TOKEN")"; SB_SERVICE="$(undouble "$SB_SERVICE")"
[ -n "$GH_TOKEN" ] && [ -n "$SB_SERVICE" ] || { echo "Both values are required."; exit 1; }

mkdir -p "$DIR" && cd "$DIR"
for repo in EMAIL_AUTOMATION_SAAS GO_EMAIL_WORKER; do
  if [ -d "$repo/.git" ]; then
    echo "-- $repo already cloned, pulling"
    git -C "$repo" pull --ff-only "https://x-access-token:${GH_TOKEN}@github.com/Emporio-Labs/${repo}.git" main
  else
    echo "-- cloning $repo"
    git clone -q "https://x-access-token:${GH_TOKEN}@github.com/Emporio-Labs/${repo}.git" "$repo"
    # Don't keep the token on disk.
    git -C "$repo" remote set-url origin "https://github.com/Emporio-Labs/${repo}.git"
  fi
done

cd "$DIR/EMAIL_AUTOMATION_SAAS/deploy"
INTERNAL_KEY="$(openssl rand -hex 32)"

cat > api.env <<EOF
NODE_ENV=production
PORT=3000
AUTH_BYPASS=false
SUPABASE_URL=https://tjfsssikwixaupsrdlja.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZnNzc2lrd2l4YXVwc3JkbGphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzMzU2ODAsImV4cCI6MjEwOTkxMTY4MH0.ddyzqmfWWIKMBlnhngssThXFZv-jVrGqzXrtsgaFOLQ
SUPABASE_SERVICE_ROLE_KEY=${SB_SERVICE}
AWS_REGION=ap-south-1
SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/637423223378/email-jobs
INTERNAL_KEY=${INTERNAL_KEY}
PLATFORM_FROM_EMAIL=noreply@yugaas.in
PLATFORM_FROM_NAME=SwayamMail
BASE_URL=https://${API_DOMAIN}
SES_CONFIGURATION_SET=config
RUN_BACKGROUND_JOBS=true
EOF

cat > worker.env <<EOF
AWS_REGION=ap-south-1
SOURCE_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/637423223378/email-jobs
DEAD_LETTER_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/637423223378/email-jobs-dlq
SES_FROM_EMAIL=noreply@yugaas.in
SES_CONFIGURATION_SET=config
INTERNAL_KEY=${INTERNAL_KEY}
WORKER_CONCURRENCY=10
MAX_RECEIVES=5
EOF
chmod 600 api.env worker.env

# HTTPS on 443 only. Chatplug owns port 80, so the certificate is fetched over 443 (TLS-ALPN).
cat > Caddyfile.shared <<'EOF'
{
	auto_https disable_redirects
}
{$API_DOMAIN} {
	tls {
		issuer acme {
			disable_http_challenge
		}
	}
	encode gzip
	@internal_job_status path /internal/job-status*
	respond @internal_job_status 404
	reverse_proxy api:3000
}
EOF

cat > docker-compose.override.yml <<'EOF'
services:
  caddy:
    ports: !override ["443:443"]
    volumes: !override
      - ./Caddyfile.shared:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
EOF

# Compose reads .env itself; sudo can drop exported variables.
echo "API_DOMAIN=${API_DOMAIN}" > .env

echo "-- building and starting (first build takes 5 to 10 minutes)"
sudo docker compose up -d --build

echo
sudo docker compose ps
echo
echo "== Done. Check in a minute with:  curl -s https://${API_DOMAIN}/health"
