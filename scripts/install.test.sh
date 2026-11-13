#!/usr/bin/env bash
# Exercises scripts/install.sh with fake docker, curl, and ss.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local got="$1" want="$2" label="$3"
  if [[ "$got" != "$want" ]]; then
    fail "$label: got [$got] want [$want]"
  fi
}

setup_tree() {
  local dir="$1"
  mkdir -p "$dir/scripts" "$dir/bin"
  cp "$ROOT/scripts/install.sh" "$dir/scripts/install.sh"
  cp "$ROOT/docker-compose.yml" "$dir/docker-compose.yml"
  cp "$ROOT/Caddyfile" "$dir/Caddyfile"
  chmod +x "$dir/scripts/install.sh"
  cat > "$dir/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${DOCKER_LOG:?}"
if [[ "$1" == "compose" && "$*" == *\ ps* ]]; then
  if [[ "$*" == *https* ]]; then
    echo "caddy   Up"
  fi
  echo "server   Up"
fi
exit 0
EOF
  cat > "$dir/bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$dir/bin/docker" "$dir/bin/curl"
}

run_install() {
  local dir="$1"
  shift
  DOCKER_LOG="$dir/docker.log" PATH="$dir/bin:$PATH" bash "$dir/scripts/install.sh" "$@"
}

env_value() {
  local file="$1" key="$2"
  sed -n "s/^${key}=//p" "$file"
}

echo "1. fresh install without HTTPS does not enable the caddy profile"
work="$(mktemp -d)"
setup_tree "$work"
run_install "$work" --yes
assert_eq "$(env_value "$work/.env" HTTPS_ENABLED)" "0" "https flag"
assert_eq "$(env_value "$work/.env" CADDY_DOMAIN)" "" "empty domain"
if grep -q -- '--profile https' "$work/docker.log"; then
  fail "https profile was passed without --domain"
fi
rm -rf "$work"
PASS=$((PASS + 1))

echo "2. fresh HTTPS install checks 443 and records the choice"
work="$(mktemp -d)"
setup_tree "$work"
cat > "$work/bin/ss" <<'EOF'
#!/usr/bin/env bash
echo "LISTEN 0 128 0.0.0.0:443"
EOF
chmod +x "$work/bin/ss"
set +e
DOCKER_LOG="$work/docker.log" PATH="$work/bin:$PATH" bash "$work/scripts/install.sh" --yes --domain team.example.com --email you@example.com >"$work/out" 2>"$work/err"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  fail "occupied 443 should fail a fresh HTTPS install"
fi
if [[ -f "$work/.env" ]]; then
  fail "failed port check should not write .env"
fi
grep -q "443" "$work/err"
rm -rf "$work"
PASS=$((PASS + 1))

echo "3. fresh HTTPS install writes .env and starts the https profile"
work="$(mktemp -d)"
setup_tree "$work"
run_install "$work" --yes --domain team.example.com --email you@example.com
assert_eq "$(env_value "$work/.env" HTTPS_ENABLED)" "1" "https on"
assert_eq "$(env_value "$work/.env" CADDY_DOMAIN)" "team.example.com" "domain"
assert_eq "$(env_value "$work/.env" CADDY_EMAIL)" "you@example.com" "email"
assert_eq "$(env_value "$work/.env" SERVER_URL)" "https://team.example.com" "server url"
grep -q -- '--profile https' "$work/docker.log"
secret="$(env_value "$work/.env" JWT_SECRET)"
if [[ -z "$secret" || "$secret" == "change-this-in-production" ]]; then
  fail "jwt secret was not generated"
fi
rm -rf "$work"
PASS=$((PASS + 1))

echo "4. --domain without --email is rejected in non-interactive mode"
work="$(mktemp -d)"
setup_tree "$work"
set +e
DOCKER_LOG="$work/docker.log" PATH="$work/bin:$PATH" bash "$work/scripts/install.sh" --yes --domain team.example.com >"$work/out" 2>"$work/err"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  fail "missing email should fail"
fi
grep -q "邮箱" "$work/err"
rm -rf "$work"
PASS=$((PASS + 1))

