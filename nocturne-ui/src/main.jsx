import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Enable network bypass and skip tutorial for local development
if (import.meta.env.DEV) {
  localStorage.setItem("networkCheckBypass", "true");
  localStorage.setItem("hasSeenTutorial", "true");
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
