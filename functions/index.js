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
// Returns: [{ pid, displayName, total, gamesPlayed }, ...]
function computeStandings(games, players) {
  const totals = {};
  const playedCount = {};
  games.forEach((g) => {
    Object.entries(g.pointsAwarded || {}).forEach(([pid, pts]) => {
      totals[pid] = (totals[pid] || 0) + (pts || 0);
      if (pts > 0) playedCount[pid] = (playedCount[pid] || 0) + 1;
    });
  });
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  return Object.entries(totals)
    .filter(([, t]) => t > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([pid, total]) => ({
      pid,
      displayName: playersById[pid]?.displayName || pid,
      total,
      gamesPlayed: playedCount[pid] || 0,
    }));
}

// ============================================================================
// Email rendering (inline-styled HTML for email-client safety)
// ============================================================================

// Brand colours (kept in sync with the app's .gold-text gradient and CLAUDE.md).
const BRAND_GREEN = '#14a37b';
const BRAND_GREEN_LIGHT = '#1ec890';
const BG_DARK = '#062815';
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

function renderResultsEmail({ game, season, standings, players }) {
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
  const finishOrder = (game.finishOrder || []).map((pid) => ({
    pid,
    name: playersById[pid]?.displayName || pid,
  }));

  // Podium rows (top 3 with payouts).
  const podium = [1, 2, 3].map((place) => {
    const f = finishOrder[place - 1];
    const payout = game.payouts?.[String(place)] || 0;
    return f
      ? `<tr>
           <td style="padding:8px 12px;font-size:18px;">${['🥇', '🥈', '🥉'][place - 1]}</td>
           <td style="padding:8px 12px;color:${TEXT_LIGHT};font-weight:600;">${escape(f.name)}</td>
           <td style="padding:8px 12px;color:${BRAND_GREEN_LIGHT};text-align:right;font-family:monospace;">£${payout}</td>
         </tr>`
      : '';
  }).join('');

  // Standings rows.
  const standingsRows = standings
    .map((row, i) => {
      const rankColours = ['#f4d03f', '#d4d4d4', '#d4924a'];
      const rankColour = rankColours[i] || TEXT_LIGHT;
      return `<tr>
        <td style="padding:6px 10px;color:${rankColour};font-weight:700;font-family:monospace;">${i + 1}</td>
        <td style="padding:6px 10px;color:${TEXT_LIGHT};">${escape(row.displayName)}</td>
        <td style="padding:6px 10px;color:${BRAND_GREEN_LIGHT};text-align:right;font-family:monospace;font-weight:600;">${row.total.toLocaleString()}</td>
        <td style="padding:6px 10px;color:#9ca3af;text-align:right;font-family:monospace;">${row.gamesPlayed}</td>
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
<head><meta charset="utf-8"><title>GR Poker results</title></head>
<body style="margin:0;padding:0;background:${BG_DARK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;background:${BG_DARK};color:${TEXT_LIGHT};">

    <h1 style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:${BRAND_GREEN_LIGHT};letter-spacing:0.05em;font-size:28px;margin:0 0 4px;text-transform:uppercase;">GR Poker</h1>
    <div style="color:${BRAND_GREEN};font-size:13px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:24px;">
      ${escape(season.name)} · Game ${game.gameNumber}${isFinal ? ' · FINAL' : ''} · ${escape(game.date)}
    </div>

    <h2 style="color:${BRAND_GREEN_LIGHT};font-size:20px;margin:0 0 12px;border-bottom:1px solid rgba(20,163,123,0.3);padding-bottom:8px;">Last night's podium</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;background:rgba(0,0,0,0.3);border-radius:8px;">
      ${podium || `<tr><td style="padding:12px;color:#9ca3af;">No results recorded.</td></tr>`}
    </table>

    <div style="color:#9ca3af;font-size:13px;font-family:monospace;margin-bottom:24px;">
      ${attendeeCount} players · ${rebuys} rebuys · £${pot} pot · £${leagueMoney} to league · £${subs} subs
    </div>

    ${
      isFinal
        ? `<div style="background:rgba(244,208,63,0.1);border:1px solid rgba(244,208,63,0.3);border-radius:8px;padding:12px;margin-bottom:24px;color:#fcd34d;font-size:13px;">
            Final game — no league points awarded. The standings below are the season-end totals.
          </div>`
        : ''
    }

    <h2 style="color:${BRAND_GREEN_LIGHT};font-size:20px;margin:0 0 12px;border-bottom:1px solid rgba(20,163,123,0.3);padding-bottom:8px;">Updated standings</h2>
    <table style="width:100%;border-collapse:collapse;background:rgba(0,0,0,0.3);border-radius:8px;">
      <thead>
        <tr style="background:rgba(20,163,123,0.15);">
          <th style="padding:8px 10px;text-align:left;color:${BRAND_GREEN};font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">#</th>
          <th style="padding:8px 10px;text-align:left;color:${BRAND_GREEN};font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Player</th>
          <th style="padding:8px 10px;text-align:right;color:${BRAND_GREEN};font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Points</th>
          <th style="padding:8px 10px;text-align:right;color:${BRAND_GREEN};font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">Played</th>
        </tr>
      </thead>
      <tbody>${standingsRows}</tbody>
    </table>

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid rgba(20,163,123,0.2);color:#6b7280;font-size:12px;text-align:center;">
      Greene Room Poker · Berkhamsted<br>
      <a href="https://mcq90210.github.io/grp-app/" style="color:${BRAND_GREEN_LIGHT};text-decoration:none;">View full league standings →</a>
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

  const standings = computeStandings(seasonGames, players);
  const html = renderResultsEmail({ game, season, standings, players });

  const user = GMAIL_USER.value();
  const pass = GMAIL_APP_PASSWORD.value();
  if (!user || !pass) {
    throw new Error('Gmail secrets are not configured (GMAIL_USER / GMAIL_APP_PASSWORD).');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const subject = `GR Poker — ${season.name} Game ${game.gameNumber}${
    game.isFinal ? ' FINAL' : ''
  } results`;

  await transporter.sendMail({
    from: `"GR Poker League" <${user}>`,
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
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD],
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
    secrets: [GMAIL_USER, GMAIL_APP_PASSWORD],
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
