// GR Poker league — results-email Cloud Functions
//
// What this does:
//   1. dailyResultsEmail (scheduled): 09:00 Europe/London every day. Looks for a
//      league game played "yesterday" (UK calendar date). If found, emails all
//      active players with an `email` field, BCC'd, via Gmail SMTP.
//   2. resendLatestResults (callable): admin-only. Re-sends the most recent
//      league game's results email on demand. Used by the "Resend" button on
//      the league dashboard.
//
// Secrets used (set via `firebase functions:secrets:set GMAIL_USER` etc):
//   - GMAIL_USER             — full Gmail address (e.g. grpoker.berkhamsted@gmail.com)
//   - GMAIL_APP_PASSWORD     — 16-char App Password from Google account 2FA settings
//
// Both functions write to `emailLog/{auto-id}` for audit.

const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const nodemailer = require('nodemailer');

admin.initializeApp();
const db = admin.firestore();

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
// Optional — used by generateRecap() below. Free-tier Google AI Studio key.
// If unset, the email still sends without a recap.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const REGION = 'europe-west2';

// ============================================================================
// Firestore helpers
// ============================================================================

async function getGamesForSeason(seasonId) {
  // Requires composite index on (seasonId asc, gameNumber asc). The app already
  // depends on this index — see CLAUDE.md "Critical Firestore composite index".
  const snap = await db
    .collection('games')
    .where('seasonId', '==', seasonId)
    .orderBy('gameNumber', 'asc')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getGamesByDate(dateStr) {
  // Single-field query (no composite index needed).
  const snap = await db.collection('games').where('date', '==', dateStr).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getMostRecentLeagueGame() {
  // Collection is small (<200 docs forever) — fetch all and sort in memory to
  // avoid needing yet another composite index on (type, date).
  const snap = await db.collection('games').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return (
    all
      .filter((g) => g.type === 'league' && g.date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null
  );
}

async function getAllPlayers() {
  const snap = await db.collection('players').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getSeason(seasonId) {
  const snap = await db.doc(`seasons/${seasonId}`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// ============================================================================
// Domain helpers
// ============================================================================

// Yesterday's date in Europe/London (YYYY-MM-DD).
function ukYesterdayString() {
  const now = new Date();
  // Use Intl to render the date in London time, then subtract a day.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA gives YYYY-MM-DD when formatted as date parts joined with hyphens.
  const todayParts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  const todayUK = new Date(
    `${todayParts.year}-${todayParts.month}-${todayParts.day}T12:00:00Z`
  );
  const yesterday = new Date(todayUK.getTime() - 86400000);
  const yParts = fmt.formatToParts(yesterday).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${yParts.year}-${yParts.month}-${yParts.day}`;
}

// Compute standings rows for a season, sorted by total points desc.
//
// If `latestGameId` is passed, each row also carries:
//   - delta:   integer position change vs. the standings as they were BEFORE
//              that game (positive = moved up, negative = moved down, 0 = same)
//   - isNew:   true if the player had no prior points and is appearing for the
//              first time in this game (delta will be null)
//
// Returns: [{ pid, displayName, total, gamesPlayed, delta, isNew }, ...]
function computeStandings(games, players, latestGameId) {
  // Current totals + game counts
  const totals = {};
  const playedCount = {};
  games.forEach((g) => {
    Object.entries(g.pointsAwarded || {}).forEach(([pid, pts]) => {
      totals[pid] = (totals[pid] || 0) + (pts || 0);
      if (pts > 0) playedCount[pid] = (playedCount[pid] || 0) + 1;
    });
  });

  // Prior totals: same as current minus whatever the latest game contributed.
  // (Players who didn't play the latest game have unchanged totals.)
  const priorRankMap = {};
  if (latestGameId) {
    const latestGame = games.find((g) => g.id === latestGameId);
    const latestPoints = latestGame ? (latestGame.pointsAwarded || {}) : {};
    const priorTotals = {};
    Object.entries(totals).forEach(([pid, t]) => {
      priorTotals[pid] = t - (latestPoints[pid] || 0);
    });
    // Build prior ranking — only players who had points before this game qualify
    Object.entries(priorTotals)
      .filter(([, t]) => t > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([pid], i) => { priorRankMap[pid] = i + 1; });
  }

  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  return Object.entries(totals)
    .filter(([, t]) => t > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, total], i) => {
      const currentRank = i + 1;
      const priorRank = priorRankMap[pid];
      let delta = null;
      let isNew = false;
      if (latestGameId) {
        if (priorRank === undefined) {
          isNew = true;
        } else {
          delta = priorRank - currentRank;
        }
      }
      return {
        pid,
        displayName: playersById[pid]?.displayName || pid,
        total,
        gamesPlayed: playedCount[pid] || 0,
        delta,
        isNew,
      };
    });
}

// ============================================================================
// AI recap — short prose intro generated per email via Gemini (free tier).
// ============================================================================

// Returns a 2-3 sentence recap string, or null if Gemini is unavailable or
// returns nothing useful. We never fail the email send if the recap fails —
// just skip the intro paragraph.
async function generateRecap({ game, season, standings, players }) {
  const key = (() => {
    try { return GEMINI_API_KEY.value(); } catch { return null; }
  })();
  if (!key) return null;

  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  const podium = [1, 2, 3].map((place) => {
    const pid = (game.finishOrder || [])[place - 1];
    const name = pid ? playersById[pid]?.displayName || pid : null;
    const payout = game.payouts?.[String(place)] || 0;
    return name ? `${place}. ${name} (£${payout})` : null;
  }).filter(Boolean).join(', ');

  const standingsBlurb = standings.slice(0, 5).map((s, i) =>
    `${i + 1}. ${s.displayName} (${s.total.toLocaleString()} pts, ${s.gamesPlayed} games)`
  ).join('\n');

  const prompt = `Write a 3-4 sentence recap (60-100 words) of last night's Greene Room Poker
league game, for the morning-after results email. Tone: warm, dry-witty, British pub
energy. Reference at least TWO specific player nicknames and AT LEAST ONE specific
number (place, points, pot, gap in standings, win count). Never use exclamation marks.
Never use hyphens or em-dashes (-, —). Use commas, full stops, or rewrite the sentence
instead. Never use the words "epic", "showdown", "thrilling", "battle", "duel", "clash".
Output JUST the prose paragraph — no greeting, no sign-off, no markdown, no headers.

Context:
- League: Greene Room Poker, Berkhamsted (pub venue)
- Cadence: ONE league game per month (not weekly). A round is 5 regular games + 1 final, spread over 6 months.
- Season: ${season.name}
- Game ${game.gameNumber}${game.isFinal ? ' (FINAL — no points awarded)' : ''} on ${game.date}
- ${(game.attendees || []).length} players, pot £${game.pot || 0}, ${game.totalRebuys || 0} rebuys
- Podium: ${podium || 'no results recorded'}

When referring to the next game, say "next month" or "the next game", never "next week" or "tonight".

Top-5 season standings after last night:
${standingsBlurb || '(no standings yet)'}

Now write the recap (3-4 sentences, 60-100 words):`;

  try {
    // gemini-2.5-flash is the current free-tier flagship. If 429s come back,
    // try gemini-2.5-flash-lite (smaller, more generous quota) or
    // gemini-1.5-flash (legacy, very stable free tier).
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Disable Gemini 2.5's internal "thinking" tokens. Without this, the
          // model spends most of maxOutputTokens reasoning silently and truncates
          // the actual response mid-sentence.
          thinkingConfig: { thinkingBudget: 0 },
          temperature: 0.8,
          maxOutputTokens: 400,
        },
      }),
    });
    if (!res.ok) {
      logger.warn(`Gemini API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      logger.warn('Gemini returned no text:', JSON.stringify(json).slice(0, 200));
      return null;
    }
    return text;
  } catch (err) {
    logger.warn('generateRecap failed (continuing without):', err.message);
    return null;
  }
}

// ============================================================================
// Email rendering (inline-styled HTML for email-client safety)
// ============================================================================

// Brand colours (kept in sync with the app's .gold-text gradient and CLAUDE.md).
const BRAND_GREEN = '#14a37b';
const BRAND_GREEN_LIGHT = '#1ec890';
const BG_DARKEST = '#020a06';     // outer body (closest to black, like the app)
const BG_DARK = '#062815';        // inner content panel (slightly lifted)
const TEXT_LIGHT = '#d1fae5';

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function renderResultsEmail({ game, season, standings, players, recap }) {
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  const finishOrder = (game.finishOrder || []).map((pid) => ({
    pid,
    name: playersById[pid]?.displayName || pid,
  }));

  // Subtle row divider between every line in the tables.
  const ROW_DIVIDER = 'border-bottom:1px solid rgba(20,163,123,0.12);';

  // Podium rows (top 3 with payouts).
  const podium = [1, 2, 3].map((place) => {
    const f = finishOrder[place - 1];
    const payout = game.payouts?.[String(place)] || 0;
    const last = place === 3 ? '' : ROW_DIVIDER;
    return f
      ? `<tr>
           <td style="padding:10px 4px;font-size:18px;width:32px;${last}">${['🥇', '🥈', '🥉'][place - 1]}</td>
           <td style="padding:10px 4px;color:${TEXT_LIGHT};font-weight:600;font-size:15px;${last}">${escape(f.name)}</td>
           <td style="padding:10px 4px;color:${BRAND_GREEN_LIGHT};text-align:right;font-family:monospace;font-size:15px;${last}">£${payout}</td>
         </tr>`
      : '';
  }).join('');

  // Render the position-change indicator for one standings row.
  //   delta > 0  → ▲ +N (green)
  //   delta < 0  → ▼ -N (red)
  //   delta == 0 → no change (grey dash)
  //   isNew      → small yellow "NEW" pill (player appeared for the first time)
  const renderDelta = (row) => {
    if (row.isNew) {
      return `<span style="color:#fcd34d;font-size:10px;font-weight:700;letter-spacing:0.05em;">NEW</span>`;
    }
    if (row.delta === null || row.delta === undefined) {
      return `<span style="color:#4b5563;">·</span>`;
    }
    if (row.delta > 0) {
      return `<span style="color:#34d399;font-family:monospace;font-weight:600;">▲${row.delta}</span>`;
    }
    if (row.delta < 0) {
      return `<span style="color:#f87171;font-family:monospace;font-weight:600;">▼${Math.abs(row.delta)}</span>`;
    }
    return `<span style="color:#6b7280;font-family:monospace;">—</span>`;
  };

  // Standings rows.
  const standingsRows = standings
    .map((row, i) => {
      const rankColours = ['#f4d03f', '#d4d4d4', '#d4924a'];
      const rankColour = rankColours[i] || TEXT_LIGHT;
      const last = i === standings.length - 1 ? '' : ROW_DIVIDER;
      return `<tr>
        <td style="padding:8px 4px;color:${rankColour};font-weight:700;font-family:monospace;width:32px;${last}">${i + 1}</td>
        <td style="padding:8px 4px;text-align:left;font-size:12px;width:48px;${last}">${renderDelta(row)}</td>
        <td style="padding:8px 4px;color:${TEXT_LIGHT};${last}">${escape(row.displayName)}</td>
        <td style="padding:8px 4px;color:${BRAND_GREEN_LIGHT};text-align:right;font-family:monospace;font-weight:600;${last}">${row.total.toLocaleString()}</td>
        <td style="padding:8px 4px 8px 24px;color:#9ca3af;text-align:left;font-family:monospace;${last}">${row.gamesPlayed}</td>
      </tr>`;
    })
    .join('');

  const attendeeCount = (game.attendees || []).length;
  const rebuys = game.totalRebuys || 0;
  const pot = game.pot || 0;
  const subs = game.subs || 0;
  const leagueMoney = game.leagueMoney || 0;
  const isFinal = !!game.isFinal;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>GRP Berkhamsted results</title></head>
<body style="margin:0;padding:0;background-color:${BG_DARK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:28px 26px 24px;color:${TEXT_LIGHT};">

    <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${BRAND_GREEN_LIGHT};letter-spacing:0.05em;font-size:24px;margin:0 0 2px;text-transform:uppercase;">GRP Berkhamsted</h1>
    <div style="color:${BRAND_GREEN};font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:20px;">
      ${escape(season.name)} · Game ${game.gameNumber}${isFinal ? ' · FINAL' : ''} · ${escape(game.date)}
    </div>

    ${
      recap
        ? `<div style="padding:0 0 0 14px;margin-bottom:24px;border-left:2px solid ${BRAND_GREEN};color:${TEXT_LIGHT};font-size:15px;line-height:1.55;">
            ${escape(recap)}
          </div>`
        : ''
    }

    <div style="color:${BRAND_GREEN_LIGHT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 4px;font-weight:600;">Last night's podium</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      ${podium || `<tr><td style="padding:12px 0;color:#9ca3af;">No results recorded.</td></tr>`}
    </table>

    <div style="color:#9ca3af;font-size:12px;font-family:monospace;margin-bottom:28px;">
      ${attendeeCount} players · ${rebuys} rebuys · £${pot} pot · £${leagueMoney} to league · £${subs} subs
    </div>

    ${
      isFinal
        ? `<div style="border-left:2px solid #fcd34d;padding:2px 0 2px 14px;margin-bottom:28px;color:#fcd34d;font-size:13px;line-height:1.5;">
            Final game, no league points awarded. The standings below are the season-end totals.
          </div>`
        : ''
    }

    <div style="color:${BRAND_GREEN_LIGHT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 4px;font-weight:600;">Updated standings</div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="padding:6px 4px;text-align:left;color:${BRAND_GREEN};font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;border-bottom:1px solid rgba(20,163,123,0.25);width:32px;">#</th>
          <th style="padding:6px 4px;text-align:left;color:${BRAND_GREEN};font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;border-bottom:1px solid rgba(20,163,123,0.25);width:48px;">Δ</th>
          <th style="padding:6px 4px;text-align:left;color:${BRAND_GREEN};font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;border-bottom:1px solid rgba(20,163,123,0.25);">Player</th>
          <th style="padding:6px 4px;text-align:right;color:${BRAND_GREEN};font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;border-bottom:1px solid rgba(20,163,123,0.25);">Points</th>
          <th style="padding:6px 4px 6px 24px;text-align:left;color:${BRAND_GREEN};font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;border-bottom:1px solid rgba(20,163,123,0.25);">Played</th>
        </tr>
      </thead>
      <tbody>${standingsRows}</tbody>
    </table>

    <div style="margin-top:28px;padding-top:14px;border-top:1px solid rgba(20,163,123,0.18);color:#6b7280;font-size:11px;text-align:center;letter-spacing:0.05em;">
      Greene Room Poker, Berkhamsted &nbsp;·&nbsp;
      <a href="https://mcq90210.github.io/grp-app/" style="color:${BRAND_GREEN_LIGHT};text-decoration:none;">View full standings</a>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================================
// Send-mail core (shared by scheduled and callable functions)
// ============================================================================

async function sendResultsForGame(game) {
  if (!game) throw new Error('No game provided.');
  if (game.type !== 'league') {
    return { skipped: true, reason: `Game ${game.id} is not a league game (type=${game.type}).` };
  }
  if (!game.seasonId) {
    return { skipped: true, reason: `Game ${game.id} has no seasonId.` };
  }

  const [season, seasonGames, players] = await Promise.all([
    getSeason(game.seasonId),
    getGamesForSeason(game.seasonId),
    getAllPlayers(),
  ]);
  if (!season) {
    throw new Error(`Season ${game.seasonId} not found.`);
  }

  const recipients = players.filter(
    (p) => p.active !== false && typeof p.email === 'string' && p.email.includes('@')
  );
  if (recipients.length === 0) {
    return { skipped: true, reason: 'No players with email addresses on file.' };
  }

  const standings = computeStandings(seasonGames, players, game.id);
  // Best-effort AI recap. If Gemini's unavailable, recap is null and the email
  // still goes out — just without the prose intro.
  const recap = await generateRecap({ game, season, standings, players });
  const html = renderResultsEmail({ game, season, standings, players, recap });

  const user = GMAIL_USER.value();
  const pass = GMAIL_APP_PASSWORD.value();
  if (!user || !pass) {
    throw new Error('Gmail secrets are not configured (GMAIL_USER / GMAIL_APP_PASSWORD).');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const subject = `GRP Berkhamsted: ${season.name} · Game ${game.gameNumber}${
    game.isFinal ? ' FINAL' : ''
  } results`;

  await transporter.sendMail({
    from: `"GRP Berkhamsted" <${user}>`,
    to: user, // visible recipient = sender (so individual addresses stay private)
    bcc: recipients.map((r) => r.email),
    subject,
    html,
  });

  // Audit log.
  await db.collection('emailLog').add({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    gameId: game.id,
    seasonId: game.seasonId,
    recipientCount: recipients.length,
    recipientIds: recipients.map((r) => r.id),
    subject,
    type: 'results',
  });

  return { sent: recipients.length, gameId: game.id };
}

// ============================================================================
// Exported functions
// ============================================================================

// Scheduled: every day at 09:00 Europe/London.
exports.dailyResultsEmail = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Europe/London',
    region: REGION,
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, GEMINI_API_KEY],
    retryCount: 1,
  },
  async () => {
    const dateStr = ukYesterdayString();
    const games = await getGamesByDate(dateStr);
    const leagueGames = games.filter((g) => g.type === 'league');
    if (leagueGames.length === 0) {
      logger.info(`No league game on ${dateStr} — nothing to send.`);
      return;
    }
    for (const game of leagueGames) {
      try {
        const result = await sendResultsForGame(game);
        if (result.skipped) {
          logger.warn(`Skipped game ${game.id}: ${result.reason}`);
        } else {
          logger.info(`Sent results for game ${game.id} to ${result.sent} recipients.`);
        }
      } catch (err) {
        logger.error(`Failed to send for game ${game.id}:`, err);
      }
    }
  }
);

// Callable: admin presses "Resend results" → re-emails the most recent league game.
exports.resendLatestResults = onCall(
  {
    region: REGION,
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, GEMINI_API_KEY],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in as admin.');
    }
    const game = await getMostRecentLeagueGame();
    if (!game) {
      throw new HttpsError('not-found', 'No league games found in the database.');
    }
    try {
      const result = await sendResultsForGame(game);
      if (result.skipped) {
        return { ok: false, skipped: true, reason: result.reason, gameId: game.id };
      }
      return { ok: true, gameId: game.id, sent: result.sent };
    } catch (err) {
      logger.error('resendLatestResults failed:', err);
      throw new HttpsError('internal', err.message || 'Email send failed.');
    }
  }
);

// Callable: admin tool. Renames a season's document ID + name + cascades to
// all of its games. Useful when historical seasons were stored under the wrong
// ID (e.g. "2026-r2" when the data is actually Round 1).
//
// Input: { oldSeasonId, newSeasonId, newName? }
// Output: { ok, migratedGameCount, oldSeasonId, newSeasonId }
//
// Atomicity: uses a Firestore batch (max 500 writes). Each game costs 2 writes
// (create new + delete old), plus 2 for the season — caps at ~248 games which
// is fine forever for this league.
exports.migrateSeason = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in as admin.');
    }
    const { oldSeasonId, newSeasonId, newName } = request.data || {};
    if (!oldSeasonId || !newSeasonId) {
      throw new HttpsError('invalid-argument', 'oldSeasonId and newSeasonId are both required.');
    }
    if (oldSeasonId === newSeasonId && !newName) {
      throw new HttpsError('invalid-argument', 'No change requested.');
    }

    // Fetch source season
    const oldSnap = await db.doc(`seasons/${oldSeasonId}`).get();
    if (!oldSnap.exists) {
      throw new HttpsError('not-found', `Season ${oldSeasonId} does not exist.`);
    }
    const oldData = oldSnap.data();

    // Block accidental overwrite if a different doc already lives at newSeasonId
    if (oldSeasonId !== newSeasonId) {
      const collide = await db.doc(`seasons/${newSeasonId}`).get();
      if (collide.exists) {
        throw new HttpsError('already-exists',
          `Season ${newSeasonId} already exists. Pick a different new ID, or delete the existing one first.`);
      }
    }

    // Fetch all games attached to the old season
    const gamesSnap = await db.collection('games').where('seasonId', '==', oldSeasonId).get();

    // If renaming the doc itself (id changes), we also have to rewrite each
    // game's id (e.g. "2026-r2-g3" → "2026-r1-g3") so the deterministic
    // "saveGame" path in the client doesn't collide later.
    const idChanging = oldSeasonId !== newSeasonId;

    const batch = db.batch();

    // 1) Write the new season doc (only if id is changing OR name is changing)
    const newSeasonRef = db.doc(`seasons/${newSeasonId}`);
    batch.set(newSeasonRef, {
      ...oldData,
      ...(newName ? { name: newName } : {}),
    });

    // 2) For each game: copy to new doc id, update seasonId field, delete old
    const renamedGames = [];
    gamesSnap.docs.forEach((d) => {
      const g = d.data();
      const oldGameId = d.id;
      const newGameId = idChanging
        ? oldGameId.replace(new RegExp(`^${oldSeasonId}-`), `${newSeasonId}-`)
        : oldGameId;
      const newGameData = { ...g, seasonId: newSeasonId };
      if (idChanging) {
        batch.set(db.doc(`games/${newGameId}`), newGameData);
        batch.delete(db.doc(`games/${oldGameId}`));
        renamedGames.push({ from: oldGameId, to: newGameId });
      } else {
        // Same id, just update the seasonId field (a no-op write — kept for clarity)
        batch.set(db.doc(`games/${oldGameId}`), newGameData);
      }
    });

    // 3) Delete the old season doc if the id changed
    if (idChanging) batch.delete(db.doc(`seasons/${oldSeasonId}`));

    await batch.commit();

    logger.info(
      `migrateSeason: ${oldSeasonId} → ${newSeasonId}${newName ? ` ("${newName}")` : ''}; ` +
      `migrated ${gamesSnap.size} games.`
    );

    return {
      ok: true,
      oldSeasonId,
      newSeasonId,
      newName: newName || oldData.name,
      migratedGameCount: gamesSnap.size,
      renamedGames,
    };
  }
);

