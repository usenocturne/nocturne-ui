import { networkAwareRequest } from "../utils/networkAwareRequest";

const API_BASE = "http://localhost:3000";

export async function oauthAuthorize() {
  try {
    const response = await networkAwareRequest(async () =>
      fetch(`${API_BASE}/api/link/init`, {
        method: "POST",
      }),
    );

    if (!response.ok) {
      throw new Error("Failed to initialize Nocturne device link");
    }

    const data = await response.json();
    const code = data?.code;
    return {
      code,
      verification_uri_complete: `${API_BASE}/link?code=${encodeURIComponent(
        code || "",
      )}`,
      interval: 5,
    };
  } catch (error) {
    console.error("Error initializing Nocturne device link:", error);
    throw error;
  }
}

export async function checkAuthStatus(code) {
  try {
    const response = await networkAwareRequest(async () =>
      fetch(`${API_BASE}/api/link/poll?code=${encodeURIComponent(code)}`),
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error polling Nocturne link status:", error);
    throw error;
  }
}

export async function refreshAccessToken(apiToken) {
  try {
    const response = await networkAwareRequest(async () =>
      fetch(`${API_BASE}/api/spotify/token`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }),
    );

    if (response.status === 401 || response.status === 403) {
      throw new Error("nocturne_unauthorized");
    }
    if (response.status === 404) {
      let body = null;
      try {
        body = await response.clone().json();
      } catch {
        body = null;
      }
      if (
        body &&
        (body.error === "No refresh token" ||
          body.message === "No refresh token")
      ) {
        throw new Error("no_spotify_refresh_token");
      }
      throw new Error("nocturne_unauthorized");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error fetching Spotify access token:", error);
    throw error;
  }
}

export async function revokeApiToken(apiToken, tokenToRevoke = null) {
  try {
    const response = await fetch(`${API_BASE}/api/auth/token/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ token: tokenToRevoke || apiToken }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error revoking Nocturne API token:", error);
    return false;
  }
}
