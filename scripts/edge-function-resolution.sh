#!/usr/bin/env bash
# Bundle every supabase/functions/* entry the way a raw Deno deploy does:
# no package.json, no tsconfig path map, no deno.lock, no deno.json.
# A bare `@/` import fails here. deno check inside the repo does not, because
# package.json turns on the tsconfig `@/*` paths.
set -uo pipefail

ROOT="${EDGE_RESOLUTION_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
SANDBOX="$(mktemp -d /tmp/edge-resolution.XXXXXX)"
BOOT_PID=""

cleanup() {
  if [[ -n "${BOOT_PID}" ]]; then
    kill "${BOOT_PID}" 2>/dev/null || true
    wait "${BOOT_PID}" 2>/dev/null || true
  fi
  rm -rf "${SANDBOX}"
}
trap cleanup EXIT

mkdir -p "${SANDBOX}/tree"
cp -a "${ROOT}/supabase" "${ROOT}/src" "${SANDBOX}/tree/"
if [[ -e "${SANDBOX}/tree/package.json" || -e "${SANDBOX}/tree/tsconfig.json" || -e "${SANDBOX}/tree/deno.json" || -e "${SANDBOX}/tree/deno.lock" ]]; then
  echo "sandbox copied Node or Deno config; resolution would not match prod"
  exit 1
fi
cd "${SANDBOX}/tree"

fail=0
for dir in supabase/functions/*/; do
  name="$(basename "${dir}")"
  [[ "${name}" == _* ]] && continue
  entry="${dir}index.ts"
  if [[ ! -f "${entry}" ]]; then
    echo "FAIL ${name}: missing index.ts"
    fail=1
    continue
  fi
  echo "== bundle ${name} =="
  if ! deno bundle --no-lock --no-config --output "${SANDBOX}/${name}.bundle.js" "${entry}" >"${SANDBOX}/${name}.bundle.log" 2>&1; then
    echo "FAIL bundle ${name}"
    cat "${SANDBOX}/${name}.bundle.log"
    fail=1
    continue
  fi
  echo "== boot ${name} =="
  env \
    SUPABASE_URL="http://127.0.0.1:54321" \
    SUPABASE_ANON_KEY="public-anon-key" \
    SUPABASE_SERVICE_ROLE_KEY="service-role-key" \
    deno run --no-lock --no-config -A "${entry}" >"${SANDBOX}/${name}.boot.log" 2>&1 &
  BOOT_PID=$!
  booted=0
  for _ in $(seq 1 50); do
    if grep -q "Listening on" "${SANDBOX}/${name}.boot.log" 2>/dev/null; then
      booted=1
      break
    fi
    if ! kill -0 "${BOOT_PID}" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  kill "${BOOT_PID}" 2>/dev/null || true
  wait "${BOOT_PID}" 2>/dev/null || true
  BOOT_PID=""
  if [[ "${booted}" -ne 1 ]]; then
    echo "FAIL boot ${name}"
    cat "${SANDBOX}/${name}.boot.log"
    fail=1
    continue
  fi
  echo "ok ${name}"
done

if [[ "${fail}" -ne 0 ]]; then
  echo "edge function resolution failed"
  exit 1
fi
echo "edge function resolution ok"
