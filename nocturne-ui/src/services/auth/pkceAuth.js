// PKCE Auth Service for Spotify
// Standard OAuth 2.0 Authorization Code Flow with PKCE
// This is the recommended flow for web apps / SPAs

// Use the same scopes as the existing device auth
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-top-read",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-follow-read",
].join(" ");

// Client IDs from environment variables
const SHARED_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID_SHARED;
const DEFAULT_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || SHARED_CLIENT_ID;

// Get client ID from localStorage or use default from env
function getClientId() {
  return localStorage.getItem("spotifyClientId") || DEFAULT_CLIENT_ID;
}

// Get redirect URI based on current location
// Spotify requires https, but allows http for 127.0.0.1 (not localhost)
function getRedirectUri() {
  const origin = window.location.origin.replace('localhost', '127.0.0.1');
  return `${origin}/test/auth`;
}

// Generate random string for PKCE
function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

// Generate code verifier (43-128 chars)
function generateCodeVerifier() {
  return generateRandomString(64);
}

// Generate code challenge from verifier (SHA256 + base64url)
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);

  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Start PKCE auth flow - redirects to Spotify
export async function startPkceAuth(clientId = null) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(16);

  // Store verifier and state for callback
  localStorage.setItem("pkce_code_verifier", codeVerifier);
  localStorage.setItem("pkce_state", state);

  // Use provided clientId or get from storage/default
  const finalClientId = clientId || getClientId();
  if (clientId) {
    localStorage.setItem("spotifyClientId", clientId);
  }

  const params = new URLSearchParams({
    client_id: finalClientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state: state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  // Redirect to Spotify auth
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

// Handle callback from Spotify - exchange code for tokens
export async function handlePkceCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  // Check for errors
  if (error) {
    throw new Error(`Spotify auth error: ${error}`);
  }

  if (!code) {
    return null; // No code, not a callback
  }

  // Verify state
  const storedState = localStorage.getItem("pkce_state");
  if (state !== storedState) {
    throw new Error("State mismatch - possible CSRF attack");
  }

  // Get stored verifier
  const codeVerifier = localStorage.getItem("pkce_code_verifier");
  if (!codeVerifier) {
    throw new Error("No code verifier found - auth flow corrupted");
  }

  // Exchange code for tokens
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: getClientId(),
      grant_type: "authorization_code",
      code: code,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${response.status} - ${JSON.stringify(errorData)}`);
  }

  const tokens = await response.json();

  // Clean up PKCE storage
  localStorage.removeItem("pkce_code_verifier");
  localStorage.removeItem("pkce_state");

  // Clear URL params
  window.history.replaceState({}, document.title, window.location.pathname);

  return tokens;
}

// Refresh access token using refresh token
export async function refreshPkceToken(refreshToken) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: getClientId(),
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
  localStorage.removeItem("pkce_state");
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
