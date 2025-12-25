# Nocturne App Changes

## Summary

Key features added to nocturne-app:

| Feature | Description |
|---------|-------------|
| **PKCE Auth** | Custom Spotify Client ID support via relay server |
| **Optimistic UI** | Instant feedback for play/pause/skip/seek actions |
| **Dial Seek** | Toggle dial between volume (default) and ±10s seek |
| **Client ID Badge** | Shows which client ID is active in Settings |
| **Loading Quotes** | Random quotes on loading screen for version tracking |
| **Dev Mode** | Debug info under progress bar (`VITE_DEV_MODE=true`) |
| **QR Loading Text** | Shows "Retrieving QR code..." instead of fake QR |
| **Fast Loading** | Faster boot with network bypass, parallel tasks, smart polling |
| **Smart Polling** | Song-end refresh, 60s pause polling, fewer API calls |

---

## Overview

This document tracks all changes made to the nocturne-app repository.

---

## PKCE Authentication with Custom Spotify Client ID

### Problem
The original auth flow used Spotify's Device Authorization flow, which only works with whitelisted client IDs (like the shared `65b708073fc0480ea92a077233ca87bd`). Using your own Spotify Client ID requires PKCE (Proof Key for Code Exchange) auth flow.

### Solution
Added PKCE auth support to both nocturned (Go daemon) and nocturne-ui (React frontend).

### Files Changed

**nocturned (Go daemon):**
- `utils/auth.go` - New file with PKCE auth implementation
- `main.go` - Added `/auth/start`, `/auth/callback`, `/auth/refresh` endpoints

**nocturne-ui (React frontend):**
- `src/services/auth/nocturnedPkceAuth.js` - PKCE client service
- `src/services/auth/pkceAuth.js` - Browser-based PKCE (dev mode)
- `src/services/authService.js` - Routes between device/PKCE auth based on client ID
- `src/components/auth/AuthScreen.jsx` - Handles both auth flows
- `src/components/auth/QRCodeDisplay.jsx` - Shows "Retrieving QR code..." when loading
- `src/components/settings/Settings.jsx` - UI to set custom client ID at runtime
- `src/hooks/useAuth.js` - WebSocket listener for PKCE tokens
- `.env` - Environment variables for client IDs

### How It Works

1. **Build time**: Set `VITE_SPOTIFY_CLIENT_ID` in `.env` to your client ID
2. **Runtime**: Or use Settings > Account > Spotify Client ID to enter one
3. **Auth detection**: `shouldUsePkceAuth()` checks if custom client ID differs from shared
4. **PKCE flow**:
   - UI calls nocturned `/auth/start` with client ID
   - nocturned generates PKCE code_verifier/challenge, returns auth URL
   - UI displays auth URL as QR code
   - User scans, completes auth on phone
   - Spotify redirects to nocturned `/auth/callback`
   - nocturned exchanges code for tokens, sends via WebSocket
   - UI receives tokens, stores in localStorage

### Nocturned Changes

Added new endpoints and auth logic to the Go daemon:

**New Files:**
- `utils/auth.go` - PKCE auth implementation with code_verifier/challenge generation

**Modified Files:**
- `main.go` - Added HTTP endpoints:
  - `POST /auth/start` - Initiates PKCE flow, returns auth URL
  - `GET /auth/callback` - Handles Spotify OAuth redirect
  - `POST /auth/refresh` - Refreshes access token
  - `GET /auth/status` - Checks pending auth status

### Building nocturned

Nocturned is a Go binary that must be cross-compiled for ARM Linux (Car Thing architecture).

**Prerequisites:**
- Docker installed (for cross-compilation)
- SSH access to device (172.16.42.2)

```bash
# 1. Cross-compile for ARM Linux using Docker
cd nocturned
docker run --rm -v "$(pwd):/app" -w /app golang:1.23-alpine \
  sh -c "GOOS=linux GOARCH=arm GOARM=7 go build -ldflags '-s -w' -o nocturned"

# 2. Deploy to device
ssh root@172.16.42.2 "mount -o remount,rw / && sv stop nocturned"
scp nocturned root@172.16.42.2:/usr/bin/nocturned
ssh root@172.16.42.2 "chmod +x /usr/bin/nocturned && mount -o remount,ro / && sv start nocturned"

# 3. Verify it's running
ssh root@172.16.42.2 "sv status nocturned"
```

