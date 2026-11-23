# Decision Room v1 — Disposable Group Decision Rooms

A fast, zero-login group decision web app designed to break group-chat indecision (*"Friday dinner?"*, *"Movie night?"*, *"Weekend plan?"*) in under 60 seconds. Built for the **Netlify Free Tier** using React 19, TypeScript, Tailwind CSS v4, **Netlify Functions** (`/api/room`), and **Netlify Blobs**.

---

## ✨ Visual & UX Highlights (Playful Tactile Utility)

- **Warm Paper Aesthetic:** `#FAF8F5` canvas, crisp `1.5px` `#E8E4DC` borders, high-contrast `#141413` ink, `#FF5A36` electric coral primary CTAs, `#16A34A` emerald Pick, `#DC2626` crimson Pass, and `#D97706` amber Tie-breaker / Swiping indicators.
- **Screen 1 — Create Room (`/`):** Optional room prompt (`0/60` char counter) + 3 to 6 option rows with automatic URL detection (`🔗` indicator), duplicate/empty validation, and one-tap room creation that redirects the host to `/r/:code` with `hostToken` persisted in `sessionStorage`.
- **Screen 2 — Join / Lobby (`/r/:code`):** Dashed share banner with `Copy Link` (`Copied ✓` emerald state), room meta pill (`{N} options · Expires in {MM}m`), optional display name with auto-assigned guest animal placeholder (`Guest Panda`, `Guest Fox`, etc.), and live join count (`{N} people already joined`).
- **Screen 3 — Split-Face Decision Card + Live Votes History Tray:**
  - **Option B Split-Face Card:** Oversized `01` monospace index, bold `Plus Jakarta Sans` option title, optional `🔗 Open link ↗` external link chip, `PICK ✓` / `PASS ✕` drag stamps (`±90px` threshold), and a docked `66px` two-tone **✕ Pass / ✓ Pick** footer with a pointer guard so button/link taps never trigger accidental card drags.
  - **Option C Live Votes History Tray:** Compact chip tray below the card (`Your votes so far (tap to toggle)`) where tapping any voted chip flips `Pick ↔ Pass` in place, plus `↶ Undo` and desktop keyboard shortcuts (`←` Pass, `→` Pick, `Z` Undo).
  - **Single-POST Vote Batching:** All card swipes, undos, and tray chip toggles stay in local React state until the final card is swiped, then submit in a single `POST /api/room` (`action: "submitVotes"`).
- **Screen 4 — Waiting State:** Live-polled every `1.8s` with participant avatar initials, `(Host)` badge, `✓ Done` / `⋯ Swiping` status pills, share banner, and a host-only `Host: Reveal Winner Now →` button.
- **Screen 5 — Winner Reveal:** Polling stops immediately once the room closes. Displays the winning card, conditional tie-breaker or all-pass randomizer banner, proportional vote breakdown bars, `Start a New Room`, and `Copy Result for Group Chat`.
- **Screen 6 — Expired / 404 Room:** Dedicated centered card explaining the 60-minute auto-cleanup with a `Create a New Room →` CTA.

---

## 🚀 Local Development & Two-Device Testing

```bash
# 1. Install dependencies
npm install

# 2. Start local dev server (Vite + /api/room Netlify Function on port 5179)
npm run dev

# 3. Run unit & tie-breaker checks + TypeScript + production build
npm run build
```

### Testing Multi-User Sync Across Two Devices or Two Browser Tabs
1. **Two Real Devices (Phone + Laptop):** Open the live Netlify URL, create a room with 3–6 options, tap **Copy Link** on `/r/:code`, and open that link on a second phone or laptop.
2. **Two Tabs in One Browser:** Open `/r/:code` in Tab 1 (Host) and `/r/:code?user=2` in Tab 2 (Guest). The `?user=2` query parameter isolates `sessionStorage`/`localStorage` keys so you can test two independent voters side by side.
