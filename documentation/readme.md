# Nocturne App

Custom firmware and UI for Spotify Car Thing.

---

## 1. Project Structure

```
/nocturne-app/
├── nocturne/        # Firmware image (flashed to device)
├── nocturned/       # Go daemon (runs on device at localhost:5000)
└── nocturne-ui/     # React frontend (runs in Chromium on device)
```

| Component | Language | Purpose |
|-----------|----------|---------|
| `nocturne/` | Shell/Docker | Linux firmware build system |
| `nocturned/` | Go | Backend daemon for WiFi, Bluetooth, system, auth |
| `nocturne-ui/` | React/Vite | Spotify control UI |

---

## 2. Authentication

### Auth Methods

| Method | Client ID | How it works |
|--------|-----------|--------------|
| **Device Auth** (default) | Shared `65b708073fc0480ea92a077233ca87bd` | QR code → Spotify polls for token |
| **PKCE Auth** (custom) | Your own from developer.spotify.com | QR code → Callback to nocturned → WebSocket to UI |

### Getting Your Own Client ID

To avoid rate limits with the shared key, create your own:

1. Go to https://developer.spotify.com/dashboard
2. Click **Create App**
3. Fill in:
   - App name: `Nocturne` (or anything)
   - App description: `Car Thing controller`
   - Redirect URI: `http://127.0.0.1:5000/auth/callback`
4. Check **Web API** and **Web Playback SDK**
5. Click **Save**
6. Copy the **Client ID** from app settings

### Setting Client ID

**Option 1: Environment Variable (build time)**
```bash
cd nocturne-ui
cp .env.example .env
# Edit .env and set your Client ID
npm run build
```

**Option 2: UI Settings (runtime)**
1. Go to **Settings > Account > Spotify Client ID**
2. Paste your Client ID
3. Click **Save**, then **Sign Out**
4. Re-authenticate with the new QR code

### Key Files

| File | Purpose |
|------|---------|
| `nocturned/utils/auth.go` | PKCE auth implementation (start, callback, refresh) |
| `nocturned/main.go` | HTTP endpoints `/auth/start`, `/auth/callback`, `/auth/refresh` |
| `nocturne-ui/src/services/auth/nocturnedPkceAuth.js` | Client PKCE service |
| `nocturne-ui/src/services/authService.js` | Routes between device/PKCE auth |
| `nocturne-ui/src/hooks/useAuth.js` | WebSocket listener for auth tokens |

---

## 3. Connectivity

### How the Car Thing connects:

```
┌─────────────┐   USB-C    ┌─────────────┐
│  Car Thing  │◄──────────►│  Computer   │──► Internet
│ 172.16.42.2 │            │ 172.16.42.1 │
└─────────────┘            └─────────────┘
```

### Connection options:
1. **USB to computer** - Host shares internet via USB network
2. **Bluetooth tethering** - Phone shares internet via Bluetooth PAN
3. **Nocturne Connector** - Raspberry Pi with WiFi sharing

### SSH access:
```bash
ssh root@172.16.42.2
# Password: nocturne
```

### Windows USB Networking

```powershell
# 1. Connect Car Thing via USB-C

# 2. Find the adapter
Get-NetAdapter | Where-Object {$_.InterfaceDescription -like "*NDIS*"}

# 3. Set static IP (replace "Ethernet 2" with your adapter name)
New-NetIPAddress -InterfaceAlias "Ethernet 2" -IPAddress 172.16.42.1 -PrefixLength 24

# 4. Test connection
ping 172.16.42.2
```

---

## 4. Development

### Commands:
```bash
cd nocturne-ui
npm install      # Install dependencies
npm run dev      # Start dev server (localhost:5173)
npm run build    # Production build
npm run lint     # Format with Prettier
```

### Dev mode notes:
- Works for Spotify features in browser
- `nocturned` endpoints (WiFi, Bluetooth, device time) will show connection errors - this is expected
- Token refresh works directly via Spotify API in dev mode

### Bypass network checks in browser console:
```javascript
localStorage.setItem("networkCheckBypass", "true")
```

### Deploy to device:

**Option 1: Use sync script**
```bash
cd nocturne-ui
../documentation/sync-to-device.sh
```

**Option 2: Manual copy**
```bash
cd nocturne-ui
npm run build
ssh root@172.16.42.2 "mount -o remount,rw /"
scp -r dist/* root@172.16.42.2:/etc/nocturne/ui/
ssh root@172.16.42.2 "mount -o remount,ro / && sv restart chromium"
```

---

## 5. API Endpoints (nocturned)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/start` | POST | Start PKCE auth flow |
| `/auth/callback` | GET | Handle Spotify OAuth callback |
| `/auth/refresh` | POST | Refresh access token |
| `/auth/status` | GET | Check if auth is pending |
| `/device/date` | GET | Get device time |
| `/device/date/timezones` | GET | List available timezones |
| `/network/status` | GET | Network connectivity status |
| `/ws` | WebSocket | Real-time events (auth tokens, playback, etc.) |

---

## 6. Related Links

- [nocturne](https://github.com/usenocturne/nocturne) - Main firmware
- [nocturned](https://github.com/usenocturne/nocturned) - Go daemon
- [nocturne-ui](https://github.com/usenocturne/nocturne-ui) - React UI
- [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
