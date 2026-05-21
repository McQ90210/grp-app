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
