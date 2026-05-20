# GR Poker — Project Brief for Claude

This file is read at the start of every Claude session working on this repo. It contains everything needed to pick up work mid-build without losing context. Update it whenever something material changes.

---

## What this is

A Progressive Web App for the **Greene Room Poker** league in Berkhamsted. Owner / sole admin / developer: **Mark Bayley** (display name "Cactus" at the club). Runs in a browser, installable to phone/laptop home screen.

**Live URL**: https://mcq90210.github.io/grp-app/
**Repo**: https://github.com/McQ90210/grp-app
**Hosting**: GitHub Pages (auto-rebuilds on push to `main`)
**Current version**: v7.7 (see `sw.js` `CACHE_NAME` for what's deployed)

### Two game modes
- **League** — the formal monthly league with seasons, points, bounties, finals
- **High Rollers** — casual side games; just buy-in / position / winnings tracking

### Core user flows
- **Set up game** → wizard → live tournament timer with blind levels, voice/audio cues
- **League & Player Info** → standings dashboard, per-player profiles, game history
- **Admin functions** (signed in only) → import data, edit games, delete games/seasons

---

## Tech stack

Deliberately simple — no build system on the deployed side.

- **React 18** loaded from CDN (`unpkg.com/react@18/umd/react.production.min.js`)
- **Babel-standalone** for in-browser JSX compilation (`@babel/standalone`)
- **Tailwind CSS** via CDN script (`cdn.tailwindcss.com`)
- **Firebase** ES module from `firebase-init.js` (Firestore + Auth)
- **PWA** — service worker (`sw.js`), web manifest (`manifest.json`), installable
- **No bundler, no npm install required to run** — everything resolves at runtime via CDN

The single `index.html` is self-contained: the JSX source is inlined inside a `<script type="text/babel">` block. To rebuild it locally we run a sed/python pipeline on `grp-app.jsx` (see Build pipeline below).

Why this architecture: zero-tooling deploys (just push files to GitHub Pages), simple for one-person maintenance, fast to iterate on without a Node build.

---

## File structure

```
grp-app/                           # repo root
├── index.html                     # the entire deployed app (~3,900 lines of JSX inlined)
├── firebase-init.js               # ES module that initialises Firebase + exposes window.GRP_DB
├── manifest.json                  # PWA manifest (name, theme, icons)
├── sw.js                          # service worker (cache versioning lives here)
├── import-data.json               # one-tap import of historical league data
├── icon-192.png                   # app icon (small)
├── icon-512.png                   # app icon (large)
├── firebase.json                  # Firebase project config (functions deploy)
├── .firebaserc                    # Firebase project alias → gr-poker
├── functions/                     # Cloud Functions (Node 20) — results-email pipeline
│   ├── package.json
│   └── index.js                   # scheduled dailyResultsEmail + callable resendLatestResults
├── README.md
└── logos/
    ├── logo-01.svg                # full GR Poker text logo
    └── logo-02.svg                # chip mark only (used as app icon source)
```

**Source-of-truth file** (NOT in the deployed repo, lives in build sandbox):
`/mnt/user-data/outputs/grp-app.jsx` — the canonical React source. `index.html` is rebuilt from this.

**Build sandbox layout** (`/home/claude/grp-app/`):
```
app.jsx              # grp-app.jsx with imports stripped
combined.jsx         # icons.jsx + app.jsx with hooks destructure prepended
icons.jsx            # SVG icon components inlined as React fns
index.html           # final assembled output
firebase-init.js, sw.js, manifest.json, import-data.json  # deployed files
logos/, icon-*.png   # assets
```

---

## Build / deploy pipeline

The deployed `index.html` is *generated* from `grp-app.jsx`. Steps:

1. Edit `grp-app.jsx` (the master source).
2. Strip the top 2 lines (the `import React...` and blank line, which the in-browser Babel can't resolve).
3. Replace `export default function App` with `function App`.
4. Swap `window.storage.get/set` calls (legacy from Claude artefacts) with direct `localStorage.getItem/setItem`.
5. Prepend a hooks destructure (`const { useState, useEffect, useRef, useCallback } = React;`) and the inline icon shim component.
6. Append `const root = ReactDOM.createRoot(document.getElementById('root')); root.render(<App />);`.
7. Inject the combined JSX into the HTML template inside `<script type="text/babel">`.
8. Bump `CACHE_NAME` in `sw.js` to the new version (e.g. `gr-poker-v7.8`) — this invalidates the old cache on phones.
9. Zip everything for the user to download and drag-drop into the GitHub repo.

The build script is roughly:

```bash
sed '1,2d' /mnt/user-data/outputs/grp-app.jsx > app.jsx
sed -i 's/export default function App/function App/' app.jsx
sed -i 's|await window\.storage\.get(.poker-roster.)|({ value: localStorage.getItem("poker-roster") })|' app.jsx
sed -i 's|await window\.storage\.set(.poker-roster., JSON\.stringify(roster))|localStorage.setItem("poker-roster", JSON.stringify(roster))|' app.jsx
{ echo "const { useState, useEffect, useRef, useCallback } = React;"; cat icons.jsx; cat app.jsx; \
  echo "const root = ReactDOM.createRoot(document.getElementById('root')); root.render(<App />);"; } > combined.jsx
# then inject into index.html template via Python str.replace
sed -i 's/gr-poker-vX\.X/gr-poker-vY.Y/g' sw.js
```

Pre-flight: ALWAYS run a Babel compile check on `grp-app.jsx` before bundling:

```bash
node -e "
const babel = require('@babel/core');
const fs = require('fs');
try { babel.transformSync(fs.readFileSync('/mnt/user-data/outputs/grp-app.jsx', 'utf8'), { presets: ['@babel/preset-react'] }); console.log('OK'); }
catch (e) { console.error('Line', e.loc?.line, ':', e.message.split('\n')[0]); process.exit(1); }
"
```

**Deployment** (the user-side step): user downloads the bundled zip, replaces files in the GitHub repo via the web UI, the GitHub Pages action rebuilds, the phone needs a force-close + reopen to pick up the new service worker. If the cache is stubborn, long-press app icon → App info → Storage → **Clear cache** (NOT "Clear storage" — that wipes localStorage).

---

## Firebase setup

- **Project**: `gr-poker` (Google Cloud / Firebase console)
- **Region**: europe-west2
- **Auth**: Email/Password only. One admin account exists (don't share that email in public commits — see "Privacy" below).
- **Firestore rules**: public read on everything, writes require auth.

The config in `firebase-init.js` is intentionally public (Firebase web configs are designed to be — security is via Firestore rules, not key obscurity):

```javascript
{
  apiKey: "AIzaSyBMaR3kHYp1zqLyYE4Pra6jnKtRQkPxH9Y",
  authDomain: "gr-poker.firebaseapp.com",
  projectId: "gr-poker",
  storageBucket: "gr-poker.firebasestorage.app",
  messagingSenderId: "7361762424",
  appId: "1:7361762424:web:55b77c83122b418896498d"
}
```

### `window.GRP_FIREBASE` and `window.GRP_DB`

`firebase-init.js` initialises Firebase as an ES module, then exposes two globals so the in-browser-compiled JSX (which can't use `import`) can access them:

- `window.GRP_FIREBASE` — the raw Firebase functions: `auth`, `db`, `signIn`, `signOut`, `doc`, `deleteDoc`, etc.
- `window.GRP_DB` — higher-level helpers: `getAllSeasons`, `getAllPlayers`, `getGamesForSeason`, `getAllHighRollerGames`, `saveGame`, `deleteGame`, `bulkImport`, etc.

It also dispatches a `'firebase-ready'` event on `window` once initialisation completes. **All async components that need Firebase MUST wait for this event** (or use `window.GRP_DB` if already set) — see `LeagueDashboard.useEffect` for the canonical pattern. Without this guard, mounting a Firebase-dependent component before init completes causes the "Firebase not loaded" error.

---

## Data model (Firestore)

```
players/{slug}                     # slug = lowercase, hyphenated displayName
  displayName: "Cactus"
  realName: "Mark Bayley"          # optional
  birthday: { month: 6, day: 11 }  # optional
  sound: "none"                    # key in SOUND_LIBRARY for elimination cue
  email: "cactus@example.com"      # optional — used by Cloud Function for results email
  active: true

emailLog/{auto-id}                 # written by the Cloud Function for audit
  sentAt: Timestamp                # serverTimestamp
  gameId: "2026-r1-g3"
  seasonId: "2026-r1"
  recipientCount: 18
  recipientIds: ["cactus", "duck", ...]
  subject: "GR Poker — 2026 — Round 1 Game 3 results"
  type: "results"

seasons/{id}                       # id = "2025-r1", "2025-r2", "2026-r1", etc.
  name: "2025 — Round 1"
  startDate: "2025-01-01"          # ISO date string
  endDate: "2025-06-30"
  totalGames: 6                    # 5 regular + 1 final
  finalGameIndex: 6                # which gameNumber is the final
  status: "active" | "complete"

games/{id}                         # id = "{seasonId}-g{N}", e.g. "2026-r1-g3"
  type: "league" | "highrollers"
  seasonId: "2026-r1"              # only set for league games
  date: "2026-03-04"
  gameNumber: 3
  isFinal: false
  buyIn: 30
  attendees: ["cactus", "duck", ...]
  rebuys: { cactus: 1, duck: 0 }   # per-player rebuy count (often empty)
  totalRebuys: 9                   # sum, used when per-player not tracked
  finishOrder: ["cactus", "duck", "river-dan", ...]   # 1st first
  pot: 750                         # actual money in pot
  payouts: { "1": 300, "2": 200, "3": 130 }           # by place
  leagueMoney: 75                  # 10% of pot (none on finals)
  prizePool: 670                   # pot − leagueMoney − subs (sometimes pre-computed)
  subs: 39                         # £3 × attendee count
  pointsAwarded: { cactus: 10000, duck: 7000, ... }
  bountyHolders: ["chit-chat"]     # players bountied THIS game
  bountyClaims: []                 # players who claimed a bounty (eliminated a bountied player)
  imported: true                   # flag for spreadsheet-imported games
  notes: "Imported from spreadsheet..."
```

### Critical Firestore composite index

The query `games where seasonId == X order by gameNumber` requires a composite index. If you see "The query requires an index" error, click the link in the error message — Firestore generates a one-click create URL. Build takes ~30 seconds.

---

## League rules (LOCKED — verified against spreadsheet)

### Season structure
- **2 rounds per year**: Jan–Jun = Round 1, Jul–Dec = Round 2
- Each round: **5 regular games + 1 final** = 6 games total
- Round 1 final = June; Round 2 final = December
- Final games **do not award league points**

### Per-game points
- Turn-up: **2,000**
- Position bonuses: 1st **+8,000**, 2nd **+5,000**, 3rd **+3,000**, 4th **+1,000**, 5th **+500**
- Birthday bounty (if eligible this month, stacks on top): **+2,000**

**Totals**:
| Place | No bounty | With bounty |
|---|---|---|
| 1st | 10,000 | 12,000 |
| 2nd | 7,000 | 9,000 |
| 3rd | 5,000 | 7,000 |
| 4th | 3,000 | 5,000 |
| 5th | 2,500 | 4,500 |
| DNP | 2,000 | 4,000 |

### Money
- Buy-in: **£30** (rebuy same)
- Subs: **£3 × attendees** per game → kitty (cards, trophies, table)
- League money: **10% of pot** (none on finals) → kitty
- Payouts: top 3 (≤10 players, 50/30/20) or top 4 (11+ players, 45/25/18/12)
- **Payouts rounded to nearest £10**; the rounding remainder is absorbed onto 1st place. Use `roundPayoutsToTens(splits, prizePool)` helper. Reason: club rarely has £5 notes.

### Birthday bounties
- Bountied month = player's birth month
- **Exceptions**: June birthdays bountied in **May** (June is R1 final); December birthdays bountied in **November** (December is R2 final)
- If bountied player doesn't show that month, bounty carries forward to next game they attend
- Bounty effect: +2,000 points to their game result (no separate cash bounty — earlier "50 for bounty" idea was ruled out)

### Finals
- Starting chip stacks: each qualifying player's **round points so far + 10,000**
- 10,000 base is **fixed** for finals (not configurable from setup wizard)
- Final points DO NOT count toward league standings (stored with empty `pointsAwarded: {}`)

---

## Player roster (32 players)

Stored in `import-data.json` and Firestore. Slugs are lowercase, hyphenated.

| Display name | Real name | Birthday | Slug |
|---|---|---|---|
| Cactus | Mark Bayley | Jun 11 | cactus |
| Chicken | Alex | Oct 30 | chicken |
| Duck | Nick Hastings | Jan 16 | duck |
| Ostrich | Mark Raistrick | Feb 20 | ostrich |
| River Dan | Dan Larner | Jul 21 | river-dan |
| Quads | Mark McQueen | May 29 | quads |
| Beans | James Deas | Apr 26 | beans |
| The Boxer | Jake Cuddihy | Nov 18 | the-boxer |
| Chit Chat | Martin Vallance | May 6 | chit-chat |
| Hair | Ross Rattray | Aug 12 | hair |
| Shoes | Matt Buckle | May 18 | shoes |
| Moth | — | May 19 | moth |
| Toby | Toby Prescott | Oct 6 | toby |
| Fire Truck John | John Stephenson | Aug 29 | fire-truck-john |
| David | — | — | david |
| Graham Barlow | — | Oct 11 | graham-barlow |
| The Dentist | Rishi | Oct 4 | the-dentist |
| Dom | — | Mar 14 | dom |
| The Agent | Olli | Oct 27 | the-agent |
| Anthony Boden | — | Nov 2 | anthony-boden |
| PTH | Paul The Horse | Oct 7 | pth |
| Jay Gohil | — | Dec 4 | jay-gohil |
| Simon Wilkins | — | Dec 11 | simon-wilkins |
| Santa | Sanjay | Dec 30 | santa |
| Stephen | — | — | stephen |
| Kelvin The Detective | Kelvin | — | kelvin-the-detective |
| Ben Conolly | — | — | ben-conolly |
| Tinker-Bell | Nick Bell | Jun 27 | tinker-bell |
| Michael Barnes | — | Apr 22 | michael-barnes |
| Oli Elsaesser | — | Jul 15 | oli-elsaesser |
| Sam Maffia | — | Sep 16 | sam-maffia |
| Jimmy | — | Jan 24 | jimmy |

---

## Component architecture

Top-level: `App` (in `grp-app.jsx`) handles routing via `route` state.

```
App (route state: 'home' | 'league-context' | 'setup' | 'timer' | 'league-info' | 'highrollers-info')
├── GameTypePicker         (route='home')
├── SignInModal            (auth)
├── LeagueContextScreen    (route='league-context' — auto-detects season+game, allows override)
├── SetupWizard            (route='setup' — 5-step config: buy-in, stack, players, duration, review)
├── PokerTimerMain         (config!=null — the live tournament screen)
│   ├── Players panel (rebuy +/- controls)
│   ├── Eliminate modal (per-player REBUY and OUT buttons)
│   └── Winner overlay (confetti, fanfare, payouts, VIEW THE LEAGUE button)
├── LeagueDashboard        (route='league-info' — standings table, aggregates, player profiles)
│   ├── PlayerProfile (modal)
│   ├── EditGameModal (admin only, click G1/G2/... header)
│   │   ├── ConfirmDialog (delete game)
│   │   └── ConfirmDialog (delete entire season — triggered via onRequestDeleteSeason callback)
│   └── ImportModal (admin only, when no data yet)
└── HighRollersHistory     (route='highrollers-info' — net profit per player, recent games)
```

### Key state flows

**League game setup**: home → tap "Set Up Game" on LEAGUE card → `LeagueContextScreen` queries Firestore for active season + next un-played game number → user confirms or overrides → `setLeagueContext` → `SetupWizard` (with `leagueContext` prop) → wizard's `finish()` builds `config` with `playerStartingStacks` (for finals, each player = round points + 10,000; for regular, all players = `stackSize`) → `PokerTimerMain` runs the game.

**Avg stack calculation** in PokerTimerMain:
```javascript
const baseChipsFromStarting = config.playerStartingStacks
  ? Object.values(config.playerStartingStacks).reduce((a, b) => a + b, 0)
  : config.stackSize * players.length;
const totalChipsInPlay = baseChipsFromStarting + (config.stackSize * totalRebuys);
const avgStack = activePlayers.length > 0 ? Math.round(totalChipsInPlay / activePlayers.length) : 0;
```

---

## Visual conventions

- Theme colour: **#14a37b** (GR brand green, `theme_color` in manifest)
- Background: dark radial gradient `radial-gradient(ellipse at top, #0a3d1f 0%, #062815 40%, #020a06 100%)`
- Primary text: emerald-100 / emerald-200/80 for body
- Numeric/data: `font-mono` (JetBrains Mono)
- Headings: `font-display` (Bebas Neue) — wide, condensed, uppercase, gold-text gradient
- The `.gold-text` class is a green gradient (despite the name — historic from earlier version) `linear-gradient(135deg, #14a37b 0%, #1ec890 50%, #0e8c69 100%)`
- The `.gold-border` class is a green-tinted border `1px solid rgba(20, 163, 123, 0.4)` with a soft glow shadow
- League standings: per-game cells coloured by finishing position (gold/silver/bronze/emerald/blue for 1st-5th); top-3 leaderboard rank numbers in gold/silver/bronze
- Destructive actions: red-950/40 bg, red-500/30 border, red-300 text; ALWAYS gated by a `ConfirmDialog` requiring the user to type "DELETE"

---

## Sound system

`PokerTimerMain` has three audio layers:

1. **Built-in synthesised sounds** via Web Audio API (formant + FM synthesis) — declared in `SOUND_LIBRARY`. Defaults like "police siren", "ducks quacking", etc.
2. **MP3 lookups** at `sounds/{key}.mp3` — if a file exists at that path, the synth fallback is skipped.
3. **Custom sounds** from `sounds/sounds.json` — user-added entries with their own labels.

Each player has an assigned `sound` key. When eliminated, that sound plays. Sounds are loaded on game start.

**Voice cues**: Web Speech API, defaults to Google US English. Used for blind-up announcements, "down to the final three" dramatic mode, winner announcement.

**Final 3 mode**: red gradient background, falling £/$/€ currency rain animation, dramatic voice. Triggered when `activePlayers.length <= 3 && players.length > 3`.

---

## Email pipeline (results email to league members)

Added in v7.24. League members on the active roster who have an `email` field
get an HTML email the morning after a league game, summarising the result and
showing updated standings.

### Components

- **Email collection UI** — admin opens a player's profile (LeagueDashboard → click a player name), edits the `EMAIL (results delivery)` field, taps SAVE. Stored on the `players/{slug}` document.
- **Scheduled Cloud Function** `dailyResultsEmail` — runs daily at **09:00 Europe/London** via Cloud Scheduler. Queries Firestore for any game with `date == yesterday`. If a league game is found, computes standings + renders HTML + sends via Gmail SMTP (BCC'd to all active players with an email).
- **Callable Cloud Function** `resendLatestResults` — admin-only HTTPS callable triggered by the **✉ RESEND RESULTS** button on the LeagueDashboard. Re-sends the most recent league game's email. Useful if the cron failed or you spot a typo.
- **Audit log** — every send writes a `emailLog/{auto-id}` doc with timestamp, gameId, subject, and recipient IDs.

### Region + runtime

Both functions deployed to **europe-west2** (matches the Firestore region). Runtime: Node.js 20.

### Secrets

Stored via Firebase Functions Secrets (NOT in code, NOT in env files):

- `GMAIL_USER` — full Gmail address (e.g. `grpoker.berkhamsted@gmail.com`)
- `GMAIL_APP_PASSWORD` — 16-char App Password generated from the Gmail account's Security settings (requires 2FA enabled on that Gmail)

Set via:
```bash
firebase functions:secrets:set GMAIL_USER
firebase functions:secrets:set GMAIL_APP_PASSWORD
```

### Deploy

From repo root:
```bash
cd functions && npm install   # one-off
cd ..
firebase deploy --only functions
```

### Cost

Both functions are inside the Blaze free tier for this use case:
- Scheduled: 30 invocations/month (free tier covers 2M).
- Callable: a few clicks/year.
- Gmail SMTP: free; 500 emails/day limit (way under our 32-member-ish ceiling).

A Cloud Billing budget cap (£5/month) is set on the project as a safety net.

### Limitations

- One sender Gmail address — replies come back to it.
- 500/day Gmail SMTP cap (irrelevant at current scale but worth noting if the club ever grows beyond ~300 active members).
- BCC strategy means recipients can't see each other (good for privacy) and can't easily "reply all" (which is also good — most replies should go to the league organiser, not the whole roster).
- No unsubscribe link yet — players ask Mark to remove their email manually.

---

## Pending work (planned for v7.8+)

In rough priority order:

1. **Birthday bounty pre-game splash** — when starting a league game, show a list of who's bountied this month (including carry-forwards from previous unplayed games)
2. **In-game bounty badge** — small indicator on the timer screen showing who's currently bountied
3. **Bounty visible in eliminate modal** — bountied players show a marker next to their name
4. **Bounty-claimed sound** — distinct from winner fanfare, plays when a bountied player is eliminated
5. **End-of-game save flow** — after winner overlay, auto-populated summary with edit fields, single "Save to League" button writes to Firestore (currently must be manually entered via EditGameModal)
6. **Per-player rebuy tracking** — currently only `totalRebuys` is stored; per-player would unlock fairer cost-tracking in HR history
7. ~~Roster sync — load players from Firestore into SetupWizard "Who's playing?" step~~ **Done in v7.8** — loads from Firestore (with localStorage fallback). High Rollers filtered to 9 regulars: Cactus, Beans, Quads, Chit Chat, Duck, Ostrich, Shoes, The Boxer, River Dan.
8. **Charts on player profile** — more than the current points-per-game bar chart (e.g. running total over time, position distribution)
9. **Season management screen** — create new seasons, archive completed ones, configure dates/game counts via UI rather than import data
10. **Real-time multi-device sync (deferred)** — phone-as-controller + laptop/TV-as-display via Firebase Realtime Database (Mark wants this "one day", not yet)

---

## Privacy considerations

- The Firebase project owner is Mark's personal Google account. This is **not** publicly visible (Firebase project owners are only visible to other project members).
- The admin email used for Email/Password auth is NOT Mark's personal email — it's a dedicated admin login.
- The Firebase web config in `firebase-init.js` is intentionally public; security is via Firestore rules, not key obscurity.
- Mark's GitHub username (`mcq90210`) is publicly visible on the repo.
- If full anonymity is required later, Mark can transfer Firebase project ownership to a dedicated club Google account (e.g. `grpoker.berkhamsted@gmail.com`) via Firebase Console → Users and permissions → Add member → Owner, then remove personal account.

---

## Mark's working style (for tone/communication)

- Prefers direct, data-driven recommendations with bull/bear framing for trade-offs
- Likes options laid out clearly before implementation, not asked one at a time
- Values pace — ship small versions, test, iterate; don't over-engineer
- For destructive operations (deletes), always prefer multiple confirmation steps and "type DELETE" gates
- When re-posting files or snippets earlier in a session, send them directly rather than telling Mark to scroll back
- **Don't commit eagerly** — Mark usually has follow-up changes and prefers to batch them into a single version bump + commit (keeps the commit log clean). After making a change, bump `sw.js` cache if relevant, then *wait*. Ask "ready to commit as vX.Y?" rather than committing right away. Only commit when Mark explicitly says so.

---

## Build session checkpoints

Each version is summarised here so a new session can pick up at the right point.

- **v1–v5** — single React artefact in claude.ai → Web Audio synth → voice → scrubbable progress bar → 50-multiple blinds → custom sounds via `sounds/sounds.json`
- **v6** — Firebase integration foundation, GR Poker rebrand, game type picker, sign-in modal
- **v6.1** — bigger logo, aligned card headings
- **v7.0** — home page with 4 action buttons, LeagueDashboard, PlayerProfile modal, ImportModal (one-tap import)
- **v7.1** — race-condition fix (dashboard waits for `firebase-ready` event with 8s safety timeout)
- **v7.2** — payouts rounded to £10s; "VIEW THE LEAGUE" button on winner overlay for League games
- **v7.3** — wider dashboard (max-w-1800), bigger fonts (14px cells), per-position leaderboard rank colours, points-by-game chart bars fixed, separate HighRollersHistory component
- **v7.4** — rebuy button in eliminate modal; LeagueContextScreen (auto-detect season/game, override); final-game starting stacks; EditGameModal for per-game edits; DELETE SEASON button; ConfirmDialog with "type DELETE" requirement
- **v7.5** — revert leaderboard row colours (was hiding names); moved colours to per-game CELLS based on finishing position
- **v7.6** — EditGameModal shows blank for null pot/league/subs values; quick-fill buttons "= 10% pot" and "= £3 × N players"; DELETE SEASON moved from standings page into EditGameModal "DESTRUCTIVE" section
- **v7.7** — fixed season structure (correctly THREE seasons: 2025-r1, 2025-r2, 2026-r1, each 6 games = 5 regular + 1 final); regenerated `import-data.json`. **Deployment required**: delete existing 2025-r1 + 2026-r2 seasons via EditGameModal, then re-import.
- **v7.8** — roster auto-populates from Firestore in SetupWizard (with localStorage fallback for offline); High Rollers filters to 9 regulars; players start unchecked by default (use ALL IN to bulk-select).
- **v7.21** — inline SIGN IN button in the end-of-game SaveGameModal: if you started the game without signing in, you can authenticate without losing the unsaved game.
- **v7.22** — buy-in defaults: League £30, High Rollers £40; preset chips £30 / £40 / £50.
- **v7.23** — mobile fixes for league standings (opaque background on totals sticky-col, edge mask, iOS overscroll containment); HR previous-winners cell shrink-fix.
- **v7.24** — **Results email pipeline**: `email` field on player schema + edit UI in PlayerProfile; Cloud Function `dailyResultsEmail` (cron 09:00 UK) sends HTML email to league members after a game; `resendLatestResults` callable + admin "✉ RESEND RESULTS" button on LeagueDashboard. Sends via Gmail SMTP using Nodemailer; secrets stored in Firebase Secret Manager. Firestore-region functions in `europe-west2`. **Deploy required**: see "Email pipeline" section above for one-off Gmail/Blaze/secrets setup.

---

## Transcript pointer

The full conversation history for this build lives in:
`/mnt/transcripts/2026-05-19-15-30-43-gr-poker-pwa-build.txt`

That transcript contains every iteration, including:
- All the decisions about scoring rules and verification against spreadsheets
- The Mixkit sound-download walkthrough
- The Firebase setup walkthrough (project creation, rules, admin account)
- The AirPlay-to-Mac casting discussion
- Service worker caching debug cycles
- The full grp-app.jsx source at multiple points

If the user references something we did "before" that isn't covered in this CLAUDE.md, check the transcript.

---

## Useful one-liners

**Babel compile check**:
```bash
node -e "const b=require('@babel/core'); const fs=require('fs'); try{b.transformSync(fs.readFileSync('grp-app.jsx','utf8'),{presets:['@babel/preset-react']});console.log('OK')}catch(e){console.error('Line',e.loc?.line,':',e.message.split('\\n')[0]);process.exit(1)}"
```

**Find a function in the source**:
```bash
grep -n "function ComponentName" grp-app.jsx
```

**Inspect import-data.json structure**:
```bash
python3 -c "import json; d=json.load(open('import-data.json')); print(f'{len(d[\"players\"])} players, {len(d[\"seasons\"])} seasons, {len(d[\"games\"])} games'); [print(' ', s['name'], s['status']) for s in d['seasons']]"
```

**Force cache invalidation on phone**: bump `CACHE_NAME` in `sw.js`, then on phone: long-press app icon → App info → Storage → **Clear cache** (NOT Clear storage).