**Build flags explained:**
- `GOOS=linux` - Target Linux OS
- `GOARCH=arm` - Target ARM architecture
- `GOARM=7` - ARMv7 (Car Thing's processor)
- `-ldflags '-s -w'` - Strip debug symbols for smaller binary

### Getting Your Own Spotify Client ID

1. Go to https://developer.spotify.com/dashboard
2. Click "Create App"
3. Set Redirect URI to your relay URL (e.g., `https://yourdomain.com/spotify-relay.php`)
4. Check "Web API" and "Web Playback SDK"
5. Copy the Client ID from app settings

### Auth Relay (Required for Custom Client IDs)

Spotify only allows `localhost` for HTTP redirect URIs. Since the phone can't reach the device's localhost after authorizing, a relay server is needed.

**Setup:**
1. Host `CLAUDE/spotify-relay.php` on your HTTPS server
2. Add the URL as Redirect URI in Spotify app settings
3. Set `VITE_AUTH_RELAY_URL` in `.env` to the relay URL

**Flow:**
1. Device generates PKCE code_verifier locally (stays secret)
2. Device calls relay with code_challenge and session ID
3. Relay builds Spotify auth URL, returns it for QR code
4. User scans QR, authorizes on Spotify
5. Spotify redirects to relay with auth code
6. Relay stores code, shows "success" page
7. Device polls relay for code
8. Device exchanges code for tokens locally (using stored code_verifier)

---

## Optimistic UI Updates

### Problem
When pressing play/pause, skip next/previous, or using dial seek, the UI would wait for the Spotify API response before updating. This caused noticeable lag, especially on slow connections.

### Solution
Implemented optimistic UI updates - the UI updates immediately on user action, then syncs with server response. If the API call fails, the UI reverts to the previous state.

### Features
- **Play/Pause**: Icon switches immediately, reverts if API fails
- **Skip Next/Previous**: Progress resets to 0, album art fades to 50% opacity during transition
- **Dial Seek**: Progress bar jumps immediately to new position
- **Server Sync**: All optimistic states automatically sync when server responds

### Files Changed
- `src/hooks/usePlaybackProgress.js` - Added `setOptimisticPlaying` callback
- `src/components/player/NowPlaying.jsx` - Added `isSkipping` state, optimistic updates for all playback controls

---

## Client ID Display in Settings

### Problem
Users couldn't tell which Spotify Client ID was being used (Shared, Environment, or Custom).

### Solution
Added a badge in Settings > Account showing the active client ID type with color coding.

### Display
- **Custom** (green): Using localStorage custom client ID
- **Env** (blue): Using environment variable client ID
- **Shared** (gray): Using default shared client ID

### Files Changed
- `src/components/settings/AccountInfo.jsx` - Added client ID type badge and auth type display

---

## Dial Knob Seek Toggle

### Problem
The dial knob was used for volume control, but users wanted seek functionality (skipping ads in podcasts).

### Solution
Added a toggle in Settings to switch dial behavior between volume (default) and seek (±10 seconds).

### Default
Volume control is now the default. Enable "Dial Seek" in Settings to use seek mode.

### Files Changed
- `src/components/settings/Settings.jsx` - Added `dialSeekEnabled` toggle
- `src/contexts/SettingsContext.jsx` - Default `dialSeekEnabled: false` (volume mode)
- `src/components/player/NowPlaying.jsx` - Dial seek with optimistic progress update

---

## Loading Screen Quotes

### Problem
Could not track new versions.

### Solution
Used loading screen quotes that display during loading for refrence.

### Files Changed
- `src/components/LoadingScreen.jsx` - Array of quotes, random selection on mount

---

## Token Refresh Fix

### Problem
Token refresh was stuck in infinite retry loop on 400/invalid_grant errors.

### Solution
Treat 400 errors and `invalid_grant` as permanent failures - logout instead of retry.

### Files Changed
- `src/hooks/useAuth.js` - Added check for permanent auth failures

---

## QR Code Loading State

### Problem
When loading the auth QR code, a fake/placeholder QR was shown which could confuse users.

### Solution
Replaced fake QR with "Retrieving QR code..." text message during loading.

### Files Changed
- `src/components/auth/QRCodeDisplay.jsx` - Loading state shows text instead of placeholder QR

---

## Dev Mode

### Problem
Debugging dial seek issues required visibility into internal state.

### Solution
Added `VITE_DEV_MODE` environment variable. When `true`, shows debug info under progress bar.

### Debug Info Displayed
- `progressMs` - Current playback position
- `dialSeek` - ON/OFF status
- `seek status` - idle/pending/calling API/success/failed
- `position` - Target seek position
- `last result` - OK/FAIL/-

### Files Changed
- `.env` - Added `VITE_DEV_MODE=false`
- `src/components/player/NowPlaying.jsx` - Debug panel under progress bar

---

## UI Improvements

### AuthTestPage Button Alignment
- Changed "Go to Dashboard" button to use Tailwind CSS matching Settings button style

### Settings Input Layout
- Custom client ID input and Save button now inline with flex layout

---

## Fast Loading Screen

### Problem
Loading screen took too long due to network checks, sequential tasks, and a 2-second delay after completion.

### Solution
Optimized loading with multiple improvements:

### Changes
- **Network bypass default**: Network check bypassed by default (set `localStorage.networkCheckBypass = "false"` to enable)
- **Faster retries**: 4 retries × 3s instead of single long timeout
- **Parallel tasks**: Token refresh runs in parallel (doesn't wait for boot counter)
- **Shorter delay**: 500ms at 100% (was 2s) - just enough to see completion

### Files Changed
- `src/components/common/LoadingScreen.jsx` - All loading optimizations

---

## Smart Playback Polling

### Problem
Spotify API was polled every 15 seconds regardless of playback state. When a song ended naturally, the new track info wouldn't appear for up to 15 seconds.

### Solution
Implemented smart polling that adjusts based on context:

### Features
- **Song-end detection**: Schedules refresh 500ms after song ends for instant track updates
- **Pause polling**: 60s interval when paused (was 15s) - fewer API calls when idle
- **Play polling**: Normal 15s interval when playing
- **Action-based refresh**: Already triggers refresh after skip/seek actions

### Files Changed
- `src/hooks/usePlaybackProgress.js` - Song-end detection, adaptive polling intervals

---

## Deploy Commands

```bash
# Build and deploy UI
cd nocturne-ui
npm run build
bash ../documentation/sync-to-device.sh --skip-build

# Or use the script to build + deploy
bash ../documentation/sync-to-device.sh
```
