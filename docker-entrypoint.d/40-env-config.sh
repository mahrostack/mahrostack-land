#!/bin/sh
set -eu

escape_js() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

raw_api_base_url="${API_BASE_URL:-${VITE_API_BASE_URL:-}}"
api_base_url="$(escape_js "${raw_api_base_url}")"
raw_app_version="${APP_VERSION:-${VITE_APP_VERSION:-dev}}"
app_version="$(escape_js "${raw_app_version}")"

cat > /usr/share/nginx/html/env-config.js <<EOF
window.__ENV__ = {
  API_BASE_URL: "${api_base_url}",
  APP_VERSION: "${app_version}",
};
EOF