// ============================================================================
// Admin tooling — wipe + simulate
// ============================================================================
//
// `wipeHighRollers`  — delete every game with type === 'highrollers'.
// `wipeSimData`      — delete every game and season whose id begins with `sim-`.
// `simulateGames`    — generate 4 sandbox seasons, 20 league games + 20 HR games,
//                      using real player IDs and points/payout rules from CLAUDE.md.
//                      Skill-weighted so Cactus / Duck / Chicken / River Dan
//                      tend to finish higher.
//
// All three require an authenticated caller.

// Helper: batched delete (max 500 docs per Firestore batch).
async function batchDelete(refs) {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 450) {
    const slice = refs.slice(i, i + 450);
    const batch = db.batch();
    slice.forEach((r) => batch.delete(r));
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

exports.wipeHighRollers = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in as admin.');
    }
    const snap = await db.collection('games').where('type', '==', 'highrollers').get();
    const deleted = await batchDelete(snap.docs.map((d) => d.ref));
    logger.info(`wipeHighRollers: removed ${deleted} HR games.`);
    return { ok: true, deleted };
  }
);

exports.wipeSimData = onCall(
  { region: REGION },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in as admin.');
    }
    // Firestore doesn't support "id starts with" queries directly. Two scans:
    const [gamesSnap, seasonsSnap] = await Promise.all([
      db.collection('games').get(),
      db.collection('seasons').get(),
    ]);
    const simGames = gamesSnap.docs.filter((d) => d.id.startsWith('sim-'));
    const simSeasons = seasonsSnap.docs.filter((d) => d.id.startsWith('sim-'));
    const delG = await batchDelete(simGames.map((d) => d.ref));
    const delS = await batchDelete(simSeasons.map((d) => d.ref));
    logger.info(`wipeSimData: removed ${delG} games + ${delS} seasons.`);
    return { ok: true, deletedGames: delG, deletedSeasons: delS };
  }
);

