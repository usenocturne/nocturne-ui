import { useState, useEffect } from "react";
import {
  startPkceAuth,
  handlePkceCallback,
  refreshPkceToken,
  saveTokens,
  clearAuth,
  hasValidTokens,
  getAccessToken,
  getRefreshToken,
} from "../services/auth/pkceAuth";

export default function AuthTestPage() {
  const [status, setStatus] = useState("idle");
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [customClientId, setCustomClientId] = useState("");
  const [apiResult, setApiResult] = useState(null);

  // Client IDs from environment variables
  const SHARED_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID_SHARED;
  const DEFAULT_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || SHARED_CLIENT_ID;

  const log = (message, type = "info") => {
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    setLogs((prev) => [{ timestamp, message, type }, ...prev.slice(0, 30)]);
  };

  // Check for callback on mount
  useEffect(() => {
    const checkCallback = async () => {
      const params = new URLSearchParams(window.location.search);

      if (params.get("code")) {
        log("Callback detected, exchanging code for tokens...");
        setStatus("exchanging");

        try {
          const tokens = await handlePkceCallback();
          if (tokens) {
            saveTokens(tokens);
            setToken(tokens.access_token);
            setStatus("authenticated");
            log("Authentication successful!", "success");
            log(`Token: ${tokens.access_token.substring(0, 30)}...`, "success");
          }
        } catch (e) {
          setError(e.message);
          setStatus("error");
          log(`Error: ${e.message}`, "error");
        }
      } else if (params.get("error")) {
        const err = params.get("error");
        const desc = params.get("error_description");
        setError(`${err}: ${desc}`);
        setStatus("error");
        log(`Auth error: ${err} - ${desc}`, "error");
      } else {
        // Check for existing valid tokens
        if (hasValidTokens()) {
          setToken(getAccessToken());
          setStatus("authenticated");
          log("Found existing valid token", "success");
        } else {
          log("No valid tokens found. Click 'Login with Spotify' to authenticate.");
        }
      }
    };

    checkCallback();
  }, []);

  const handleLogin = () => {
    log("Starting PKCE auth flow...");
    setStatus("redirecting");
    startPkceAuth(customClientId || null);
  };

  const handleRefresh = async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      log("No refresh token available", "error");
      return;
    }

    log("Refreshing token...");
    setStatus("refreshing");

    try {
      const tokens = await refreshPkceToken(refreshToken);
      saveTokens(tokens);
      setToken(tokens.access_token);
      setStatus("authenticated");
      log("Token refreshed successfully!", "success");
      log(`New token: ${tokens.access_token.substring(0, 30)}...`, "success");
    } catch (e) {
      setError(e.message);
      setStatus("error");
      log(`Refresh error: ${e.message}`, "error");
    }
  };

  const handleLogout = () => {
    clearAuth();
    setToken(null);
    setStatus("idle");
    setApiResult(null);
    log("Logged out, cleared all tokens", "warning");
  };

  const testApi = async (endpoint) => {
    if (!token) {
      log("No token available", "error");
      return;
    }

    log(`Testing ${endpoint}...`);

    try {
      const response = await fetch(`https://api.spotify.com${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const retryAfter = response.headers.get("Retry-After");

      if (response.status === 429) {
        log(`Rate limited! Retry after ${retryAfter}s`, "error");
        setApiResult({ error: "Rate limited", retryAfter });
        return;
      }

      if (response.status === 401) {
        log("Token expired - try refreshing", "error");
        setApiResult({ error: "Token expired" });
        return;
      }

      if (response.status === 204) {
        log("No content (player inactive)", "warning");
        setApiResult({ message: "No active player" });
        return;
      }

      if (response.ok) {
        const data = await response.json();
        log(`Success: ${response.status}`, "success");
        setApiResult(data);
      } else {
        log(`Error: ${response.status}`, "error");
        setApiResult({ error: response.status });
      }
    } catch (e) {
      log(`Network error: ${e.message}`, "error");
      setApiResult({ error: e.message });
    }
  };

  const styles = {
    container: {
      padding: "20px",
      background: "#1a1a1a",
      color: "#fff",
      minHeight: "100vh",
      fontFamily: "monospace",
      maxWidth: "900px",
      margin: "0 auto",
    },
    section: {
      background: "#2a2a2a",
      padding: "15px",
      borderRadius: "8px",
      marginBottom: "15px",
    },
    button: {
      padding: "10px 20px",
      margin: "5px",
      cursor: "pointer",
      background: "#1db954",
      border: "none",
      color: "#fff",
      borderRadius: "4px",
      fontSize: "14px",
    },
    buttonDisabled: {
      padding: "10px 20px",
      margin: "5px",
      background: "#444",
      border: "none",
      color: "#888",
      borderRadius: "4px",
      fontSize: "14px",
      cursor: "not-allowed",
    },
    dangerButton: {
      padding: "10px 20px",
      margin: "5px",
      cursor: "pointer",
      background: "#e74c3c",
      border: "none",
      color: "#fff",
      borderRadius: "4px",
      fontSize: "14px",
    },
    input: {
      padding: "10px",
      width: "100%",
      maxWidth: "400px",
      background: "#333",
      border: "1px solid #444",
      color: "#fff",
      borderRadius: "4px",
      marginBottom: "10px",
      fontSize: "14px",
    },
    status: {
      padding: "8px 12px",
      borderRadius: "4px",
      display: "inline-block",
      marginBottom: "10px",
    },
    log: {
      fontSize: "12px",
      padding: "4px 8px",
      margin: "2px 0",
      borderRadius: "4px",
      background: "#222",
    },
    pre: {
      background: "#222",
      padding: "10px",
      borderRadius: "4px",
      overflow: "auto",
      maxHeight: "200px",
      fontSize: "11px",
    },
  };

  const getStatusStyle = () => {
    const base = { ...styles.status };
    switch (status) {
      case "authenticated":
        return { ...base, background: "#1db954", color: "#fff" };
      case "error":
        return { ...base, background: "#e74c3c", color: "#fff" };
      case "redirecting":
      case "exchanging":
      case "refreshing":
        return { ...base, background: "#f39c12", color: "#000" };
      default:
        return { ...base, background: "#444", color: "#fff" };
    }
  };

  const getLogColor = (type) => {
    switch (type) {
      case "error": return "#ff6b6b";
      case "success": return "#1db954";
      case "warning": return "#ffa500";
      default: return "#aaa";
    }
  };

  return (
    <div style={styles.container}>
      <h1>PKCE Auth Test</h1>
      <p style={{ color: "#888", marginBottom: "20px" }}>
        Standard OAuth 2.0 flow for web apps (no QR code needed)
      </p>

      {/* Status */}
      <div style={styles.section}>
        <h3 style={{ margin: "0 0 10px 0" }}>Status</h3>
        <div style={getStatusStyle()}>{status.toUpperCase()}</div>
        {status === "authenticated" && (
          <button
            className="transition-colors duration-200 rounded-[12px] px-6 py-2 focus:outline-none mt-3 bg-[#1db954] hover:bg-[#1ed760]"
            onClick={() => window.location.href = "/"}
          >
            <span className="text-[24px] font-[580] text-white tracking-tight">
              Go to Dashboard
            </span>
          </button>
        )}
        {error && <p style={{ color: "#ff6b6b", margin: "10px 0" }}>{error}</p>}
        {token && (
          <p style={{ color: "#888", margin: "10px 0", wordBreak: "break-all" }}>
            Token: {token.substring(0, 50)}...
          </p>
        )}
      </div>

      {/* Auth Actions */}
      <div style={styles.section}>
        <h3 style={{ margin: "0 0 10px 0" }}>1. Authentication</h3>

        <div style={{ marginBottom: "15px" }}>
          <label style={{ display: "block", marginBottom: "5px", color: "#888" }}>
            Client ID:
          </label>
          <input
            style={styles.input}
            type="text"
            placeholder="Your Spotify Client ID"
            value={customClientId}
            onChange={(e) => setCustomClientId(e.target.value)}
          />
          <div style={{ marginTop: "5px" }}>
            <button
              style={{ ...styles.button, background: "#555", padding: "6px 12px", fontSize: "12px" }}
              onClick={() => setCustomClientId(DEFAULT_CLIENT_ID || "")}
            >
              Use Default
            </button>
          </div>
        </div>

        {status !== "authenticated" ? (
          <button
            style={status === "redirecting" ? styles.buttonDisabled : styles.button}
            onClick={handleLogin}
            disabled={status === "redirecting"}
          >
            {status === "redirecting" ? "Redirecting..." : "Login with Spotify"}
          </button>
        ) : (
          <>
            <button style={styles.button} onClick={handleRefresh}>
              Refresh Token
            </button>
            <button style={styles.dangerButton} onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </div>

      {/* API Test */}
      {status === "authenticated" && (
        <div style={styles.section}>
          <h3 style={{ margin: "0 0 10px 0" }}>2. Test API Endpoints</h3>
          <button style={styles.button} onClick={() => testApi("/v1/me")}>
            /me
          </button>
          <button style={styles.button} onClick={() => testApi("/v1/me/player")}>
            /me/player
          </button>
          <button style={styles.button} onClick={() => testApi("/v1/me/playlists?limit=1")}>
            /me/playlists
          </button>
          <button style={styles.button} onClick={() => testApi("/v1/me/albums?limit=1")}>
            /me/albums
          </button>

          {apiResult && (
            <pre style={styles.pre}>{JSON.stringify(apiResult, null, 2)}</pre>
          )}
        </div>
      )}

      {/* Logs */}
      <div style={styles.section}>
        <h3 style={{ margin: "0 0 10px 0" }}>Logs</h3>
        {logs.map((l, i) => (
          <div key={i} style={{ ...styles.log, color: getLogColor(l.type) }}>
            [{l.timestamp}] {l.message}
          </div>
        ))}
      </div>

      {/* Info */}
      <div style={{ ...styles.section, background: "#1a1a1a", border: "1px solid #333" }}>
        <h4 style={{ margin: "0 0 10px 0", color: "#888" }}>How PKCE Auth Works</h4>
        <ol style={{ color: "#666", fontSize: "12px", margin: 0, paddingLeft: "20px" }}>
          <li>Click "Login with Spotify" - redirects to Spotify</li>
          <li>Authorize the app on Spotify</li>
          <li>Spotify redirects back here with a code</li>
          <li>Code is exchanged for access + refresh tokens</li>
          <li>Tokens are stored in localStorage (same as main app)</li>
        </ol>
      </div>
    </div>
  );
}
