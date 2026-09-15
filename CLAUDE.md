# GR Poker — Project Brief for Claude

This file is read at the start of every Claude session working on this repo. It contains everything needed to pick up work mid-build without losing context. Update it whenever something material changes.

---

## What this is

A Progressive Web App for the **Greene Room Poker** league in Berkhamsted. Public-facing brand is now **"GRP Berkhamsted"** (email subject lines, browser tab, home-screen icon). Owner / sole admin / developer: **Mark Bayley** (display name "Cactus" at the club). Runs in a browser, installable to phone/laptop home screen.

**Live URL**: https://mcq90210.github.io/grp-app/
**Repo**: https://github.com/McQ90210/grp-app
**Hosting**: GitHub Pages via `.github/workflows/pages.yml` (actions/deploy-pages; Settings → Pages → Source = "GitHub Actions"). The legacy "Deploy from a branch" mode was retired after it repeatedly wedged in `deployment_queued`.
**Current version**: v8.45 (see `sw.js` `CACHE_NAME` for what's deployed)
**Cloud Functions**: deployed in `europe-west2`, Node 22 — `dailyResultsEmail` (cron 09:00 UK), `resendLatestResults`, `resendLatestHRResults`, `sendTestResults`, `sendTestHRResults`, `auditGame`, `applyGamePatch` (whitelisted one-off game repairs incl. `setLeagueMoney`/`setPrizePool`), `migrateSeason` (break-glass — no UI), `wipeSimData`, `simulateGames`

### State as of last session (2026-08-06)

- ✅ Season **2026-r2** active ("2026 — Round 2", 7 games: 6 regular + Dec final), v2 scoring rules live. R2 G1 played 2026-07-01, audited + patched (leagueMoney 0 that night, first-out = Duck, Cactus May-carryover bounty).
- ✅ **2026-r1 marked complete** — rollover now auto-flips the previous season's stored status (v7.91). R1 G6 (June final, 2026-06-05) was played and recorded: 12 players, top-4 paid from a £590 pot (£300/£170/£80/£40), Beans won. Its `attendees` array had been left empty (saved via an edit path that only set finishOrder); backfilled from finishOrder on 2026-07-13. Fully reconciled.
- ✅ Timer screen now carries a right-side rail: 🎂 BOUNTIES + LIVE STANDINGS (full league table, money→KO tiebreaks, click a name to record OUT/REBUY, 1s delayed reveal, FLIP climb animation, yellow flash = scorer, red flash = eliminated). Rail toggles per-box via header buttons; position: absolute portal so it scrolls with the page.
- ✅ Winner overlay: **auto-saves the game** on appearance (silent SaveGameModal instance; falls back to a manual button for test mode / signed-out / resume-inferred winners / failure), two-column layout with UPDATED STANDINGS + per-player narrative breakdowns (place, KO victims by name, bounty counts, first-out).
- ✅ New-player registration modal (birthday + email) fires when a brand-new name is added in the wizard or as a late entry — creates the Firestore player doc immediately so the birthday bounty applies from that game.
- ✅ Subs Ledger redesigned (aggregate OUTSTANDING view + upfront chips + collapsible per-game grid, plain-text cells); paid-for-round toggles confirm in both directions.
- ✅ **Payouts now split `pot − leagueMoney`** (v8.45) at all three sites — timer PAYOUTS panel, winner overlay, SaveGameModal seed. Previously they ran ~10% high on league games and got trimmed by hand. "POT" still shows the raw pot; "PRIZE POOL" shows the payable pool with a `£X pot − £Y league money` note.
- ✅ **Uploaded custom sounds play again** (v8.43/v8.44) — they route through an `HTMLAudioElement` (`playAudioUrl()`) instead of Web Audio `fetch` + `decodeAudioData`, which needed a CORS policy the `gr-poker` Storage bucket doesn't have. The wizard's 🎵 preview also now enables on `customSoundUrl`, not just a library sound.
- ⚠️ **GitHub Pages deploys flake often** ("Deployment failed, try again later" at the deploy step, ~50% some evenings). Remedy: empty commit + push again, retry until success. The Actions workflow itself is fine.
- ⏳ Next league game: R2 G2, early August 2026.

> **Handover note (2026-09-15).** Development moved off the Mac to a Windows PC and a different Claude account. See "Working environment" below — in particular, `grp-app.jsx` and the build sandbox described in older revisions of this file **no longer exist**, and `index.html` is now edited directly.

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

The single `index.html` is self-contained: the JSX source is inlined inside a `<script type="text/babel">` block and compiled in the browser on every page load. It is edited in place — there is no separate source file and no build step (see Build pipeline below).

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

**`index.html` is the source of truth.** Edit it directly.

Earlier revisions of this file described a canonical `grp-app.jsx` at `/mnt/user-data/outputs/` plus a sed/python assembly pipeline in a `/home/claude/grp-app/` sandbox. That sandbox belonged to the original Claude.ai chat and **is gone** — the `.jsx` was never in the repo and no copy survives. Every commit from v8.43 onward is a surgical edit to the inlined JSX inside `index.html`, and that is the workflow now. Don't go looking for the `.jsx`, and don't try to regenerate `index.html` from one.

---

## Build / deploy pipeline

There is no build step. The edit-to-live loop is:

1. Edit the JSX inline in `index.html` (inside the `<script type="text/babel">` block).
2. Bump `CACHE_NAME` in `sw.js` to the new version (e.g. `gr-poker-v8.46`) — this is what invalidates the old cache on phones. **Every user-visible change needs this**, or installed PWAs keep serving the old bundle.
3. Commit and push to `main`.
4. The Pages action (`.github/workflows/pages.yml`) deploys the repo root as-is.
5. On the phone: force-close and reopen to pick up the new service worker. If the cache is stubborn, long-press app icon → App info → Storage → **Clear cache** (NOT "Clear storage" — that wipes localStorage).

Because Babel compiles the JSX **in the browser at load time**, a syntax error doesn't fail a build — it ships and the app renders a blank screen. There is no compile check running anywhere in CI. So: after editing, load the page locally before pushing.

```bash
python -m http.server 8000
```

Then open http://localhost:8000 and check the console. Firebase, React and Tailwind all come from CDNs, so a local server behaves like production apart from the Pages path prefix.

Two recurring hazards documented the hard way (see the v8.01–v8.31 changelog entry): **TDZ crashes** from a hook referencing state declared further down the component blanked the timer twice, and stale-closure bugs in the timer tick. Both present as a blank or frozen screen, not an error toast.

---

## Working environment

Development moved from Mark's Mac to a **Windows PC** on 2026-09-15 (and to a different Claude account).

- **Working copy**: `C:\Claude\grp-app`. A copy also sits at `I:\My Drive\CLAUDE\grp-app` — that was only the transport vehicle for the handover and is **not** a working clone (no commits, dead remote). Don't edit it.
- **Repo name**: the canonical name is `McQ90210/grp-app`. `McQ90210/poker-timer` is an **old name that 301-redirects** — git operations through it still work, which makes it easy to think they're two repos. They aren't.
- **Two GitHub accounts.** The repo belongs to the personal account **McQ90210**, but this PC's stored HTTPS credential is the work account `mark-flwls`, which gets `403 Permission to McQ90210/grp-app.git denied`. The remote therefore uses a dedicated SSH alias, matching the Mac:

  ```
  origin  git@github-mcq90210:McQ90210/grp-app.git
  ```

  backed by `~/.ssh/id_ed25519_mcq90210` and a `Host github-mcq90210` block in `~/.ssh/config`. If push ever 403s, check the remote hasn't been reset to HTTPS.
- **Commits** are authored as `Mark McQueen <mark.mcqueen@flawlessai.com>` (matches all existing history), set repo-locally — there is no global `.gitconfig` on this PC.
- **Missing toolchain**: no Node, npm, Firebase CLI or `gh` on the Windows PC. The app needs none of them (no build step, CDN everything) and Python 3.11 covers local preview. But **`functions/` work and `firebase deploy` are not possible from this machine** until Node + `firebase-tools` are installed.

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

**v1 rules (Jan 2025 – Jun 2026, R1)**:
- Turn-up: **2,000**
- Position bonuses: 1st **+8,000**, 2nd **+5,000**, 3rd **+3,000**, 4th **+1,000**, 5th **+500**
- Bounty: knocker of a bountied player gets **+2,000**

**v2 rules (Jul 2026, R2 onwards)**:
- Turn-up: **2,000**
- Position bonuses: 1st **+8,000**, 2nd **+6,000**, 3rd **+4,000**, 4th **+3,000**, 5th **+2,000**, 6th **+1,000** (attendance stacks on top)
- KO: **+1,000** per knockout (goes to knocker)
- First out: **+1,000** (goes to first player KO'd chronologically, even if they later rebought)
- Bounty claim: **+2,000** per claim (goes to whoever knocks out a bountied player; bountied player self-claims their respawn if they survive to game end)

**v2 totals**:
| Place | Total |
|---|---|
| 1st | 10,000 |
| 2nd | 8,000 |
| 3rd | 6,000 |
| 4th | 5,000 |
| 5th | 4,000 |
| 6th | 3,000 |
| DNP top 6 | 2,000 |

### Standings tiebreaks (confirmed by Mark, 2026-07-03)
Players level on points are ordered by:
1. **Money won this season** (payouts summed by finishing place from each game's `payouts` map — current round only, not all-time)
2. **Knockout count** (season KOs from stored games + live KOs during a game)
3. Name (alphabetical, last resort)

Rank numbers are shared only when points AND both tiebreaks match. Implemented in `computeNaturalStandings()` (timer) and mirrored in the winner overlay.

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

Top-level: `App` (in `index.html`) handles routing via `route` state.

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

Added v7.24, polished through v7.28. League members on the active roster who have an `email` field get an HTML email the morning after a league game, summarising the result, an AI-written narrative recap, and updated standings. **Status: deployed and live.**

### Components

- **Email collection UI** — admin opens a player's profile (LeagueDashboard → click a player name), edits the `EMAIL (results delivery)` field, taps SAVE. Stored on the `players/{slug}` document.
- **Scheduled Cloud Function** `dailyResultsEmail` — runs daily at **09:00 Europe/London** via Cloud Scheduler. Queries Firestore for any game with `date == yesterday`. If a league game is found, computes standings + generates a Gemini recap + renders HTML + sends via Gmail SMTP (BCC'd to all active players with an email).
- **Callable Cloud Function** `resendLatestResults` — admin-only HTTPS callable triggered by the **✉ RESEND RESULTS** button on the LeagueDashboard. Re-sends the most recent league game's email. Useful if the cron failed or you spot a typo.
- **Callable Cloud Function** `migrateSeason` — admin-only HTTPS callable that renames a season's id + name and cascades the change to every attached game (re-IDs each game doc, updates `seasonId` field). One-shot tool: deployed but UI was removed in v7.28. To invoke if needed: `firebase functions:shell` then `migrateSeason({oldSeasonId, newSeasonId, newName}, {auth:{uid:'admin'}})`. Or temporarily restore the MigrateSeasonModal from git history.
- **AI narrative recap** — `generateRecap()` calls Gemini (`gemini-2.5-flash`, free tier) with the game + standings as context. Returns a 3-4 sentence British dry-witty paragraph that's rendered at the top of the email above the podium. If Gemini fails for any reason (quota, network), the email still sends without the recap (graceful degradation).
- **Audit log** — every send writes an `emailLog/{auto-id}` doc with timestamp, gameId, subject, and recipient IDs.

### Region + runtime

All functions deployed to **europe-west2** (matches the Firestore region). Runtime: **Node.js 20** (deprecated April 2026, will be decommissioned **Oct 2026** — upgrade `functions/package.json` engines to `"22"` before then).

### Secrets

Stored via Firebase Functions Secrets (NOT in code, NOT in env files):

| Secret | Value | Notes |
|---|---|---|
| `GMAIL_USER` | `grpberkhamsted@gmail.com` | Dedicated club Gmail account, separate from Mark's personal one |
| `GMAIL_APP_PASSWORD` | 16-char App Password | Generated from the club Gmail's Security → App Passwords. Requires 2FA on that Gmail (it is enabled). |
| `GEMINI_API_KEY` | Personal Google AI Studio key (`AIza...`) | **Important**: created in a separate "Default Gemini Project" (Mark's personal Google account), NOT in the gr-poker Firebase project. The gr-poker project is on Blaze billing which disqualifies it from Gemini's free tier — a separate billing-free project is required. |

Set/update via:
```bash
firebase functions:secrets:set GMAIL_USER          # paste address
firebase functions:secrets:set GMAIL_APP_PASSWORD  # paste 16-char password
firebase functions:secrets:set GEMINI_API_KEY      # paste AIza... key
```

Updating a secret creates a new version. **Functions must be redeployed** to pin to the new version — Firebase will prompt to redeploy automatically when you set a secret.

### Deploy

From repo root:
```bash
cd functions && npm install   # one-off
cd ..
firebase deploy --only functions
```

Claude can and should run `firebase deploy --only functions` directly during sessions — Mark has confirmed he prefers this over being asked each time. The local `firebase login` token is cached and valid.

### Email design (v7.28 — current)

- **Layout**: single solid panel-green canvas (`#062815`), no nested cards. 520px max-width content centred.
- **Sections**: small uppercase emerald labels ("LAST NIGHT'S PODIUM", "UPDATED STANDINGS"); thin row dividers (`rgba(20,163,123,0.12)`) instead of darker container backgrounds.
- **Recap quote**: left-edge accent bar only (no background fill), 60-100 word AI prose.
- **Podium table**: 3 rows max, medal emoji + name + payout in monospace.
- **Standings table**: rank (gold/silver/bronze for top 3), player, points (right-aligned mono), played (left-aligned mono with 24px left padding so it sits clear of points).
- **Footer**: hairline divider + "Greene Room Poker, Berkhamsted · View full standings" link.
- **Gradient experiments don't work**: Gmail strips `background-image: radial-gradient(...)` in many cases. The current design is solid colour only.

### Gemini prompt (v7.27 + v7.28)

Lives in `generateRecap()` in `functions/index.js`. Key constraints baked in:
- 3-4 sentences, 60-100 words
- Tone: warm, dry-witty, British pub energy
- Reference at least TWO player nicknames and AT LEAST ONE specific number
- **Forbidden**: exclamation marks, hyphens (-), em-dashes (—), "epic", "showdown", "thrilling", "battle", "duel", "clash"
- **Cadence**: explicit "ONE league game per month (not weekly)" so the model doesn't suggest "next week"
- When mentioning the next game, say "next month" or "the next game"
- `thinkingConfig.thinkingBudget = 0` (disables Gemini 2.5's internal reasoning tokens, which would otherwise eat into the response budget and truncate output)
- `temperature: 0.8`, `maxOutputTokens: 400`

### Cost

All inside Blaze + Gemini free tiers for this use case:
- Scheduled function: 30 invocations/month (free tier: 2M)
- Callable: a few clicks/year
- Gmail SMTP: free; 500 emails/day limit
- Gemini 2.5 Flash: 250 requests/day free; we use ~12/year

A Cloud Billing budget cap (**£5/month**) is set on the gr-poker project as a safety net. Mark realistically pays £0.

### Limitations

- One sender Gmail address — replies come back to it.
- 500/day Gmail SMTP cap (irrelevant at current scale).
- BCC strategy means recipients can't see each other or "reply all" (intentional — privacy + keeps replies to organiser).
- No unsubscribe link yet — players ask Mark to remove their email manually.
- Gemini key lives in a separate Google project, which is fine but means a quota issue there doesn't show up in gr-poker's Firebase dashboard.

---

## Pending work

In rough priority order:

1. **End-of-round AWARDS screen** — for the Christmas (R2) final: scan the round's game docs and compute award winners automatically. Agreed award ideas (all computable from existing data): Nemesis (most KOs of the same victim), The Hitman (most total KOs), Most Rebuys, The Early Bath (most first-outs), Bounty Hunter (most bounty claims), The Marked Man (most-claimed bountied player), The Bridesmaid (most 2nds, no win), Bubble Boy (most just-out-of-the-money), Iron Man (perfect attendance), The Banker (most £ won), Best ROI, The Philanthropist (most £ in, least back), The Punchbag (most times KO'd), Giant Killer (most KOs of the round champion), Mr Consistent (best avg finish), The Comeback (biggest climb), Wooden Spoon. Could feed the Gemini recap for the final's results email.
2. **Real-time multi-device sync (deferred)** — phone-as-controller + laptop/TV-as-display via Firebase Realtime Database (Mark wants this "one day", not yet)
3. **`firebase-admin` / `nodemailer` major-version bumps** — 13→14 and 6→9 respectively. Both have breaking changes; check release notes before bumping. Not urgent — current versions are stable.

### Done in previous sessions
- ~~Roster sync from Firestore into SetupWizard~~ — v7.8
- ~~End-of-game save flow~~ — SaveGameModal auto-populates from game state. v7.4 + v7.21; fully automatic on winner from v8.41
- ~~Results email + AI recap~~ — v7.24 through v7.28
- ~~GRP Berkhamsted rebrand~~ — v7.26
- ~~Bounty pre-game splash / in-game badges / eliminate-modal markers / bounty-claimed sound~~ — v7.92 + v7.93
- ~~Per-player rebuy tracking~~ — stored in game docs' `rebuys` map; profile buy-ins use it (v7.84)
- ~~Charts on player profile~~ — cumulative line, finishing positions, position distribution, KO/bounty/first-out stats (v7.96)
- ~~Season management screen~~ — 🗓 SEASONS modal under admin tools (v7.97)

### Out-of-scope thought experiments (not actively planned)
- **Multi-tenant SaaS** — Mark asked about productising this for other clubs (~£15/mo per league). Bull case ~£15k MRR at 1k leagues. Not started; would need ~3-4 weeks of de-hardcoding + auth tiers + Stripe + onboarding before it could be sold. See conversation history for full bull/bear breakdown.

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
- **Do run deploys directly** — `firebase deploy --only functions` doesn't require asking. Mark has the CLI installed, his auth token is cached, and the deploy is reversible. Same for any read-only Firebase / git diagnostic commands. The deferral pattern is just for git commits.
- **Cache-bumping awareness**: when changes touch `index.html`, `firebase-init.js`, `manifest.json`, `sw.js` itself, or `logos/*`, bump `CACHE_NAME` in `sw.js`. Pure `functions/` changes don't need it. After pushing, expect the user to need to force-refresh (Cmd+Shift+R, or unregister SW + Clear site data via DevTools, or Incognito) — Chrome on Mac keeps stale module-script copies across cache bumps in stubborn ways.
- **Gradient experiments don't work in Gmail** — Gmail strips `background-image: radial-gradient(...)` declarations in many contexts. We tried, it failed, we reverted to solid colours. Don't propose gradients for the email template again unless using a generated image.
- **Git author identity** — Mark hasn't set `user.email` globally. Commits show as `Mark McQueen <mark.mcqueen@mark-mcqueen.lan>` (his Mac's hostname). Not blocking but worth flagging once per session at most. The fix is `git config --global user.email "the-email-his-github-uses"` (Mark's choice when ready).

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
- **v7.26** — **Rebrand**: "GR Poker" → "GRP Berkhamsted" across email subject/from/header + PWA manifest name + browser tab title (`<title>`, `apple-mobile-web-app-title`). Manifest `short_name` = "GRP". Formal "Greene Room Poker" left intact in the email footer and Gemini prompt context (it's still the real club name).  Also added `migrateSeason` callable Cloud Function + temporary admin UI (button + modal) to rename a season's id and cascade the change to all attached games. Used once to migrate `2026-r2` (wrongly named "Round 2") → `2026-r1` ("Round 1") in production Firestore.
- **v7.27** — Gemini recap prompt clarifies the league plays **monthly** (one game/month, not weekly) so the AI stops writing "see you next week". Added "next month" / "the next game" as preferred phrasing.
- **v7.28** — **Email design polish**: dropped nested-card backgrounds, tightened max-width to 520px, switched section headings to compact uppercase labels, thin row dividers, left-aligned PLAYED column with 24px padding so it doesn't crowd POINTS. Also: added `thinkingConfig.thinkingBudget = 0` to the Gemini call (2.5-flash was truncating output before it started — internal reasoning tokens were eating the budget). Added "no hyphens / em-dashes" to the prompt constraints. **Retired the SEASON TOOLS UI** (button + MigrateSeasonModal removed). The `migrateSeason` Cloud Function and `window.GRP_DB.migrateSeason` helper stay deployed as a break-glass tool — callable via Firebase Functions Shell if a future season needs renaming.
- **v7.29–v7.85** (sessions to 2026-07-03) — v2 scoring rules for R2 2026 onwards (KO/first-out/bounty-claim bonuses, 6 paid places, chronological `knockouts` log with rebuy respawns); rebuy/freezeout format flag; season auto-rollover + test mode; Firebase Storage per-player sound uploads; per-attendee buy-in/subs payment chips + Subs Ledger admin modal with edit-mode gate; HR results email (`resendLatestHRResults`, `sendTestHRResults`); `auditGame` + `applyGamePatch` admin callables; R2 G1 data audit + patches; Gemini 503 retry; prizePool math fix (pot − leagueMoney only; subs never in the pot); Node 22 runtime.
- **v7.86–v8.00** (2026-07-02) — live standings work begins: BONUS POINTS panel → season-standings integration; Subs Ledger simplified (aggregate OUTSTANDING view, plain ✓/OWES cells); points-breakdown popup on the league dashboard (click any points cell); bounty pre-game splash + in-game 🎂 badges + bounty-claimed cha-ching; season management modal (create/edit/rename via `migrateSeason`); player profile KO/bounty/first-out stats + position histogram; **v2 position-bonus fix** (stored array had totals, attendance double-counted — every R2 top-6 result was +2,000 too high; R2 G1 patched via `applyGamePatch`); league table colours only paid places (gold/silver/bronze/indigo, grey otherwise); **switched Pages to the Actions workflow** after the legacy branch-deploy queue wedged for hours.
- **v8.01–v8.31** (2026-07-03) — the LIVE STANDINGS side-rail saga: full league table with money→KO tiebreaks on the timer's right side (toggleable, portal-rendered, scrolls with the page), click-a-name OUT/REBUY shortcut (replaces the eliminate button when the rail is on), 1s delayed reveal, FLIP-animated single-slide rank climb (yellow flash on the scorer, 1s fade-out). Hard-won lessons encoded in the code comments: TDZ crashes from hooks referencing later-declared state blanked the timer twice (v8.11, v8.13); FLIP needs deps-gated effects (timer tick was resetting transforms mid-slide), per-variant ref namespaces (hidden mobile copy of the list was hijacking refs → measurements of display:none rows), inline-transition cleanup after slides (inline `transition: transform` overrides class-based colour fades), and a single shared `computeNaturalStandings()` for rail + animation (two sort implementations drifted and the climb overshot). Also: paid-for-round chip confirms both directions.
- **v8.32–v8.41** (2026-07-03/04) — new-player registration modal (birthday + email → immediate player doc, bounty applies same game); winner overlay rebuilt: two-column layout (champion/payouts left, UPDATED STANDINGS right, one page, ✕ to exit), per-player narrative breakdowns (place, KO victims by name, bounty counts, first-out — no point arithmetic), **auto-save on winner** (silent SaveGameModal instance; manual button kept for test mode / signed-out / resume-inferred winners / failures); eliminated player always flashes red on the rail reveal.
- **v8.42 + functions** (2026-07-04) — KO timestamps (`at: Date.now()` on every knockouts entry, carried to Firestore; null pre-v8.42) accumulating for the Christmas awards; **storyful Gemini recap**: prompt gets a pre-tallied match-facts block (per-knocker KO totals + victim lists, KNOCKOUT LEADER line at 3+, direction-proof bounty-claim wording, first-out, rebuys) with a STRICT ACCURACY clause — an earlier raw-log version made Gemini miscount and swap names; **`sendTestResults` callable** (league twin of `sendTestHRResults`: full pipeline, one recipient, [TEST] subject) — tested end-to-end against R2 G1, recap verified factually correct (River Dan's 6 KOs lead, £240 winner payout confirmed by Mark: £20 was moved from 1st to fund a 4th payout at save time).
- **v8.43–v8.45** (2026-08-05/06) — **uploaded sounds fixed**: custom per-player sounds in Firebase Storage never played, because `playSound` fetched the download URL and decoded it through Web Audio (`fetch` + `decodeAudioData`), which reads raw bytes cross-origin and needs a CORS policy on the `gr-poker` bucket allowing `mcq90210.github.io` — there is none (uploads work because Firebase's *upload* endpoint sets its own permissive CORS; the download fetch doesn't). New `playAudioUrl()` streams the URL through an `HTMLAudioElement`, which needs no CORS because it never exposes samples to JS; the `customUrl` branch routes through it and falls back to the library `soundKey` if the element errors. No bucket change needed. v8.44 then enabled the wizard's 🎵 preview for those players (its disabled check only looked at `player.sound` and ignored `player.customSoundUrl`, though the onClick already passed the URL). **v8.45: payouts split `pot − leagueMoney`** at all three sites (timer PAYOUTS panel, winner overlay, SaveGameModal seed) — the 10% league money was tracked but never deducted, so suggested payouts ran ~10% high on league games and were trimmed by hand every time. `leagueMoney` = 10% of pot rounded to nearest £10 on regular league games, 0 for finals and High Rollers; subs stay separate and never touch payouts. "POT" still shows the raw pot; "PRIZE POOL" shows the payable pool with a `£X pot − £Y league money` note. SaveGameModal's default reuses the same computed value so seed and field can't drift.

---

## Transcript pointer

Older revisions pointed at `/mnt/transcripts/2026-05-19-15-30-43-gr-poker-pwa-build.txt` for the full build history (scoring-rule decisions, the Mixkit sound walkthrough, Firebase setup, service-worker debugging). **That transcript is gone** — it lived in the original Claude.ai sandbox, which did not survive the 2026-09-15 handover.

So this file plus `git log` are now the only history. If Mark references something done "before" that isn't covered here, ask rather than guess — and when the answer turns out to be load-bearing, write it into this file.

---

## Useful one-liners

**Serve locally** (Babel compiles in-browser, so this is the only syntax check there is):
```bash
python -m http.server 8000
```

**Find a function in the source**:
```bash
grep -n "function ComponentName" index.html
```

**Inspect import-data.json structure**:
```bash
python -c "import json; d=json.load(open('import-data.json')); print(f'{len(d[\"players\"])} players, {len(d[\"seasons\"])} seasons, {len(d[\"games\"])} games'); [print(' ', s['name'], s['status']) for s in d['seasons']]"
```

**Force cache invalidation on phone**: bump `CACHE_NAME` in `sw.js`, then on phone: long-press app icon → App info → Storage → **Clear cache** (NOT Clear storage).
