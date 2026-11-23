import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

function removeNetlifyBadge() {
  const selectors = [
    "#nl-badge-frame",
    'iframe[title="Powered by Netlify"]',
    'script[src*="/.netlify/scripts/hud"]',
  ];
  for (const sel of selectors) {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  }
}

removeNetlifyBadge();
const badgeObserver = new MutationObserver(() => removeNetlifyBadge());
badgeObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

