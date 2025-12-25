import React from "react";
import { getClientId, getAuthType } from "../../services/auth/nocturnedPkceAuth";

// Client IDs from environment variables
const SHARED_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID_SHARED;
const ENV_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

export default function AccountInfo({ userProfile }) {
  if (!userProfile) return null;

  // Determine which client ID is active
  const activeClientId = getClientId();
  const customClientId = localStorage.getItem("spotifyClientId");
  const authType = getAuthType();

  let clientIdType;
  let clientIdDisplay;

  if (customClientId) {
    clientIdType = "Custom";
    clientIdDisplay = customClientId.slice(0, 8) + "...";
  } else if (ENV_CLIENT_ID && ENV_CLIENT_ID !== SHARED_CLIENT_ID) {
    clientIdType = "Env";
    clientIdDisplay = ENV_CLIENT_ID.slice(0, 8) + "...";
  } else {
    clientIdType = "Shared";
    clientIdDisplay = SHARED_CLIENT_ID?.slice(0, 8) + "...";
  }

  return (
    <div className="mb-8">
      <div className="flex items-center mb-6">
        {userProfile.images?.[0]?.url && (
          <img
            src={userProfile.images[0].url}
            alt="Profile"
            className="w-24 h-24 rounded-full mr-4"
          />
        )}
        <div>
          <h3 className="text-[32px] font-[580] text-white tracking-tight">
            {userProfile.display_name}
          </h3>
          <p className="text-[24px] font-[560] text-white/60 tracking-tight">
            {userProfile.email}
          </p>
          <p className="text-[20px] font-[560] text-white/40 tracking-tight mt-1">
            <span className={`inline-block px-2 py-0.5 rounded text-[16px] mr-2 ${
              clientIdType === "Custom"
                ? "bg-[#1db954]/20 text-[#1db954]"
                : clientIdType === "Env"
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-white/10 text-white/60"
            }`}>
              {clientIdType}
            </span>
            {clientIdDisplay} • {authType.toUpperCase()}
          </p>
        </div>
      </div>
    </div>
  );
}
