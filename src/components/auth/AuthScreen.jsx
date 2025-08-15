import React, { useEffect, useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { refreshAccessToken as fetchSpotifyToken } from "../../services/authService";
import { useGradientState } from "../../hooks/useGradientState";
import { useAuth } from "../../hooks/useAuth";
import { useNetwork } from "../../hooks/useNetwork";
import NocturneIcon from "../common/icons/NocturneIcon";
import GradientBackground from "../common/GradientBackground";
import QRCodeDisplay from "./QRCodeDisplay";
import NetworkScreen from "./NetworkScreen";

const AuthScreen = ({ onAuthSuccess }) => {
  const [error, setError] = useState(null);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [hasQrCode, setHasQrCode] = useState(false);
  const [showSpotifyLinkScreen, setShowSpotifyLinkScreen] = useState(false);
  const authAttemptedRef = useRef(false);
  const authTimerRef = useRef(null);
  const previousNetworkStateRef = useRef(null);
  const spotifyPollRef = useRef(null);

  const { authData, isLoading, initAuth, pollAuthStatus, isAuthenticated } =
    useAuth();
  const { isConnected: isNetworkConnected, initialCheckDone } = useNetwork();
  const [gradientState, updateGradientColors] = useGradientState();

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  useEffect(() => {
    const openSpotifyLinkScreen = () => setShowSpotifyLinkScreen(true);
    window.addEventListener("spotifyLinkRequired", openSpotifyLinkScreen);
    if (
      localStorage.getItem("nocturneApiToken") &&
      !localStorage.getItem("spotifyAccessToken")
    ) {
      setShowSpotifyLinkScreen(true);
    }
    return () =>
      window.removeEventListener("spotifyLinkRequired", openSpotifyLinkScreen);
  }, []);

  useEffect(() => {
    if (
      !authInitialized &&
      !isAuthenticated &&
      !authAttemptedRef.current &&
      isNetworkConnected &&
      !showSpotifyLinkScreen
    ) {
      if (authTimerRef.current) {
        clearTimeout(authTimerRef.current);
      }

      authTimerRef.current = setTimeout(async () => {
        authAttemptedRef.current = true;
        try {
          const storedAccessToken = localStorage.getItem("spotifyAccessToken");
          const storedApiToken = localStorage.getItem("nocturneApiToken");

          if (!storedAccessToken || !storedApiToken) {
            const authResponse = await initAuth();
            if (authResponse?.code) {
              setAuthInitialized(true);
              pollAuthStatus(authResponse.code);
            }
          }
        } catch (err) {
          setError("Failed to initialize authentication");
          console.error("Auth init error:", err);
        }
      }, 2000);
    }

    return () => {
      if (authTimerRef.current) {
        clearTimeout(authTimerRef.current);
      }
    };
  }, [
    initAuth,
    pollAuthStatus,
    isAuthenticated,
    authInitialized,
    isNetworkConnected,
    showSpotifyLinkScreen,
  ]);

  useEffect(() => {
    if (!showSpotifyLinkScreen) {
      if (spotifyPollRef.current) {
        clearInterval(spotifyPollRef.current);
        spotifyPollRef.current = null;
      }
      return;
    }
    const poll = async () => {
      const apiToken = localStorage.getItem("nocturneApiToken");
      if (!apiToken) return;
      try {
        const tokenResp = await fetchSpotifyToken(apiToken);
        if (tokenResp && tokenResp.access_token) {
          localStorage.setItem("spotifyAccessToken", tokenResp.access_token);
          const expiryDate = new Date();
          const expiresIn = tokenResp.expires_in || 3600;
          expiryDate.setSeconds(expiryDate.getSeconds() + expiresIn - 600);
          localStorage.setItem("spotifyTokenExpiry", expiryDate.toISOString());
          window.dispatchEvent(
            new CustomEvent("accessTokenUpdated", {
              detail: { accessToken: tokenResp.access_token },
            }),
          );
          setShowSpotifyLinkScreen(false);
        }
      } catch {
        // hi
      }
    };
    poll();
    spotifyPollRef.current = setInterval(poll, 5000);
    return () => {
      if (spotifyPollRef.current) {
        clearInterval(spotifyPollRef.current);
        spotifyPollRef.current = null;
      }
    };
  }, [showSpotifyLinkScreen]);

  useEffect(() => {
    if (isAuthenticated && authInitialized) {
      setAuthInitialized(false);
      setHasQrCode(false);
      authAttemptedRef.current = false;
    }
  }, [isAuthenticated, authInitialized]);

  useEffect(() => {
    if (authData?.verification_uri_complete) {
      setHasQrCode(true);
    }
  }, [authData]);

  useEffect(() => {
    if (isAuthenticated) {
      onAuthSuccess();
    }
  }, [isAuthenticated, onAuthSuccess]);

  useEffect(() => {
    if (
      previousNetworkStateRef.current === false &&
      isNetworkConnected === true
    ) {
      authAttemptedRef.current = false;
      setAuthInitialized(false);
      setHasQrCode(false);
      setError(null);
    }
    previousNetworkStateRef.current = isNetworkConnected;
  }, [isNetworkConnected]);

  useEffect(() => {
    if (authInitialized && !hasQrCode && isNetworkConnected) {
      if (showSpotifyLinkScreen) return;
      const retryTimer = setTimeout(() => {
        if (!hasQrCode && isNetworkConnected) {
          authAttemptedRef.current = false;
          setAuthInitialized(false);
          setError(null);
        }
      }, 5000);

      return () => clearTimeout(retryTimer);
    }
  }, [authInitialized, hasQrCode, isNetworkConnected, showSpotifyLinkScreen]);

  const handleQRCodeRefresh = async () => {
    if (!isNetworkConnected || isAuthenticated) return;
    if (showSpotifyLinkScreen) return;

    const storedAccessToken = localStorage.getItem("spotifyAccessToken");
    const storedApiToken = localStorage.getItem("nocturneApiToken");
    if (storedAccessToken && storedApiToken) return;

    try {
      setError(null);
      authAttemptedRef.current = false;
      setAuthInitialized(false);
      setHasQrCode(false);

      const authResponse = await initAuth();
      if (authResponse?.code) {
        setAuthInitialized(true);
        pollAuthStatus(authResponse.code);
      }
    } catch (err) {
      setError("Failed to refresh QR code");
      console.error("QR code refresh error:", err);
    }
  };

  if (!initialCheckDone) {
    return (
      <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
        <GradientBackground gradientState={gradientState} />
        <div className="relative z-10 flex flex-col items-center justify-center">
          <NocturneIcon className="h-12 w-auto animate-pulse" />
        </div>
      </div>
    );
  }

  if (!isNetworkConnected) {
    return <NetworkScreen isConnectionLost={true} />;
  }

  const isContentLoading =
    (isLoading && !hasQrCode) || (isNetworkConnected === false && !hasQrCode);

  const displayError =
    error && !error.includes("authorization_pending")
      ? error
      : !isNetworkConnected
        ? "Network connection required"
        : null;

  if (showSpotifyLinkScreen) {
    return (
      <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
        <GradientBackground gradientState={gradientState} />
        <div className="relative z-10 w-full max-w-6xl px-6 grid grid-cols-2 gap-16 items-center">
          <div className="flex flex-col items-start space-y-8 ml-12">
            <NocturneIcon className="h-12 w-auto" />
            <div className="space-y-4">
              <h2 className="text-4xl text-white tracking-tight font-[580] w-[24rem]">
                Connect your Spotify account.
              </h2>
              <p className="text-[28px] text-white/60 tracking-tight w-[22rem]">
                Please link your Spotify account on the Nocturne dashboard.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <div className="bg-white p-1 rounded-xl drop-shadow-[0_8px_5px_rgba(0,0,0,0.25)]">
              <QRCodeSVG
                value="http://localhost:3000/dashboard"
                size={250}
                level="H"
                includeMargin={true}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
      <GradientBackground gradientState={gradientState} />

      <div className="relative z-10 w-full max-w-6xl px-6 grid grid-cols-2 gap-16 items-center">
        <div className="flex flex-col items-start space-y-8 ml-12">
          <NocturneIcon className="h-12 w-auto" />

          <div className="space-y-4">
            <h2 className="text-4xl text-white tracking-tight font-[580] w-[24rem]">
              Link this device to your Nocturne account.
            </h2>
            <p className="text-[28px] text-white/60 tracking-tight w-[22rem]">
              {authData?.code ? (
                <span>
                  Scan the QR code, or go to{" "}
                  <span className="font-[580]">dash.usenocturne.com/link</span>{" "}
                  and enter <span className="font-[580]">{authData?.code}</span>.
                </span>
              ) : (
                "Loading..."
              )}
            </p>
          </div>
        </div>

        <div className="flex justify-center">
          <QRCodeDisplay
            verificationUri={
              hasQrCode && isNetworkConnected
                ? authData?.verification_uri_complete
                : null
            }
            isLoading={isContentLoading || !isNetworkConnected}
            error={displayError}
            onRefreshNeeded={handleQRCodeRefresh}
          />
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
