// frontend/src/main.jsx — add global spin keyframe
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// ✅ Add spin animation globally
const style = document.createElement("style");
style.textContent = `
  @keyframes spin {
    0%   { transform: rotate(0deg);   }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
