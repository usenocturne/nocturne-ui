#!/bin/bash
#
# Deploy Nocturne UI to Car Thing via SSH
#
# Usage:
#   ./sync-to-device.sh [--skip-build]
#

set -e

# Config
DEVICE_IP="172.16.42.2"
DEVICE_USER="root"
TARGET_PATH="/etc/nocturne/ui"

# Check for skip build flag
SKIP_BUILD=false
if [[ "$1" == "--skip-build" ]]; then
    SKIP_BUILD=true
fi

echo "=== Nocturne UI Deploy ==="
echo ""

# Step 1: Build (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
    echo "[1/5] Building..."
    cd "$(dirname "$0")/../nocturne-ui" || exit 1
    npm run build
    cd - > /dev/null
else
    echo "[1/5] Skipping build (using existing dist/)"
fi

# Determine dist path
SCRIPT_DIR="$(dirname "$0")"
DIST_PATH="${SCRIPT_DIR}/../nocturne-ui/dist"

# Step 2: Check if dist exists
if [ ! -d "$DIST_PATH" ]; then
    echo "ERROR: dist/ directory not found at $DIST_PATH"
    echo "Run without --skip-build first."
    exit 1
fi

# Step 3: Remount filesystem as read/write
echo "[2/5] Remounting filesystem rw..."
ssh -o StrictHostKeyChecking=no ${DEVICE_USER}@${DEVICE_IP} "mount -o remount,rw /"

# Step 4: Clean old assets to prevent stale file issues
echo "[3/5] Cleaning old assets..."
ssh -o StrictHostKeyChecking=no ${DEVICE_USER}@${DEVICE_IP} "rm -rf ${TARGET_PATH}/assets/* 2>/dev/null; rm -f ${TARGET_PATH}/index.html 2>/dev/null"

# Step 5: Copy files
echo "[4/5] Copying files..."
scp -o StrictHostKeyChecking=no -r "$DIST_PATH"/* ${DEVICE_USER}@${DEVICE_IP}:${TARGET_PATH}/

# Step 6: Clear browser cache, remount read-only, restart Chromium
echo "[5/5] Clearing cache and restarting..."
ssh -o StrictHostKeyChecking=no ${DEVICE_USER}@${DEVICE_IP} "\
    sv stop chromium; \
    rm -rf /var/cache/chrome_storage/* 2>/dev/null; \
    sync && mount -o remount,ro / && sv start chromium"

echo ""
echo "Done! UI deployed to ${DEVICE_IP}:${TARGET_PATH}"