echo "5. rerun with an existing .env skips port checks and keeps secrets"
work="$(mktemp -d)"
setup_tree "$work"
cat > "$work/.env" <<'EOF'
HTTP_PORT=3000
WS_PORT=3001
POSTGRES_PORT=5432
HTTP_BIND=0.0.0.0
WS_BIND=0.0.0.0
POSTGRES_BIND=127.0.0.1
JWT_SECRET=keep-me
POSTGRES_PASSWORD=db-secret
JWT_EXPIRES_IN=7d
CORS_ORIGIN=*
SERVER_URL=http://10.0.0.8:3000
HTTPS_ENABLED=0
CADDY_DOMAIN=
CADDY_EMAIL=
EOF
cat > "$work/bin/ss" <<'EOF'
#!/usr/bin/env bash
echo "LISTEN 0 128 0.0.0.0:3000"
echo "LISTEN 0 128 0.0.0.0:3001"
echo "LISTEN 0 128 0.0.0.0:80"
echo "LISTEN 0 128 0.0.0.0:443"
EOF
chmod +x "$work/bin/ss"
run_install "$work" --yes
assert_eq "$(env_value "$work/.env" JWT_SECRET)" "keep-me" "jwt preserved"
assert_eq "$(env_value "$work/.env" SERVER_URL)" "http://10.0.0.8:3000" "url preserved"
assert_eq "$(env_value "$work/.env" HTTPS_ENABLED)" "0" "https stays off"
if grep -q -- '--profile https' "$work/docker.log"; then
  fail "rerun without https should not pass the profile"
fi
rm -rf "$work"
PASS=$((PASS + 1))

echo "6. existing /opt-style install can turn HTTPS on without rotating secrets"
work="$(mktemp -d)"
setup_tree "$work"
cat > "$work/.env" <<'EOF'
HTTP_PORT=8080
WS_PORT=8081
POSTGRES_PORT=5432
HTTP_BIND=0.0.0.0
WS_BIND=0.0.0.0
POSTGRES_BIND=127.0.0.1
JWT_SECRET=keep-me
POSTGRES_PASSWORD=db-secret
JWT_EXPIRES_IN=7d
CORS_ORIGIN=*
SERVER_URL=http://10.0.0.8:8080
HTTPS_ENABLED=0
CADDY_DOMAIN=
CADDY_EMAIL=
EOF
cat > "$work/bin/ss" <<'EOF'
#!/usr/bin/env bash
echo "LISTEN 0 128 0.0.0.0:8080"
echo "LISTEN 0 128 0.0.0.0:8081"
echo "LISTEN 0 128 0.0.0.0:443"
EOF
chmod +x "$work/bin/ss"
run_install "$work" --domain team.example.com --email you@example.com
assert_eq "$(env_value "$work/.env" JWT_SECRET)" "keep-me" "jwt preserved"
assert_eq "$(env_value "$work/.env" HTTP_PORT)" "8080" "port preserved"
assert_eq "$(env_value "$work/.env" HTTPS_ENABLED)" "1" "https enabled"
assert_eq "$(env_value "$work/.env" SERVER_URL)" "https://team.example.com" "public url"
grep -q -- '--profile https' "$work/docker.log"

# A later rerun keeps HTTPS without another flag.
: > "$work/docker.log"
run_install "$work" --yes
assert_eq "$(env_value "$work/.env" HTTPS_ENABLED)" "1" "https persisted"
assert_eq "$(env_value "$work/.env" JWT_SECRET)" "keep-me" "jwt still preserved"
grep -q -- '--profile https' "$work/docker.log"
rm -rf "$work"
PASS=$((PASS + 1))

echo "install.sh tests passed ($PASS)"
