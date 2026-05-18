# Poker Timer — Installation Guide

You have a fully self-contained Progressive Web App (PWA). Once hosted, it installs to your phone's home screen like a real app, with its own icon and name, and works **offline** at game time.

## What's new in this version (v3)
- **Default voice is now Google US English** (falls back through other Google voices if not available)
- **Final 3 dramatic mode** — when the field drops to 3 players, the background turns red, currency symbols rain from the top, and the voice announces "We are down to the final three!"
- **Winner announcement** — when the last opponent is eliminated, the timer stops, a fanfare plays, the screen takes over with the winner's name in giant glowing letters, confetti rains, and the full payout breakdown is shown
- **Much richer sound synthesis** — animal sounds now use formant filters and FM synthesis instead of basic oscillators. They still won't fool anyone into thinking they're real recordings, but they're substantially less "1980s bleepy"
- **Optional real audio files** — if you upload MP3s into a `sounds/` folder, the app uses those instead. See below.

## Optional: real animal sounds

The app first tries to load `sounds/quack.mp3`, `sounds/cluck.mp3`, etc. If they don't exist, it falls back to the synthesised versions. To upgrade:

1. Source royalty-free animal sounds from a site like:
   - **Mixkit** (https://mixkit.co/free-sound-effects/animals/) — free, no signup
   - **Freesound.org** (https://freesound.org/) — filter by "CC0" licence
   - **Zapsplat** (https://www.zapsplat.com/sound-effect-category/animals/) — free with signup
2. Download MP3s for: quack, cluck, neigh, moo, bark, meow, hoot, oink, baa, crow, trumpet, airhorn, fanfare
3. Trim each to ~1 second using any audio editor (or use them as-is)
4. Name them exactly: `quack.mp3`, `cluck.mp3`, `neigh.mp3`, `moo.mp3`, `bark.mp3`, `meow.mp3`, `hoot.mp3`, `oink.mp3`, `baa.mp3`, `crow.mp3`, `trumpet.mp3`, `airhorn.mp3`, `fanfare.mp3`
5. In your GitHub repo, create a folder called `sounds` and upload them there
6. Refresh the app — the real sounds take over automatically

You can do all of these at once or one at a time. Missing files just fall back to the synthesised version.

## How to update from v2 (or v1)

1. In your GitHub repo, replace `index.html`, `sw.js`, and `README.md` with the new versions (icons + manifest unchanged)
2. On your phone, open the app and pull-to-refresh, or force-close it and reopen — the new service worker version (v3) will pick up the changes
3. Your roster and sound assignments are preserved across versions

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
