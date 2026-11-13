#!/usr/bin/env bash
# gteam team server installer.
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/ncwtf/gteam/main/scripts/install.sh | bash
# With options:
#   curl -fsSL https://raw.githubusercontent.com/ncwtf/gteam/main/scripts/install.sh | bash -s -- --http-port 8080 --ws-port 8081
# HTTPS (Caddy + Let's Encrypt), including an existing install in /opt/gteam:
#   cd /opt/gteam && sudo bash scripts/install.sh --domain team.example.com --email you@example.com
# Install dir defaults to /opt/gteam (or ~/gteam without root); override with GTEAM_DIR.

set -euo pipefail

REPO_URL="${GTEAM_REPO:-https://github.com/ncwtf/gteam.git}"
BRANCH="${GTEAM_BRANCH:-main}"

# When piped through curl, there is no checkout yet: clone, then re-exec from it.
SELF="${BASH_SOURCE[0]:-}"
if [[ -n "$SELF" && -f "$SELF" && -f "$(dirname "$SELF")/../docker-compose.yml" ]]; then
  ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
else
  if [[ -z "${GTEAM_DIR:-}" ]]; then
    if [[ "$(id -u)" -eq 0 ]]; then GTEAM_DIR=/opt/gteam; else GTEAM_DIR="$HOME/gteam"; fi
  fi
  command -v git >/dev/null 2>&1 || { echo "需要 git，请先安装 git" >&2; exit 1; }
  if [[ -d "$GTEAM_DIR/.git" ]]; then
    echo "更新 $GTEAM_DIR ..."
    git -C "$GTEAM_DIR" fetch -q origin "$BRANCH"
    git -C "$GTEAM_DIR" checkout -q "$BRANCH"
    git -C "$GTEAM_DIR" pull -q --ff-only origin "$BRANCH"
  else
    echo "下载 gteam 到 $GTEAM_DIR ..."
    git clone -q --depth 1 -b "$BRANCH" "$REPO_URL" "$GTEAM_DIR"
  fi
  exec bash "$GTEAM_DIR/scripts/install.sh" "$@"
fi
cd "$ROOT"

# Prompts read from the terminal so they work under curl | bash.
TTY=/dev/tty

HTTP_PORT="${HTTP_PORT:-3000}"
WS_PORT="${WS_PORT:-3001}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
HTTP_BIND="${HTTP_BIND:-0.0.0.0}"
WS_BIND="${WS_BIND:-0.0.0.0}"
POSTGRES_BIND="${POSTGRES_BIND:-127.0.0.1}"
JWT_SECRET="${JWT_SECRET:-}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
CORS_ORIGIN="${CORS_ORIGIN:-*}"
SERVER_URL="${SERVER_URL:-}"
HTTPS_ENABLED="${HTTPS_ENABLED:-0}"
CADDY_DOMAIN="${CADDY_DOMAIN:-}"
CADDY_EMAIL="${CADDY_EMAIL:-}"
YES=0
REINSTALL=0
DOMAIN_SET=0
EMAIL_SET=0
SERVER_URL_SET=0
DOMAIN_ARG=""
EMAIL_ARG=""
SERVER_URL_ARG=""

usage() {
  cat <<USAGE
gteam 团队服务器安装脚本

用法:
  bash scripts/install.sh [选项]

选项:
  --http-port PORT       HTTP API 端口 (默认 3000)
  --ws-port PORT         WebSocket 端口 (默认 3001)
  --postgres-port PORT   数据库端口，仅绑在本机 (默认 5432)
  --http-bind ADDR       HTTP 监听地址 (默认 0.0.0.0)
  --ws-bind ADDR         WebSocket 监听地址 (默认 0.0.0.0)
  --jwt-secret SECRET    JWT 密钥；不填则自动生成
  --cors ORIGIN          CORS 来源 (默认 *)
  --server-url URL       对外访问地址，用于邀请链接
  --domain HOST          启用 HTTPS，Caddy 用这个域名申请证书
  --email ADDRESS        Let's Encrypt 通知邮箱，和 --domain 一起用
  --yes, -y              非交互，直接用上面的默认值或参数
  --reinstall            覆盖已有 .env 并重新构建启动
  -h, --help             显示帮助

不传 --domain 时只启动 HTTP，和以前一样。
已有 .env 时沿用密钥和端口，不再检查端口（进程可能已经占着它们）。
给装在 /opt/gteam 的现有实例打开 HTTPS:

  cd /opt/gteam
  sudo bash scripts/install.sh --domain team.example.com --email you@example.com

示例:
  bash scripts/install.sh
  bash scripts/install.sh --yes --http-port 8080 --ws-port 8081
  bash scripts/install.sh --yes --domain team.example.com --email you@example.com
USAGE
}

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令: $1" >&2
    exit 1
  }
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ask() {
  local prompt="$1" default="$2" var="$3"
  if [[ "$YES" -eq 1 ]]; then
    printf -v "$var" '%s' "${!var:-$default}"
    return
  fi
  local current="${!var:-$default}"
  local reply
  if [[ -r "$TTY" ]]; then
    read -r -p "$prompt [$current]: " reply < "$TTY" || true
  else
    reply=""
  fi
  printf -v "$var" '%s' "${reply:-$current}"
}

