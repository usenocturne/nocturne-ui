import { useState, useEffect } from "react";

export default function TestPage() {
  const [token, setToken] = useState(null);
  const [results, setResults] = useState([]);
  const [manualToken, setManualToken] = useState("");

  const log = (message, type = "info") => {
    const timestamp = new Date().toISOString();
    setResults((prev) => [{ timestamp, message, type }, ...prev.slice(0, 50)]);
  };

  useEffect(() => {
    loadToken();
  }, []);

  const loadToken = () => {
    try {
      // Try spotifyAccessToken first (used by this app)
      const accessToken = localStorage.getItem("spotifyAccessToken");
      if (accessToken) {
        setToken(accessToken);
        log(`Token loaded: ${accessToken.substring(0, 30)}...`, "success");
        return;
      }

      // Fallback to spotifyAuth object
      const stored = localStorage.getItem("spotifyAuth");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.accessToken) {
          setToken(parsed.accessToken);
          log(`Token loaded: ${parsed.accessToken.substring(0, 30)}...`, "success");
          return;
        }
      }
      log("No token found in localStorage", "error");
    } catch (e) {
      log(`Error loading token: ${e.message}`, "error");
    }
  };

  const useManual = () => {
    if (manualToken.trim()) {
      setToken(manualToken.trim());
      log("Using manual token", "success");
    }
  };

  const testEndpoint = async (endpoint) => {
    if (!token) {
      log("No token! Load or enter a token first.", "error");
      return;
    }

    const url = `https://api.spotify.com${endpoint}`;
    log(`Testing: ${url}`);

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const retryAfter = response.headers.get("Retry-After");

      log(
        `Status: ${response.status} ${response.statusText}`,
        response.ok ? "success" : response.status === 429 ? "warning" : "error"
      );

      if (retryAfter) {
        log(`Retry-After: ${retryAfter} seconds`, "warning");
      }

      if (response.status === 429) {
        log("RATE LIMITED!", "error");
        return;
      }

      if (response.status === 401) {
        log("Token expired/invalid - need to re-auth", "error");
        return;
      }

      if (response.status === 204) {
        log("No content (player inactive)", "warning");
        return;
      }

      if (response.ok) {
        const data = await response.json();
        log(`Response: ${JSON.stringify(data).substring(0, 300)}...`, "success");
      }
    } catch (e) {
      log(`Network error: ${e.message}`, "error");
    }
  };

  const clearAuth = () => {
    localStorage.removeItem("spotifyAuth");
    setToken(null);
    log("Cleared auth data", "warning");
  };

  const styles = {
    container: {
      padding: "20px",
      background: "#1a1a1a",
      color: "#fff",
      minHeight: "100vh",
      fontFamily: "monospace",
    },
    button: {
      padding: "10px 20px",
      margin: "5px",
      cursor: "pointer",
      background: "#1db954",
      border: "none",
      color: "#fff",
      borderRadius: "4px",
    },
    dangerButton: {
      padding: "10px 20px",
      margin: "5px",
      cursor: "pointer",
      background: "#e74c3c",
      border: "none",
      color: "#fff",
      borderRadius: "4px",
    },
    input: {
      padding: "8px",
      width: "400px",
      margin: "5px",
      background: "#2a2a2a",
      border: "1px solid #444",
      color: "#fff",
    },
    log: {
      background: "#2a2a2a",
      padding: "10px",
      margin: "2px 0",
      borderRadius: "4px",
      fontSize: "12px",
    },
  };

  const getColor = (type) => {
    switch (type) {
      case "error": return "#ff6b6b";
      case "success": return "#1db954";
      case "warning": return "#ffa500";
      default: return "#fff";
    }
  };

  return (
    <div style={styles.container}>
      <h1>Spotify API Test</h1>

      <div>
        <h3>1. Token Status</h3>
        <button style={styles.button} onClick={loadToken}>Reload Token</button>
        <button style={styles.dangerButton} onClick={clearAuth}>Clear Auth</button>
        <p>Current: {token ? `${token.substring(0, 40)}...` : "None"}</p>
      </div>

      <div>
        <h3>2. Manual Token</h3>
        <input
          style={styles.input}
          type="text"
          placeholder="Paste access token"
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
        />
        <button style={styles.button} onClick={useManual}>Use This</button>
      </div>

      <div>
        <h3>3. Test Endpoints</h3>
        <button style={styles.button} onClick={() => testEndpoint("/v1/me")}>
          /me
        </button>
        <button style={styles.button} onClick={() => testEndpoint("/v1/me/player")}>
          /me/player
        </button>
        <button style={styles.button} onClick={() => testEndpoint("/v1/me/playlists?limit=1")}>
          /me/playlists
        </button>
        <button style={styles.button} onClick={() => testEndpoint("/v1/me/albums?limit=1")}>
          /me/albums
        </button>
      </div>

      <div>
        <h3>Results</h3>
        {results.map((r, i) => (
          <div key={i} style={{ ...styles.log, color: getColor(r.type) }}>
            [{r.timestamp}] {r.message}
          </div>
        ))}
      </div>
    </div>
  );
}
