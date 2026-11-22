# TieBreakr — Disposable Group Decision Room (v1)

A fast, zero-login group decision web app designed to break group-chat indecision (*"Where should we eat?"*, *"Which movie tonight?"*, *"What's the weekend plan?"*) in under 60 seconds. Built for the **Netlify Free Tier** using a static React + Tailwind v4 frontend, **Netlify Functions** (`/api/room`), and **Netlify Blobs** with auto-expiring rooms (TTL) and smart short-polling.

---

## ✨ Key v1 Features

1. **Create a Disposable Room in Seconds**
   - Optional room prompt/title + **1-Tap Starter Templates** (*Tonight's Dinner*, *Movie Night*, *Weekend Hangout*, *Coffee & Catch-Up*).
   - Add **2 to 6 options**, each supporting a title, optional short note, and optional external link (Google Maps, menu, IMDb, etc.).
   - Configurable **expected participant count** (auto-reveals the winner as soon as everyone finishes) and **room TTL** (30, 45, or 60 minutes).

2. **Instant Shareable URL & Room Code**
   - Generates a short 6-character code and clean shareable route (`/r/ABCDEF`) with a 1-tap **Copy Invite Link** button and a **Simulate 2nd Device** button (`?user=2`) for instant multi-tab testing.

3. **Zero-Login Participation & 3-Way Swipe/Vote Deck**
   - Participants join immediately with an auto-assigned anonymous badge (*Clever Fox 🦊*, *Chill Panda 🐼*, *Cozy Otter 🦦*, etc.) or can type a custom display name at any time.
   - Mobile-first swipe gestures (drag left/right), big touch targets (`>= 44px`), and desktop keyboard shortcuts (`←` Pass, `→` Yes, `↑` Love It).
   - **Weighted consensus scoring:** `Love It 🔥` = +2 pts, `Yes 👍` = +1 pt, `Pass 👎` = 0 pts.

4. **Smart Short-Polling, Automatic Tie-Breaking & Winner Reveal**
   - Polls `/api/room` every **1.8 seconds** only while a room is open and active; **automatically stops polling** once a winner is picked or the TTL expires.
   - Multi-stage tie-breaker: highest weighted score → fewest `Pass` votes (consensus protection) → most `Love It` super-likes → deterministic seeded room tie-breaker.
   - Clean **Winner Reveal** state with full ranked breakdown, approval percentages, external link launcher, and option to reopen voting.

---

## 🏗️ Architecture (Netlify Free Tier)

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4 (`dist/` static output, with `/r/* -> /index.html` SPA rewrite in `netlify.toml`).
- **Backend API:** `netlify/functions/room.mts` mounted at `/api/room` (`GET` & `POST`).
- **State Persistence:** `@netlify/blobs` with strong consistency and isolated store names per deploy context (`decision-rooms-prod` in production vs `decision-rooms-preview` in previews).
- **Expiration (TTL):** Enforced on read in `/api/room` — expired room blobs are deleted immediately upon access after `expiresAt`.

---

## 🚀 Local Development & Two-Device Testing

```bash
# 1. Install dependencies
npm install

# 2. Start local dev server (Vite + local /api/room Blobs emulator on port 5179)
npm run dev

# 3. Run unit & tie-breaker verification + TypeScript + production build
npm run build
```

### How to Test Multi-User Sync (Two Devices or Two Tabs)
1. **Across Two Real Devices (Phone + Laptop):**
   - Open the deployed Netlify URL (or your LAN IP when running `npm run dev`), create a room with expected count = `2`, and tap **Copy Invite Link**.
   - Open that link on your phone or a friend's device. Both devices will show live participant join/swipe progress and reveal the same winner automatically once both finish swiping.
2. **On a Single Computer (Two Tabs):**
   - Create a room and click the **"Simulate 2nd Device"** button in the room header.
   - That opens `/r/<CODE>?user=2` in a second tab with an isolated participant identity so you can swipe as two separate people side by side.
