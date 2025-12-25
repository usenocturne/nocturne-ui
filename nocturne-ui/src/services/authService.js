import { networkAwareRequest } from "../utils/networkAwareRequest";
import {
  startNocturnedPkceAuth,
  startRelayPkceAuth,
  hasRelayAuth,
  refreshNocturnedToken,
  getClientId,
  getAuthType,
} from "./auth/nocturnedPkceAuth";
import { startPkceAuth } from "./auth/pkceAuth";

// Client IDs from environment variables
const SPOTIFY_CLIENT_ID_SHARED = import.meta.env.VITE_SPOTIFY_CLIENT_ID_SHARED;
const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || SPOTIFY_CLIENT_ID_SHARED;

// Check if we're in dev mode (browser without nocturned)
const IS_DEV_MODE = import.meta.env.DEV;

// Check if we should use PKCE auth (custom client ID or explicitly set)
export function shouldUsePkceAuth() {
  const customClientId = localStorage.getItem("spotifyClientId");
  const authType = localStorage.getItem("spotifyAuthType");

  // Use PKCE if:
  // 1. Custom client ID is set in localStorage (from Settings UI), OR
  // 2. Build-time env var has a custom client ID (different from shared), OR
  // 3. Auth type is explicitly "pkce"
  const hasCustomEnvClientId = SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_ID !== SPOTIFY_CLIENT_ID_SHARED;

  return customClientId || hasCustomEnvClientId || authType === "pkce";
}

// Start auth flow - uses PKCE if custom client ID, otherwise device auth
export async function oauthAuthorize() {
  // In dev mode, always use browser-based PKCE auth
  if (IS_DEV_MODE) {
    await startPkceAuth();
    // startPkceAuth redirects, so this won't be reached
    return null;
  }

  // Check if we should use PKCE auth
  if (shouldUsePkceAuth()) {
    return startPkceAuthFlow();
  }

  // Default: Device Authorization flow (requires shared client ID)
  return deviceAuthorize();
}

// PKCE auth flow - uses browser redirect in dev mode, relay or nocturned on device
async function startPkceAuthFlow() {
  // In dev mode, use browser-based PKCE auth (redirects to Spotify)
  if (IS_DEV_MODE) {
    await startPkceAuth();
    // startPkceAuth redirects, so this won't be reached
    return null;
  }

  // On device: prefer relay (works with custom client IDs), fall back to nocturned
  try {
    let response;
    let authMethod;

    if (hasRelayAuth()) {
      // Use external relay - works with any client ID
      response = await startRelayPkceAuth();
      authMethod = "relay";
    } else {
      // Fall back to nocturned (only works if user can reach localhost)
      response = await startNocturnedPkceAuth();
      authMethod = "nocturned";
    }

    // Return in format compatible with existing auth screen
    // auth_url is the Spotify authorization URL to display as QR code
    return {
      verification_uri_complete: response.auth_url || response.verification_uri_complete,
      state: response.state || response.session,
      // No device_code for PKCE - tokens come via polling or WebSocket
      device_code: null,
      auth_type: "pkce",
      auth_method: authMethod,
    };
  } catch (error) {
    console.error("Error starting PKCE auth:", error);
    throw error;
  }
}

// Device Authorization flow (original flow)
async function deviceAuthorize() {
  try {
    const response = await networkAwareRequest(async () =>
      fetch("https://accounts.spotify.com/oauth2/device/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Spotify/125700463 Win32_x86_64/0 (PC desktop)",
          "accept-language": "en-Latn-US,en-US;q=0.9,en-Latn;q=0.8,en;q=0.7",
        },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          creation_point:
            `https://login.app.spotify.com/?client_id=${SPOTIFY_CLIENT_ID}&utm_source=spotify&utm_medium=desktop-win32&utm_campaign=organic`,
          intent: "login",
          scope:
            "app-remote-control,playlist-modify,playlist-modify-private,playlist-modify-public,playlist-read,playlist-read-collaborative,playlist-read-private,streaming,ugc-image-upload,user-follow-modify,user-follow-read,user-library-modify,user-library-read,user-modify,user-modify-playback-state,user-modify-private,user-personalized,user-read-birthdate,user-read-currently-playing,user-read-email,user-read-play-history,user-read-playback-position,user-read-playback-state,user-read-private,user-read-recently-played,user-top-read",
        }).toString(),
      }),
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Spotify auth error:", response.status, errorData);
      throw new Error(`Failed to authorize oauth2 device: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return { ...data, auth_type: "device" };
  } catch (error) {
    console.error("Error authorizing oauth2 device:", error);
    throw error;
  }
}

export async function checkAuthStatus(deviceCode) {
  try {
    const response = await networkAwareRequest(async () =>
      fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      }),
    );

    if (response.status === 400) {
      const errorData = await response.json();
      if (errorData.error === "authorization_pending") {
        return {};
      }

      throw new Error(errorData.error_description || "Authorization failed");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (!error.message.includes("authorization_pending")) {
      throw error;
    }

    return {};
  }
}

export async function refreshAccessToken(refreshToken) {
  // Use PKCE refresh if we're in PKCE auth mode
  const authType = getAuthType();
  if (authType === "pkce") {
    return refreshPkceToken(refreshToken);
  }

  // Default: Device auth refresh via Spotify directly
  return refreshDeviceToken(refreshToken);
}

// Refresh token via nocturned PKCE endpoint
async function refreshPkceToken(refreshToken) {
  try {
    return await refreshNocturnedToken(refreshToken, getClientId());
  } catch (error) {
    console.error("Error refreshing PKCE token:", error);
    throw error;
  }
}

// Refresh token via Spotify directly (device auth)
async function refreshDeviceToken(refreshToken) {
  try {
    const response = await networkAwareRequest(async () =>
      fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: SPOTIFY_CLIENT_ID,
        }).toString(),
      }),
    );

    if (response.status === 400) {
      try {
        const errorData = await response.json();
        if (errorData?.error === "invalid_grant") {
          throw new Error("invalid_grant");
        }
        throw new Error(errorData?.error_description || "Token refresh failed");
      } catch {
        throw new Error("invalid_grant");
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw error;
  }
}
