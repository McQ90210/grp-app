# GR Poker — Installation Guide

A Progressive Web App for **Greene Room Poker — Berkhamsted**. Installs to your phone home screen, works offline, and (from v6) connects to Firebase for league tracking.

## What's new in v6

**This is a foundation release for league features. Phase 2A.**

- **GR Poker branding** throughout (new icon, new colours, new title)
- **Game type picker on launch** — choose League or High Rollers before setup
- **High Rollers mode** is a simpler version (no league points, no bounties, just buy-ins and payouts)
- **Firebase Authentication** — sign-in button bottom-right of the launch screen. Admins sign in once and stay signed in. Anyone (signed in or not) can use the timer; signing in unlocks recording results to the league (coming in v7).
- **Firestore connected** — your project is `gr-poker`. League data, player rosters, and game history will live there from v7 onward.

What's **not** in v6 (coming in v7):
- League dashboard / season standings table
- Player profile pages with stats
- Spreadsheet importer (loads your 2025-2026 history)
- Per-game points calculation and birthday bounty logic
- "Save game result" flow at end of tournament

So for now, v6 looks like v5 with new branding and a launch screen. The plumbing for v7 is in place.

## How to update from v5

1. In your GitHub repo, replace these files with the v6 versions:
   - `index.html`
   - `sw.js`
   - `manifest.json`
   - `icon-192.png`
   - `icon-512.png`
   - `README.md`
2. **Add this new file** to the repo root: `firebase-init.js`
3. On your phone, force-close the app and reopen — service worker v6 picks up the changes

## What's in this folder
- `index.html` — the entire app
- `firebase-init.js` — Firebase SDK initialiser (new in v6)
- `manifest.json` — PWA manifest
- `sw.js` — service worker
- `icon-192.png` / `icon-512.png` — new GR-branded icons
- `logos/` — original GR Poker SVG logos (kept here for reference)
- `README.md` — this file

## Firebase setup (for reference)

The Firebase project `gr-poker` is configured with:
- Firestore Database (Europe-west2, production rules)
- Authentication (Email/Password sign-in enabled)
- Security rules: public read, signed-in admins can write

If you ever need to add another admin, do it in the Firebase console:
1. Authentication → Users → Add user
2. Give them an email and password
3. Share those credentials with them