ask_yes() {
  local prompt="$1" default="$2" var="$3"
  if [[ "$YES" -eq 1 ]]; then
    printf -v "$var" '%s' "$default"
    return
  fi
  local hint="y/N"
  [[ "$default" == "y" ]] && hint="Y/n"
  local reply
  if [[ -r "$TTY" ]]; then
    read -r -p "$prompt [$hint]: " reply < "$TTY" || true
  else
    reply=""
  fi
  reply="${reply:-$default}"
  case "$reply" in
    y|Y|yes|YES) printf -v "$var" '%s' "y" ;;
    *) printf -v "$var" '%s' "n" ;;
  esac
}

normalize_https() {
  case "${HTTPS_ENABLED:-0}" in
    1|true|TRUE|yes|YES) HTTPS_ENABLED=1 ;;
    *) HTTPS_ENABLED=0 ;;
  esac
}

port_in_use() {
  local port="$1" bind="$2"
  if command -v ss >/dev/null 2>&1; then
    ss -lnt | awk '{print $4}' | grep -E "(${bind}|0.0.0.0|\[::\]):${port}\$" >/dev/null 2>&1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -E ":${port}\$" >/dev/null 2>&1
  else
    return 1
  fi
}

check_port() {
  local port="$1" bind="$2"
  if port_in_use "$port" "$bind"; then
    echo "端口 ${bind}:${port} 已被占用，请换一个，或先停掉占用它的程序。" >&2
    exit 1
  fi
}

guess_server_url() {
  local ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "http://${ip}:${HTTP_PORT}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --ws-port) WS_PORT="$2"; shift 2 ;;
    --postgres-port) POSTGRES_PORT="$2"; shift 2 ;;
    --http-bind) HTTP_BIND="$2"; shift 2 ;;
    --ws-bind) WS_BIND="$2"; shift 2 ;;
    --jwt-secret) JWT_SECRET="$2"; shift 2 ;;
    --cors) CORS_ORIGIN="$2"; shift 2 ;;
    --server-url) SERVER_URL_ARG="$2"; SERVER_URL_SET=1; shift 2 ;;
    --domain) DOMAIN_ARG="$2"; DOMAIN_SET=1; shift 2 ;;
    --email) EMAIL_ARG="$2"; EMAIL_SET=1; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --reinstall) REINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

need docker
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "需要 Docker Compose（docker compose 或 docker-compose）" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker 守护进程未运行，或当前用户没有权限。试试 sudo，或把用户加入 docker 组。" >&2
  exit 1
fi

echo "=== gteam 团队服务器安装 ==="
echo

REUSE_ENV=0
if [[ -f .env && "$REINSTALL" -eq 0 ]]; then
  REUSE_ENV=1
  echo "已存在 .env，将沿用其中的密钥和端口，并跳过端口检查。若要重来，加上 --reinstall。"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  normalize_https
fi

if [[ "$DOMAIN_SET" -eq 1 ]]; then
  CADDY_DOMAIN="$DOMAIN_ARG"
  HTTPS_ENABLED=1
fi
if [[ "$EMAIL_SET" -eq 1 ]]; then
  CADDY_EMAIL="$EMAIL_ARG"
fi
if [[ "$SERVER_URL_SET" -eq 1 ]]; then
  SERVER_URL="$SERVER_URL_ARG"
fi
normalize_https

if [[ "$REUSE_ENV" -eq 0 ]]; then
  ask "HTTP API 端口" "3000" HTTP_PORT
  ask "WebSocket 端口" "3001" WS_PORT
  ask "PostgreSQL 端口（仅本机可访问）" "5432" POSTGRES_PORT

  if [[ "$DOMAIN_SET" -eq 0 ]]; then
    ENABLE_HTTPS=n
    ask_yes "启用 HTTPS（Caddy 自动申请 Let's Encrypt 证书）?" "n" ENABLE_HTTPS
    if [[ "$ENABLE_HTTPS" == "y" ]]; then
      HTTPS_ENABLED=1
      ask "域名" "" CADDY_DOMAIN
      ask "Let's Encrypt 邮箱" "" CADDY_EMAIL
    fi
  fi

  if [[ "$HTTPS_ENABLED" == "1" && "$SERVER_URL_SET" -eq 0 ]]; then
    SERVER_URL="https://${CADDY_DOMAIN}"
  elif [[ -z "$SERVER_URL" ]]; then
    SERVER_URL="$(guess_server_url)"
  fi
  ask "对外访问地址（邀请链接会用到）" "$SERVER_URL" SERVER_URL
  ask "CORS 来源（* 表示不限制）" "*" CORS_ORIGIN
  if [[ -z "$JWT_SECRET" ]]; then
    JWT_SECRET="$(rand_hex)"
    echo "已自动生成 JWT_SECRET。"
  fi
  if [[ -z "$POSTGRES_PASSWORD" ]]; then
    POSTGRES_PASSWORD="$(rand_hex)"
    echo "已自动生成数据库密码。"
  fi
