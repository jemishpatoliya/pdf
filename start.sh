#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PID=""
SVG_SERVICE_PID=""

# Cleanup function to kill background processes on exit
cleanup() {
  echo "Cleaning up..."
  if [ -n "${SVG_SERVICE_PID}" ] && kill -0 "${SVG_SERVICE_PID}" 2>/dev/null; then
    kill "${SVG_SERVICE_PID}" || true
  fi
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" || true
  fi
}
trap cleanup EXIT INT TERM

# -----------------------------
# 1️⃣ Start backend (Node.js)
# -----------------------------
echo "Starting backend..."
cd "${ROOT_DIR}/backend"

if [ -f package.json ]; then
  echo "Installing backend dependencies..."
  npm install
fi

# Start backend in background
npm start &
BACKEND_PID=$!

cd "${ROOT_DIR}"

# -----------------------------
# 2️⃣ Start svg-to-pdf-service (optional)
# -----------------------------
if [ -d "${ROOT_DIR}/frontend/svg-to-pdf-service" ]; then
  echo "Starting svg-to-pdf-service..."
  cd "${ROOT_DIR}/frontend/svg-to-pdf-service"

  if [ -f package.json ]; then
    npm install
  fi

  npm start &
  SVG_SERVICE_PID=$!

  cd "${ROOT_DIR}"
fi

# -----------------------------
# 3️⃣ Build & Start frontend (Vite)
# -----------------------------
echo "Building frontend..."
cd "${ROOT_DIR}/frontend"

if [ -f package.json ]; then
  npm install
  npm run build
fi

# Start frontend in foreground (Railway uses this process)
echo "Starting frontend..."
PORT=${PORT:-5173} npm run preview -- --host --port "${PORT}" --strictPort