exports.simulateGames = onCall(
  { region: REGION, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in as admin.');
    }

    // ----- Player roster (real IDs from CLAUDE.md) + skill weights -----
    // Higher weight = more likely to finish high. Tuned roughly to your
    // sense of who tends to do well.
    const PLAYERS = [
      { id: 'cactus', skill: 5, birthday: { month: 6, day: 11 } },
      { id: 'duck', skill: 4, birthday: { month: 1, day: 16 } },
      { id: 'chicken', skill: 4, birthday: { month: 10, day: 30 } },
      { id: 'river-dan', skill: 4, birthday: { month: 7, day: 21 } },
      { id: 'ostrich', skill: 3, birthday: { month: 2, day: 20 } },
      { id: 'quads', skill: 3, birthday: { month: 5, day: 29 } },
      { id: 'chit-chat', skill: 3, birthday: { month: 5, day: 6 } },
      { id: 'beans', skill: 3, birthday: { month: 4, day: 26 } },
      { id: 'the-boxer', skill: 3, birthday: { month: 11, day: 18 } },
      { id: 'hair', skill: 2, birthday: { month: 8, day: 12 } },
      { id: 'shoes', skill: 2, birthday: { month: 5, day: 18 } },
      { id: 'the-dentist', skill: 2, birthday: { month: 10, day: 4 } },
      { id: 'toby', skill: 2, birthday: { month: 10, day: 6 } },
      { id: 'pth', skill: 2, birthday: { month: 10, day: 7 } },
      { id: 'fire-truck-john', skill: 2, birthday: { month: 8, day: 29 } },
      { id: 'anthony-boden', skill: 2, birthday: { month: 11, day: 2 } },
      { id: 'tinker-bell', skill: 2, birthday: { month: 6, day: 27 } },
      { id: 'graham-barlow', skill: 1, birthday: { month: 10, day: 11 } },
      { id: 'moth', skill: 1, birthday: { month: 5, day: 19 } },
      { id: 'the-agent', skill: 1, birthday: { month: 10, day: 27 } },
      { id: 'dom', skill: 1, birthday: { month: 3, day: 14 } },
      { id: 'jay-gohil', skill: 1, birthday: { month: 12, day: 4 } },
      { id: 'simon-wilkins', skill: 1, birthday: { month: 12, day: 11 } },
      { id: 'santa', skill: 1, birthday: { month: 12, day: 30 } },
      { id: 'michael-barnes', skill: 1, birthday: { month: 4, day: 22 } },
      { id: 'oli-elsaesser', skill: 1, birthday: { month: 7, day: 15 } },
      { id: 'sam-maffia', skill: 1, birthday: { month: 9, day: 16 } },
      { id: 'jimmy', skill: 1, birthday: { month: 1, day: 24 } },
      { id: 'david', skill: 1 },
      { id: 'stephen', skill: 1 },
      { id: 'kelvin-the-detective', skill: 1 },
      { id: 'ben-conolly', skill: 1 },
    ];
    const HR_REGULARS = ['cactus', 'beans', 'quads', 'chit-chat', 'duck', 'ostrich', 'shoes', 'the-boxer', 'river-dan'];

    // ----- Helpers -----
    const rand = (n) => Math.floor(Math.random() * n);
    const pick = (arr, k) => {
      const c = [...arr];
      const out = [];
      for (let i = 0; i < k && c.length > 0; i++) {
        out.push(c.splice(rand(c.length), 1)[0]);
      }
      return out;
    };
    const skillSort = (attendees) => {
      // Each player's "draw" = skill × random in [0.5, 1.5). Sort desc.
      const playerById = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
      return [...attendees].sort((a, b) => {
        const sa = (playerById[a]?.skill || 1) * (0.5 + Math.random());
        const sb = (playerById[b]?.skill || 1) * (0.5 + Math.random());
        return sb - sa;
      });
    };
    const bountiedMonthFor = (birthMonth) => {
      // June birthdays bountied in May; December bountied in November (per CLAUDE.md)
      if (birthMonth === 6) return 5;
      if (birthMonth === 12) return 11;
      return birthMonth;
    };
    const computePayouts = (prizePool, paidCount = 3) => {
      // Same 50/30/20 splits used in real games for ≤10 players, rounded to £10
      const SPLITS = paidCount === 3 ? [0.50, 0.30, 0.20] : [0.45, 0.25, 0.18, 0.12];
      const raw = SPLITS.map((s) => Math.round((prizePool * s) / 10) * 10);
      // Absorb rounding remainder onto 1st place
      const sum = raw.reduce((a, b) => a + b, 0);
      raw[0] += prizePool - sum;
      const out = {};
      raw.forEach((v, i) => { if (v > 0) out[String(i + 1)] = v; });
      return out;
    };
    const computePoints = ({ attendees, finishOrder, bountiedIds, isFinal }) => {
      if (isFinal) return {};
      const pts = {};
      attendees.forEach((pid) => { pts[pid] = 2000; });
      const bonuses = [8000, 5000, 3000, 1000, 500];
      bonuses.forEach((b, i) => {
        const pid = finishOrder[i];
        if (pid && pts[pid] !== undefined) pts[pid] += b;
      });
      bountiedIds.forEach((pid) => {
        if (pts[pid] !== undefined) pts[pid] += 2000;
      });
      return pts;
    };

    // ----- Sandbox seasons (4 of them) -----
    const SEASONS = [
      { id: 'sim-2024-r1', name: '2024 — Round 1 (SIM)', startDate: '2024-01-01', endDate: '2024-06-30', gamesPerMonth: 1, months: [1,2,3,4,5,6] },
      { id: 'sim-2024-r2', name: '2024 — Round 2 (SIM)', startDate: '2024-07-01', endDate: '2024-12-31', gamesPerMonth: 1, months: [7,8,9,10,11,12] },
      { id: 'sim-2025-r1', name: '2025 — Round 1 (SIM)', startDate: '2025-01-01', endDate: '2025-06-30', gamesPerMonth: 1, months: [1,2,3,4,5,6] },
      { id: 'sim-2025-r2', name: '2025 — Round 2 (SIM)', startDate: '2025-07-01', endDate: '2025-12-31', gamesPerMonth: 1, months: [7,8] }, // partial — only 2 games
    ];

    const batch = db.batch();
    const writes = { seasons: 0, leagueGames: 0, hrGames: 0 };

    // Birthday lookup for bounty logic
    const playerById = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));

    // ----- Build league games -----
    for (const season of SEASONS) {
      const totalGames = season.months.length;
      batch.set(db.doc(`seasons/${season.id}`), {
        name: season.name,
        startDate: season.startDate,
        endDate: season.endDate,
        totalGames,
        finalGameIndex: totalGames,
        status: 'complete',
      });
      writes.seasons += 1;

      // Carry-forward bounty bag (people whose birth month has come up but
      // who haven't attended yet this round — kept simple).
      const pendingBounties = new Set();

      for (let i = 0; i < season.months.length; i++) {
        const month = season.months[i];
        const isFinal = i === season.months.length - 1 && season.id !== 'sim-2025-r2';
        const day = 8 + rand(20); // somewhere mid-month
        const yyyy = season.startDate.slice(0, 4);
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        const gameId = `${season.id}-g${i + 1}`;

        // 9 attendees, skill-weighted-random subset
        const attendees = pick(PLAYERS.map((p) => p.id), 9);
        const finishOrder = skillSort(attendees);

        // Apply bounty: players whose bountied month is THIS month, plus any carry-fwd, who attended
        const playerBountyMonth = new Set();
        PLAYERS.forEach((p) => {
          if (p.birthday && bountiedMonthFor(p.birthday.month) === month) {
            playerBountyMonth.add(p.id);
          }
        });
        // Add pending carry-forwards
        pendingBounties.forEach((pid) => playerBountyMonth.add(pid));
        // Bountied players who attend
        const bountiedAttendees = attendees.filter((pid) => playerBountyMonth.has(pid));
        // Players from the eligible pool who didn't attend → carry forward
        playerBountyMonth.forEach((pid) => {
          if (!attendees.includes(pid)) pendingBounties.add(pid);
          else pendingBounties.delete(pid);
        });

        const totalRebuys = isFinal ? 0 : rand(11);
        const buyIn = 30;
        const pot = (attendees.length + totalRebuys) * buyIn;
        const subs = 3 * attendees.length;
        const leagueMoney = isFinal ? 0 : Math.round((pot * 0.1) / 10) * 10;
        const prizePool = pot - subs - leagueMoney;
        const payouts = computePayouts(prizePool, 3);
        const pointsAwarded = computePoints({ attendees, finishOrder, bountiedIds: bountiedAttendees, isFinal });

        // Random per-player rebuys assignment (just spread totalRebuys randomly)
        const rebuys = {};
        let left = totalRebuys;
        while (left > 0) {
          const pid = attendees[rand(attendees.length)];
          rebuys[pid] = (rebuys[pid] || 0) + 1;
          left -= 1;
        }

        batch.set(db.doc(`games/${gameId}`), {
          type: 'league',
          seasonId: season.id,
          date: `${yyyy}-${mm}-${dd}`,
          gameNumber: i + 1,
          isFinal,
          buyIn,
          attendees,
          rebuys,
          totalRebuys,
          finishOrder,
          pot,
          payouts,
          leagueMoney,
          prizePool,
          subs,
          pointsAwarded,
          bountyHolders: bountiedAttendees,
          bountyClaims: [],
          notes: 'Generated by simulateGames (sandbox data).',
        });
        writes.leagueGames += 1;
      }
    }

    // ----- Build 20 HR games -----
    // Spread bi-weekly across the last 10 months.
    const now = new Date();
    const hrCount = 20;
    for (let i = 0; i < hrCount; i++) {
      const offsetDays = 14 * (hrCount - i); // older games further back
      const d = new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);
      const date = d.toISOString().slice(0, 10);
      const gameId = `sim-hr-${date}`;

      const nPlayers = 3 + rand(3); // 3-5 players
      const attendees = pick(HR_REGULARS, nPlayers);
      const finishOrder = skillSort(attendees);
      const buyIn = 40;
      const totalRebuys = rand(6);
      const pot = (attendees.length + totalRebuys) * buyIn;
      const payouts = computePayouts(pot, Math.min(3, nPlayers));
      const rebuys = {};
      let left = totalRebuys;
      while (left > 0) {
        const pid = attendees[rand(attendees.length)];
        rebuys[pid] = (rebuys[pid] || 0) + 1;
        left -= 1;
      }

      batch.set(db.doc(`games/${gameId}`), {
        type: 'highrollers',
        seasonId: null,
        date,
        gameNumber: null,
        isFinal: false,
        buyIn,
        attendees,
        rebuys,
        totalRebuys,
        finishOrder,
        pot,
        payouts,
        leagueMoney: 0,
        prizePool: pot,
        subs: 0,
        pointsAwarded: {},
        bountyHolders: [],
        bountyClaims: [],
        notes: 'Generated by simulateGames (sandbox data).',
      });
      writes.hrGames += 1;
    }

    await batch.commit();
    logger.info(`simulateGames wrote ${writes.seasons} seasons + ${writes.leagueGames} league games + ${writes.hrGames} HR games.`);
    return { ok: true, ...writes };
  }
);
