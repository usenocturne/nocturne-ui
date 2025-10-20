import { useState } from "react";

export function usePlayerClock() {
  const [playerClockEnabled] = useState(() => {
    const stored = localStorage.getItem("playerClockEnabled");

    if (stored === null) {
      localStorage.setItem("playerClockEnabled", "true");
      return true;
    }

    return stored === "true";
  });

  return {
    playerClockEnabled,
  };
}