elif [[ "$HTTPS_ENABLED" == "1" && "$SERVER_URL_SET" -eq 0 && "$DOMAIN_SET" -eq 1 ]]; then
  SERVER_URL="https://${CADDY_DOMAIN}"
fi

normalize_https
if [[ "$HTTPS_ENABLED" == "1" ]]; then
  if [[ -z "$CADDY_DOMAIN" || -z "$CADDY_EMAIL" ]]; then
    echo "启用 HTTPS 需要域名和邮箱。例如: --domain team.example.com --email you@example.com" >&2
    exit 1
  fi
  if [[ ! "$CADDY_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "域名无效: $CADDY_DOMAIN" >&2
    exit 1
  fi
  if [[ "$CADDY_EMAIL" != *@* ]]; then
    echo "邮箱格式不正确: $CADDY_EMAIL" >&2
    exit 1
  fi
fi

if [[ "$HTTP_PORT" == "$WS_PORT" ]]; then
  echo "HTTP 端口和 WebSocket 端口不能相同。" >&2
  exit 1
fi

# A rerun with an existing .env skips port checks: the stack may already hold them.
if [[ "$REUSE_ENV" -eq 0 ]]; then
  check_port "$HTTP_PORT" "$HTTP_BIND"
  check_port "$WS_PORT" "$WS_BIND"
  if [[ "$HTTPS_ENABLED" == "1" ]]; then
    check_port 80 "0.0.0.0"
    check_port 443 "0.0.0.0"
  fi
fi

umask 077
cat > .env <<ENV
# Generated by scripts/install.sh. Do not commit this file.
HTTP_PORT=${HTTP_PORT}
WS_PORT=${WS_PORT}
POSTGRES_PORT=${POSTGRES_PORT}
HTTP_BIND=${HTTP_BIND}
WS_BIND=${WS_BIND}
POSTGRES_BIND=${POSTGRES_BIND}
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-7d}
CORS_ORIGIN=${CORS_ORIGIN}
SERVER_URL=${SERVER_URL}
HTTPS_ENABLED=${HTTPS_ENABLED}
CADDY_DOMAIN=${CADDY_DOMAIN}
CADDY_EMAIL=${CADDY_EMAIL}
ENV
chmod 600 .env

COMPOSE_ARGS=(--env-file .env)
if [[ "$HTTPS_ENABLED" == "1" ]]; then
  COMPOSE_ARGS+=(--profile https)
fi

echo
echo "开始构建并启动（第一次会编译镜像，可能需要几分钟）..."
"${COMPOSE[@]}" "${COMPOSE_ARGS[@]}" up -d --build

echo "等待健康检查..."
ok=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

echo
if [[ "$ok" -eq 1 ]]; then
  if [[ "$HTTPS_ENABLED" == "1" ]]; then
    if ! "${COMPOSE[@]}" "${COMPOSE_ARGS[@]}" ps | grep -i caddy | grep -qiE 'up|running'; then
      echo "API 已起来，但 Caddy 没有在运行。80/443 可能被占用，或证书还没签下来。看日志："
      echo "  ${COMPOSE[*]} --profile https logs caddy"
      exit 1
    fi
  fi
  echo "安装完成。"
else
  echo "容器已启动，但健康检查还没通过。看日志："
  echo "  ${COMPOSE[*]} logs -f server"
  exit 1
fi

if [[ "$HTTPS_ENABLED" == "1" ]]; then
  cat <<DONE

对外地址:    ${SERVER_URL}
WebSocket:   wss://${CADDY_DOMAIN}/ws
健康检查:    http://127.0.0.1:${HTTP_PORT}/health

Caddy 会把 https://${CADDY_DOMAIN} 反代到 API，并把 /ws 反代到同一 HTTP 端口上的 WebSocket。
证书由 Let's Encrypt 自动申请，首次可能要一两分钟。确认 80 和 443 能从公网访问，且域名解析到这台机器。

在桌面客户端添加团队时，服务器地址填：
  ${SERVER_URL}
客户端会把 https 自动换成 wss。

数据库端口只绑在 ${POSTGRES_BIND}，不要对公网开放 5432。

常用命令：
  ${COMPOSE[*]} --profile https logs -f
  ${COMPOSE[*]} --profile https ps
  ${COMPOSE[*]} --profile https down

.env 里有密钥，请保管好，不要提交到 git。再次运行本脚本会沿用 HTTPS 设置。
DONE
else
  cat <<DONE

HTTP API:    ${SERVER_URL}
WebSocket:   客户端会把服务器地址的 http 换成 ws，并连到 /ws
健康检查:    http://127.0.0.1:${HTTP_PORT}/health

在桌面客户端添加团队时，服务器地址填：
  ${SERVER_URL}

数据库端口只绑在 ${POSTGRES_BIND}，不要对公网开放 5432。
需要 HTTPS 时重新运行并加上 --domain 和 --email。

常用命令：
  ${COMPOSE[*]} logs -f
  ${COMPOSE[*]} ps
  ${COMPOSE[*]} down

.env 里有密钥，请保管好，不要提交到 git。
DONE
fi
