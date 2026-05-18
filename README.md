# Poker Timer — Installation Guide

You have a fully self-contained Progressive Web App (PWA). Once hosted, it installs to your phone's home screen like a real app, with its own icon and name, and works **offline** at game time.

## What's in this folder

- `index.html` — the entire app in one file
- `manifest.json` — tells phones how to install it
- `sw.js` — service worker for offline support
- `icon-192.png` / `icon-512.png` — the poker chip icon
- `README.md` — this file

## How to deploy (free, 5 minutes) — GitHub Pages

This is the easiest free hosting option and the result is permanent.

### Step 1 — Create a GitHub account
If you don't have one: go to **github.com** → Sign up. Free.

### Step 2 — Create a new repository
1. Click the **+** icon top-right → **New repository**
2. Name it: `poker-timer` (or whatever you like)
3. Set it to **Public**
4. Tick **Add a README file**
5. Click **Create repository**

### Step 3 — Upload the files
1. On the repo page, click **Add file** → **Upload files**
2. Drag in all the files from this folder *except* this README
3. Click **Commit changes**

### Step 4 — Turn on GitHub Pages
1. Click **Settings** (top of repo)
2. In the left sidebar, click **Pages**
3. Under **Source**, select **Deploy from a branch**
4. Branch: **main**, folder: **/ (root)**
5. Click **Save**
6. Wait 1-2 minutes. Refresh the page. You'll see a green box with your URL, something like:
   `https://YOURUSERNAME.github.io/poker-timer/`

### Step 5 — Install to your phone
1. **On your phone, open Chrome** and go to that URL
2. Tap the three-dot menu → **Add to Home screen** or **Install app**
3. Confirm — it'll appear as **Poker Timer** with the poker chip icon
4. Open it from your home screen — full-screen, no browser bar, like a native app

### Step 6 — Test offline
1. Open the app once while online (this lets the service worker cache everything)
2. Turn your phone to airplane mode
3. Open the app again — it should still work

## How to update the app later
Just upload new versions of `index.html` etc. to the GitHub repo. Bump the cache name in `sw.js` (e.g. `poker-timer-v2`) so phones pick up the change.

## Alternative hosts
If you don't want GitHub, the same files work on:
- **Netlify** (drag the folder onto netlify.com — instant deploy)
- **Vercel** (similar drag-and-drop)
- **Cloudflare Pages**
- Any static host that serves HTML

All are free for personal projects.

## Troubleshooting

**Voice doesn't work**
- Make sure phone media volume is up (not just ringer)
- Toggle the speaker icon in the app to test
- Try the voice picker in settings and pick a different voice

**Won't install / no "Install app" option**
- You must be on HTTPS — GitHub Pages provides this automatically
- The browser sometimes only shows the install prompt after you've visited the page once
- Try refreshing, or use the three-dot menu's "Add to Home screen" option directly

**Icons don't appear**
- Make sure `icon-192.png` and `icon-512.png` were uploaded successfully
- Clear browser cache and reinstall

**Roster doesn't persist**
- The app uses localStorage which is per-browser-per-domain. If you clear browser data, the roster is wiped. Reinstalling the home-screen app doesn't wipe it.

## What it does

- Setup wizard: buy-in → starting stack → players → duration → review
- Auto-generates blind structure (no 25-value chips, all multiples of 50)
- Persistent roster across sessions
- Voice announcements for welcome, level changes, 5-min warning, 1-min warning, breaks, end
- Multiple voice options (uses browser TTS)
- Scrubbable progress bar
- Player elimination tracking with live count
- Editable blind structure mid-game
- Works offline once installed
