// PKCE Auth via nocturned daemon or external relay
// This allows using custom Spotify Client IDs on the Car Thing

// Nocturned daemon runs on localhost
const NOCTURNED_BASE = "http://127.0.0.1:5000";

// External relay URL for PKCE (required for custom client IDs)
// Without a relay, PKCE won't work because Spotify only allows localhost redirects
const AUTH_RELAY_URL = import.meta.env.VITE_AUTH_RELAY_URL;

// Check if we're in dev mode (browser without nocturned)
const IS_DEV_MODE = import.meta.env.DEV;

// Client IDs from environment variables
const SHARED_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID_SHARED;
const DEFAULT_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || SHARED_CLIENT_ID;

// Get client ID from localStorage or use default from env
export function getClientId() {
  return localStorage.getItem("spotifyClientId") || DEFAULT_CLIENT_ID;
}

// Check if a client ID is available
export function hasClientId() {
  return !!getClientId();
}

// Check if relay-based PKCE is available
export function hasRelayAuth() {
  return !!AUTH_RELAY_URL;
}

// Set custom client ID
export function setClientId(clientId) {
  if (clientId) {
    localStorage.setItem("spotifyClientId", clientId);
  } else {
    localStorage.removeItem("spotifyClientId");
  }
}

// Generate random string for PKCE
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

// Generate code challenge from verifier (SHA256 + base64url)
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Start PKCE auth flow via relay
// Returns { auth_url, session } - display auth_url as QR code for user to scan
export async function startRelayPkceAuth(clientId = null) {
  if (!AUTH_RELAY_URL) {
    throw new Error("No auth relay URL configured. Set VITE_AUTH_RELAY_URL in .env");
  }

  const finalClientId = clientId || getClientId();

  // Generate PKCE values locally (code_verifier stays on device for security)
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const session = generateRandomString(16);

  // Store code verifier for later token exchange
  localStorage.setItem("pkce_code_verifier", codeVerifier);
  localStorage.setItem("pkce_session", session);

  // Call relay to get auth URL
  const params = new URLSearchParams({
    action: 'start',
    client_id: finalClientId,
    session: session,
    code_challenge: codeChallenge
  });

  const response = await fetch(`${AUTH_RELAY_URL}?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to start auth: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  // Store client ID for later refresh calls
  if (clientId) {
    setClientId(clientId);
  }

  const data = await response.json();

  // Store redirect URI for token exchange
  if (data.redirect_uri) {
    localStorage.setItem("pkce_redirect_uri", data.redirect_uri);
  }

  return {
    auth_url: data.auth_url,
    verification_uri_complete: data.auth_url, // For compatibility with existing UI
    session: data.session
  };
}

// Poll relay for auth code
export async function pollRelayForCode() {
  if (!AUTH_RELAY_URL) {
    return { pending: false, code: null };
  }

  const session = localStorage.getItem("pkce_session");
  if (!session) {
    return { pending: false, code: null };
  }

  try {
    const params = new URLSearchParams({
      action: 'check',
      session: session
    });

    const response = await fetch(`${AUTH_RELAY_URL}?${params.toString()}`);

    if (!response.ok) {
      if (response.status === 404) {
        return { pending: false, code: null };
      }
      throw new Error(`Relay check failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error polling relay:", error);
    return { pending: true, code: null };
  }
}

// Exchange auth code for tokens (called after relay returns code)
export async function exchangeCodeForTokens(code) {
  const codeVerifier = localStorage.getItem("pkce_code_verifier");
  const redirectUri = localStorage.getItem("pkce_redirect_uri");
  const clientId = getClientId();

  if (!codeVerifier || !redirectUri) {
    throw new Error("Missing PKCE state - auth flow may have been interrupted");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  // Clean up PKCE state
  localStorage.removeItem("pkce_code_verifier");
  localStorage.removeItem("pkce_session");
  localStorage.removeItem("pkce_redirect_uri");

  return await response.json();
}

// Start PKCE auth flow via nocturned (legacy, for localhost redirect)
// Returns { auth_url, state } - display auth_url as QR code for user to scan
export async function startNocturnedPkceAuth(clientId = null) {
  const finalClientId = clientId || getClientId();

  const response = await fetch(`${NOCTURNED_BASE}/auth/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: finalClientId,
      redirect_uri: `${NOCTURNED_BASE}/auth/callback`,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to start auth: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  // Store client ID for later refresh calls
  if (clientId) {
    setClientId(clientId);
  }

  return await response.json();
}

// Refresh access token via nocturned (or direct Spotify API in dev mode)
export async function refreshNocturnedToken(refreshToken, clientId = null) {
  const finalClientId = clientId || getClientId();

  // In dev mode, use direct Spotify API since nocturned isn't running
  if (IS_DEV_MODE) {
    return refreshTokenDirect(refreshToken, finalClientId);
  }

  const response = await fetch(`${NOCTURNED_BASE}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: finalClientId,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData?.error?.includes("invalid_grant")) {
      throw new Error("invalid_grant");
    }
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  return await response.json();
}

// Direct Spotify API refresh (for dev mode when nocturned isn't available)
async function refreshTokenDirect(refreshToken, clientId) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData?.error === "invalid_grant") {
      throw new Error("invalid_grant");
    }
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  return await response.json();
}

// Check if auth is pending (nocturned)
export async function getAuthStatus() {
  const response = await fetch(`${NOCTURNED_BASE}/auth/status`);
  if (!response.ok) {
    return { pending: false, state: "" };
  }
  return await response.json();
}

// Save tokens to localStorage (same format as existing app)
export function saveTokens(tokens) {
  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + (tokens.expires_in || 3600) - 600);

  localStorage.setItem("spotifyAccessToken", tokens.access_token);
  localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());
  localStorage.setItem("spotifyAuthType", "pkce");

  if (tokens.refresh_token) {
    localStorage.setItem("spotifyRefreshToken", tokens.refresh_token);
  }
}

// Clear all auth data
export function clearAuth() {
  localStorage.removeItem("spotifyAccessToken");
  localStorage.removeItem("spotifyRefreshToken");
  localStorage.removeItem("spotifyTokenExpiry");
  localStorage.removeItem("spotifyAuthType");
  localStorage.removeItem("pkce_code_verifier");
  localStorage.removeItem("pkce_session");
  localStorage.removeItem("pkce_redirect_uri");
}

// Check if we have valid tokens
export function hasValidTokens() {
  const accessToken = localStorage.getItem("spotifyAccessToken");
  const expiry = localStorage.getItem("spotifyTokenExpiry");

  if (!accessToken || !expiry) return false;

  return new Date(expiry) > new Date();
}

// Get current access token
export function getAccessToken() {
  return localStorage.getItem("spotifyAccessToken");
}

// Get refresh token
export function getRefreshToken() {
  return localStorage.getItem("spotifyRefreshToken");
}

// Get auth type (pkce or device)
export function getAuthType() {
  return localStorage.getItem("spotifyAuthType") || "device";
}

// Check if using PKCE auth
export function isPkceAuth() {
  return getAuthType() === "pkce";
}
