# GR Poker — Installation Guide

PWA for **Greene Room Poker — Berkhamsted**. Tournament timer + league management.

## What's new in v7 (Phase 2A — league foundations)

**This release brings the spreadsheet to life as a proper database-backed app.**

### Home page redesigned
Each game type card now has **two action buttons**:
- **LEAGUE** → "Set Up Game" or "League & Player Info"
- **HIGH ROLLERS** → "Set Up Game" or "Game History"

### League dashboard (new!)
Spreadsheet-style standings view, accessible from "League & Player Info":
- Sortable table: every player's points across every game in the season
- Sticky first column (player names) and header row when scrolling
- Highlighted top 3 (1./2./3. rank prefix)
- Aggregate rows at the bottom: Players, Rebuys, Pot, League £, Prize £, Subs £, plus 1st-5th payouts per game
- Season picker (switch between Round 1 / Round 2 / future seasons)

### Player profile (new!)
Tap any player name in the standings to open their profile:
- Stats: total points, games played, wins, podiums, total buy-ins, winnings, net £, average points
- Real name + birthday
- Bar chart of points per game (yellow bars = best game)

### Admin: data import
When signed in and there's no data yet, an "IMPORT SPREADSHEET" button appears. Click it once to load:
- **32 players** with display names, real names, birthdays, sound assignments
- **2 seasons**: 2025 Round 1 (complete) + 2026 Round 2 (active)
- **17 games** with attendees, points awarded, pot/payout/league money/subs

Note: finish-order positions are best-effort inferred from points (since the spreadsheet only shows totals). Points themselves are exact. New games recorded going forward will have exact positions from the live timer.

### Still coming in v7.1
- Birthday bounty splash before the game starts
- In-game bounty badge + special sound on bounty claim
- "Save game result" flow at end of tournament (writes to Firestore)
- Roster sync from Firestore into the timer wizard

## How to update from v6.1

1. In your GitHub repo, replace these files:
   - `index.html`
   - `sw.js`
   - `firebase-init.js`
   - `README.md`
2. **Add this new file** to the repo root: `import-data.json` (the spreadsheet data)
3. On your phone, force-close and reopen — service worker v7 picks up the new code
4. **Sign in as admin** (bottom-right of home screen)
5. Tap **LEAGUE → League & Player Info**
6. Tap **IMPORT SPREADSHEET** — runs once, ~5 seconds
7. The dashboard will populate immediately

After that, the league site works publicly at `https://mcq90210.github.io/poker-timer/` — anyone with the link can view standings without signing in.

## What's in this folder
- `index.html` — main app
- `firebase-init.js` — Firebase SDK + data layer
- `import-data.json` — one-off historical data import (delete after first import if you want)
- `manifest.json` / `sw.js` / `icon-*.png` — PWA bits
- `logos/` — original GR Poker SVG logos
- `README.md` — this file
