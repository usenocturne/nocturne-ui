import { useState, useEffect, useCallback, useRef } from "react";
import {
  oauthAuthorize,
  checkAuthStatus,
  refreshAccessToken,
  revokeApiToken,
} from "../services/authService";
import { waitForStableNetwork } from "../utils/networkAwareRequest";

const authInitializationState = {
  initializing: false,
  refreshing: false,
  lastRefreshTime: 0,
  lastRefreshAttemptFailed: false,
  networkRestoreTimeout: null,
};

const DNS_READY_DELAY = 5000;

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [apiToken, setApiToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authData, setAuthData] = useState(null);
  const [tokenRefreshing, setTokenRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const pollingIntervalRef = useRef(null);

  const refreshTimerRef = useRef(null);
  const currentDeviceCodeRef = useRef(null);
  const currentLinkCodeRef = useRef(null);
  const initCalledRef = useRef(false);
  const refreshTokensRef = useRef(null);

  const shouldRefreshToken = useCallback(() => {
    const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
    if (!tokenExpiry) return true;

    const expiryTime = new Date(tokenExpiry);
    const now = new Date();
    return (
      expiryTime <= now || authInitializationState.lastRefreshAttemptFailed
    );
  }, []);

  const tokenReady =
    isAuthenticated && !tokenRefreshing && !shouldRefreshToken();

  const logout = useCallback(() => {
    const apiTok = localStorage.getItem("nocturneApiToken");
    if (apiTok) {
      revokeApiToken(apiTok).finally(() => {});
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      currentDeviceCodeRef.current = null;
    }

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    localStorage.removeItem("spotifyAccessToken");
    localStorage.removeItem("spotifyTokenExpiry");
    localStorage.removeItem("nocturneApiToken");

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("userLoggedOut"));

    setAccessToken(null);
    setApiToken(null);
    setIsAuthenticated(false);
    setAuthData(null);
  }, []);

  const scheduleTokenRefresh = useCallback((expiryDate) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const now = new Date();
    const expiryTime = new Date(expiryDate);
    const timeUntilRefresh = Math.max(0, expiryTime.getTime() - now.getTime());

    if (timeUntilRefresh < 60000) {
      if (typeof refreshTokensRef.current === "function") {
        refreshTokensRef.current();
      }
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      if (typeof refreshTokensRef.current === "function") {
        refreshTokensRef.current();
      }
    }, timeUntilRefresh);
  }, []);

  const refreshTokens = useCallback(async () => {
    setTokenRefreshing(true);
    try {
      const storedApiToken = localStorage.getItem("nocturneApiToken");
      if (!storedApiToken) {
        setTokenRefreshing(false);
        return false;
      }

      const now = Date.now();
      if (now - authInitializationState.lastRefreshTime < 15000) {
        return true;
      }

      if (authInitializationState.refreshing) {
        setTokenRefreshing(false);
        return false;
      }

      authInitializationState.refreshing = true;

      const bypass =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("networkCheckBypass") === "true";
      if (!bypass) {
        await waitForStableNetwork(10000);
      }

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        currentDeviceCodeRef.current = null;
      }

      let data = null;
      try {
        data = await refreshAccessToken(storedApiToken);
      } catch (err) {
        if (
          err &&
          typeof err.message === "string" &&
          err.message === "no_spotify_refresh_token"
        ) {
          window.dispatchEvent(new Event("spotifyLinkRequired"));
          return false;
        }
        throw err;
      }

      if (data.access_token) {
        setAccessToken(data.access_token);
        localStorage.setItem("spotifyAccessToken", data.access_token);

        const expiryDate = new Date();
        const expiresIn = data.expires_in || 3600;
        expiryDate.setSeconds(expiryDate.getSeconds() + expiresIn - 600);
        localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());

        setIsAuthenticated(true);
        scheduleTokenRefresh(expiryDate);

        window.dispatchEvent(
          new CustomEvent("accessTokenUpdated", {
            detail: { accessToken: data.access_token },
          }),
        );

        authInitializationState.refreshing = false;
        setTokenRefreshing(false);
        authInitializationState.lastRefreshTime = now;
        authInitializationState.lastRefreshAttemptFailed = false;
        return true;
      }
      authInitializationState.refreshing = false;
      setTokenRefreshing(false);
      authInitializationState.lastRefreshAttemptFailed = true;
      return false;
    } catch (err) {
      console.error("Token refresh failed:", err);
      if (
        err &&
        typeof err.message === "string" &&
        err.message === "nocturne_unauthorized"
      ) {
        logout();
      }
      authInitializationState.refreshing = false;
      setTokenRefreshing(false);
      authInitializationState.lastRefreshAttemptFailed = true;
      return false;
    }
  }, [scheduleTokenRefresh, logout]);

  useEffect(() => {
    refreshTokensRef.current = refreshTokens;
  }, [refreshTokens]);

  useEffect(() => {
    const initAuthState = async () => {
      if (initCalledRef.current) return;
      initCalledRef.current = true;

      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedApiToken = localStorage.getItem("nocturneApiToken");

      if (storedAccessToken && storedApiToken) {
        setAccessToken(storedAccessToken);
        setApiToken(storedApiToken);
        setIsAuthenticated(true);
      }

      setIsLoading(false);
    };

    initAuthState();

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [refreshTokens]);

  const initAuth = useCallback(async () => {
    try {
      if (authInitializationState.initializing) return null;
      authInitializationState.initializing = true;

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        currentDeviceCodeRef.current = null;
      }

      setIsLoading(true);
      setError(null);

      const link = await oauthAuthorize();
      setAuthData(link);

      authInitializationState.initializing = false;
      return link;
    } catch (error) {
      setError("Failed to initialize authentication");
      console.error("Auth initialization failed:", error);
      authInitializationState.initializing = false;
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pollAuthStatus = useCallback(
    (linkCode) => {
      if (isAuthenticated) return () => {};

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      currentLinkCodeRef.current = linkCode;

      const intervalTime = (authData?.interval || 5) * 1000;

      const poll = async () => {
        if (isAuthenticated || currentLinkCodeRef.current !== linkCode) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
          return;
        }

        try {
          const data = await checkAuthStatus(linkCode);

          if (data.status === "approved" && data.token) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            currentLinkCodeRef.current = null;

            localStorage.setItem("nocturneApiToken", data.token);
            setApiToken(data.token);

            try {
              const tokenResp = await refreshAccessToken(data.token);

              if (tokenResp?.access_token) {
                localStorage.setItem(
                  "spotifyAccessToken",
                  tokenResp.access_token,
                );

                const expiryDate = new Date();
                const expiresIn = tokenResp.expires_in || 3600;
                expiryDate.setSeconds(
                  expiryDate.getSeconds() + expiresIn - 600,
                );
                localStorage.setItem(
                  "spotifyTokenExpiry",
                  expiryDate.toISOString(),
                );

                setAccessToken(tokenResp.access_token);
                setIsAuthenticated(true);
                scheduleTokenRefresh(expiryDate);
                window.dispatchEvent(new Event("storage"));
              }
            } catch (e) {
              if (
                e &&
                typeof e.message === "string" &&
                e.message === "no_spotify_refresh_token"
              ) {
                window.dispatchEvent(new Event("spotifyLinkRequired"));
              } else {
                throw e;
              }
            }
          }
        } catch (error) {
          if (error && typeof error.message === "string" && error.message === "device_code_expired") {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            currentLinkCodeRef.current = null;

            try {
              const link = await oauthAuthorize();
              if (link && link.code) {
                setAuthData(link);
                currentLinkCodeRef.current = link.code;
                pollAuthStatus(link.code);
              }
            } catch (e) {
              console.error("Re-initializing auth after code expiry failed:", e);
            }
            return;
          }
          console.error("Auth polling error:", error);
        }
      };

      pollingIntervalRef.current = setInterval(poll, intervalTime);

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
          currentDeviceCodeRef.current = null;
        }
      };
    },
    [authData, scheduleTokenRefresh, isAuthenticated],
  );

  useEffect(() => {
    const handleSpotifyUnauthorized = async () => {
      await refreshTokens();
    };

    window.addEventListener("spotifyUnauthorized", handleSpotifyUnauthorized);

    return () => {
      window.removeEventListener(
        "spotifyUnauthorized",
        handleSpotifyUnauthorized,
      );
    };
  }, [refreshTokens]);

  useEffect(() => {
    const handleStorageChange = () => {
      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedApiToken = localStorage.getItem("nocturneApiToken");

      if (storedAccessToken && storedApiToken) {
        setAccessToken(storedAccessToken);
        setApiToken(storedApiToken);
        setIsAuthenticated(true);

        const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
        if (storedExpiry) {
          scheduleTokenRefresh(new Date(storedExpiry));
        }
      } else {
        setAccessToken(null);
        setApiToken(null);
        setIsAuthenticated(false);
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [scheduleTokenRefresh]);

  useEffect(() => {
    const handleAccessTokenUpdated = (e) => {
      const newAccessToken = e.detail?.accessToken;
      if (newAccessToken) {
        setAccessToken(newAccessToken);

        const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
        if (storedExpiry) {
          scheduleTokenRefresh(new Date(storedExpiry));
        }

        if (!isAuthenticated) {
          const storedApiToken = localStorage.getItem("nocturneApiToken");
          if (storedApiToken) {
            setApiToken(storedApiToken);
            setIsAuthenticated(true);
          }
        }
      }
    };

    window.addEventListener("accessTokenUpdated", handleAccessTokenUpdated);
    return () => {
      window.removeEventListener(
        "accessTokenUpdated",
        handleAccessTokenUpdated,
      );
    };
  }, [isAuthenticated, scheduleTokenRefresh]);

  useEffect(() => {
    if (accessToken && apiToken) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, [accessToken, apiToken]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleNetworkRestored = async () => {
      if (authInitializationState.networkRestoreTimeout) {
        clearTimeout(authInitializationState.networkRestoreTimeout);
      }

      authInitializationState.networkRestoreTimeout = setTimeout(async () => {
        if (shouldRefreshToken()) {
          try {
            const bypass =
              typeof localStorage !== "undefined" &&
              localStorage.getItem("networkCheckBypass") === "true";
            if (!bypass) {
              await waitForStableNetwork(10000);
            }
            await refreshTokens();
          } catch (error) {
            console.error(
              "Error refreshing token after network restored:",
              error,
            );
          }
        }
      }, DNS_READY_DELAY);
    };

    window.addEventListener("networkRestored", handleNetworkRestored);
    window.addEventListener("online", handleNetworkRestored);

    return () => {
      window.removeEventListener("networkRestored", handleNetworkRestored);
      window.removeEventListener("online", handleNetworkRestored);
      if (authInitializationState.networkRestoreTimeout) {
        clearTimeout(authInitializationState.networkRestoreTimeout);
      }
    };
  }, [isAuthenticated, shouldRefreshToken, refreshTokens]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (tokenReady) return;
    if (tokenRefreshing) return;

    let cancelled = false;
    const retry = async () => {
      if (cancelled) return;
      const success = await refreshTokens();
      if (!success && !cancelled) {
        setTimeout(retry, 15000);
      }
    };
    retry();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, tokenReady, tokenRefreshing, refreshTokens]);

  return {
    isAuthenticated,
    accessToken,
    apiToken,
    isLoading,
    authData,
    error,
    initAuth,
    pollAuthStatus,
    refreshTokens,
    logout,
    tokenReady,
    tokenRefreshing,
  };
}
