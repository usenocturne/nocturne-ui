import { useState, useEffect, useCallback, useRef } from "react";
import {
  oauthAuthorize,
  checkAuthStatus,
  refreshAccessToken,
} from "../services/authService";
import {
  networkAwareRequest,
  waitForNetwork,
} from "../utils/networkAwareRequest";

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
  const [refreshToken, setRefreshToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authData, setAuthData] = useState(null);
  const [error, setError] = useState(null);

  const pollingIntervalRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const currentDeviceCodeRef = useRef(null);
  const initCalledRef = useRef(false);

  const shouldRefreshToken = useCallback(() => {
    const tokenExpiry = localStorage.getItem("spotifyTokenExpiry");
    if (!tokenExpiry) return true;

    const expiryTime = new Date(tokenExpiry);
    const now = new Date();
    return (
      expiryTime <= now || authInitializationState.lastRefreshAttemptFailed
    );
  }, []);

  const refreshTokens = useCallback(async () => {
    try {
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");
      if (!storedRefreshToken) return false;

      const now = Date.now();
      if (now - authInitializationState.lastRefreshTime < 5000) {
        return true;
      }

      if (authInitializationState.refreshing) return false;

      authInitializationState.refreshing = true;

      await waitForNetwork();

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        currentDeviceCodeRef.current = null;
      }

      const data = await refreshAccessToken(storedRefreshToken);

      if (data.access_token) {
        setAccessToken(data.access_token);
        localStorage.setItem("spotifyAccessToken", data.access_token);

        if (data.refresh_token) {
          localStorage.setItem("spotifyRefreshToken", data.refresh_token);
          setRefreshToken(data.refresh_token);
        }

        const expiryDate = new Date();
        expiryDate.setSeconds(
          expiryDate.getSeconds() + (data.expires_in || 3600) - 600,
        );
        localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());

        setIsAuthenticated(true);
        scheduleTokenRefresh(expiryDate);

        window.dispatchEvent(
          new CustomEvent("accessTokenUpdated", {
            detail: { accessToken: data.access_token },
          }),
        );

        authInitializationState.refreshing = false;
        authInitializationState.lastRefreshTime = now;
        authInitializationState.lastRefreshAttemptFailed = false;
        return true;
      }
      authInitializationState.refreshing = false;
      authInitializationState.lastRefreshAttemptFailed = true;
      return false;
    } catch (err) {
      console.error("Token refresh failed:", err);
      if (err.message?.includes("invalid_grant")) {
        logout();
      }
      authInitializationState.refreshing = false;
      authInitializationState.lastRefreshAttemptFailed = true;
      return false;
    }
  }, []);

  const scheduleTokenRefresh = useCallback(
    (expiryDate) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      const now = new Date();
      const expiryTime = new Date(expiryDate);
      const timeUntilRefresh = Math.max(
        0,
        expiryTime.getTime() - now.getTime(),
      );

      if (timeUntilRefresh < 60000) {
        refreshTokens();
        return;
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTokens();
      }, timeUntilRefresh);
    },
    [refreshTokens],
  );

  const logout = useCallback(() => {
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
    localStorage.removeItem("spotifyRefreshToken");
    localStorage.removeItem("spotifyTokenExpiry");
    localStorage.removeItem("spotifyAuthType");

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("userLoggedOut"));

    setAccessToken(null);
    setRefreshToken(null);
    setIsAuthenticated(false);
    setAuthData(null);
  }, []);

  useEffect(() => {
    const initAuthState = async () => {
      if (initCalledRef.current) return;
      initCalledRef.current = true;

      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

      if (storedAccessToken && storedRefreshToken) {
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
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

      const auth = await oauthAuthorize();
      setAuthData(auth);

      authInitializationState.initializing = false;
      return auth;
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
    (deviceCode) => {
      if (isAuthenticated) return () => {};

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      currentDeviceCodeRef.current = deviceCode;

      const intervalTime = (authData?.interval || 5) * 1000;

      const poll = async () => {
        if (isAuthenticated || currentDeviceCodeRef.current !== deviceCode) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
          return;
        }

        try {
          const data = await checkAuthStatus(deviceCode);

          if (data.access_token) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            currentDeviceCodeRef.current = null;

            localStorage.setItem("spotifyAccessToken", data.access_token);
            localStorage.setItem("spotifyRefreshToken", data.refresh_token);
            localStorage.setItem("spotifyAuthType", "spotify");

            const expiryDate = new Date();
            expiryDate.setSeconds(
              expiryDate.getSeconds() + (data.expires_in || 3600) - 600,
            );
            localStorage.setItem(
              "spotifyTokenExpiry",
              expiryDate.toISOString(),
            );

            setAccessToken(data.access_token);
            setRefreshToken(data.refresh_token);
            setIsAuthenticated(true);

            scheduleTokenRefresh(expiryDate);

            window.dispatchEvent(new Event("storage"));
          }
        } catch (error) {
          if (!error.message?.includes("authorization_pending")) {
            console.error("Auth polling error:", error);
          }
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
    const handleStorageChange = () => {
      const storedAccessToken = localStorage.getItem("spotifyAccessToken");
      const storedRefreshToken = localStorage.getItem("spotifyRefreshToken");

      if (storedAccessToken && storedRefreshToken) {
        setAccessToken(storedAccessToken);
        setRefreshToken(storedRefreshToken);
        setIsAuthenticated(true);

        const storedExpiry = localStorage.getItem("spotifyTokenExpiry");
        if (storedExpiry) {
          scheduleTokenRefresh(new Date(storedExpiry));
        }
      } else {
        setAccessToken(null);
        setRefreshToken(null);
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
          const storedRefreshToken = localStorage.getItem(
            "spotifyRefreshToken",
          );
          if (storedRefreshToken) {
            setRefreshToken(storedRefreshToken);
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
    if (accessToken && refreshToken) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, [accessToken, refreshToken]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleNetworkRestored = async () => {
      if (authInitializationState.networkRestoreTimeout) {
        clearTimeout(authInitializationState.networkRestoreTimeout);
      }

      authInitializationState.networkRestoreTimeout = setTimeout(async () => {
        if (shouldRefreshToken()) {
          try {
            await waitForNetwork();
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

  return {
    isAuthenticated,
    accessToken,
    refreshToken,
    isLoading,
    authData,
    error,
    initAuth,
    pollAuthStatus,
    refreshTokens,
    logout,
  };
}
