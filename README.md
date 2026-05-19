# Poker Timer — Installation & Sounds Guide

You have a fully self-contained Progressive Web App (PWA). Once hosted, it installs to your phone's home screen like a real app, with its own icon and name, and works **offline** at game time.

## ⭐ This version (v5): bring-your-own sounds

The app now reads a `sounds/sounds.json` manifest you control. Add a sound, list it in the JSON, and it appears in the dropdown — no code changes needed. The 12 built-in named sounds (quack, cluck, neigh, etc.) still work as a fallback library.

### Adding your own sounds

**Step 1 — Get some sounds.** Go to https://mixkit.co/free-sound-effects/ on a laptop, search for what you want, click "Download Free SFX". Most are `.wav` but the app supports both `.mp3` and `.wav`.

**Step 2 — Name them whatever you like.** No more renaming to specific filenames. `beans.mp3`, `paul-the-horse.mp3`, `victory-roar.wav` — all fine.

**Step 3 — Upload them to your repo's `sounds/` folder.** Same as before.

**Step 4 — Add a `sounds.json` file** to the `sounds/` folder, listing your custom sounds. Format:

```json
{
  "beans": { "label": "Beans", "file": "sounds/beans.mp3" },
  "horse-laugh": { "label": "Horse laughing", "file": "sounds/horse-laugh.mp3" },
  "duck": { "label": "Best duck quack", "file": "sounds/my-duck.wav" }
}
```

- The **key** (`"beans"`) is the internal name — keep it short, no spaces
- The **label** is what appears in the dropdown
- The **file** is the path to the audio (relative to the app root)

**Step 5 — Refresh the app.** Your sounds appear under a "Your sounds" section in the dropdown, above the built-in ones.

### About the built-in sounds

The 12 built-in sounds (Quack/Cluck/Neigh/Moo/Bark/Meow/Hoot/Oink/Baa/Crow/Trumpet/Airhorn/Fanfare) still look for matching filenames in `sounds/` (e.g. `sounds/cluck.mp3`). If they exist, they play; otherwise the synthesised fallback plays. So:

- **For built-ins**: filename must match the key (e.g. cluck → `cluck.mp3`)
- **For custom sounds**: any filename works, just list it in `sounds.json`

You can mix both. Many users will only use custom sounds and ignore the built-ins.

### Important: fanfare and trumpet

These two are used by the app's own logic, not just by players:
- **`fanfare`** plays automatically when the winner is decided
- **`trumpet`** (sad trombone) is just a sound option, not auto-triggered

To use a custom audio file for the auto-played fanfare, override the built-in by naming your file `fanfare.mp3` and placing it at `sounds/fanfare.mp3`. The built-in loader will find it.

## How to update from v4

1. Replace `index.html`, `sw.js`, and `README.md` in your repo
2. (Optional) Add `sounds/sounds.json` with your custom entries
3. On your phone, force-close the app and reopen — service worker v5 picks up the changes

## Quick recap of features

- Setup wizard: buy-in → stack → players → duration → review
- Auto-generated blind structure (50-multiples, proper 2:1 ratios, sensible jumps at high values)
- 20-minute rounds by default
- Persistent roster, per-player sound assignments
- Voice announcements: welcome, level changes, 5-min/1-min warnings, breaks, eliminations, final-3, winner
- Rebuy tracking (prize pool and avg stack auto-update)
- Payouts panel (top 3 for ≤10 players, top 4 for 11+)
- Final-3 dramatic mode: red background, currency rain, voice announcement
- Winner overlay: confetti, fanfare, payout breakdown
- Works offline after first load
- Bring-your-own custom sounds via `sounds.json`

## What's in this folder
- `index.html` — the entire app in one file
- `manifest.json` — tells phones how to install it
- `sw.js` — service worker for offline support
- `icon-192.png` / `icon-512.png` — the poker chip icon
- `sounds.json.example` — example manifest you can copy into `sounds/sounds.json`
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
