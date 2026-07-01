// Firebase init for GR Poker.
// Exposes window.GRP_FIREBASE with Firestore + Auth, plus high-level helpers in window.GRP_DB.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getFunctions, httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-functions.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBMaR3kHYp1zqLyYE4Pra6jnKtRQkPxH9Y",
  authDomain: "gr-poker.firebaseapp.com",
  projectId: "gr-poker",
  storageBucket: "gr-poker.firebasestorage.app",
  messagingSenderId: "7361762424",
  appId: "1:7361762424:web:55b77c83122b418896498d",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// Cloud Functions live in europe-west2 (same region as Firestore — see CLAUDE.md).
const functions = getFunctions(app, 'europe-west2');
// Firebase Storage — used for per-player custom elimination sounds uploaded
// from the Manage Players modal. Bucket lives at sounds/players/{pid}.mp3.
// Public read, admin write (see storage.rules).
const storage = getStorage(app);

window.GRP_FIREBASE = {
  app, db, auth, functions,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  httpsCallable,
};

// ================== DATA LAYER ==================
// High-level functions for common operations. All async.

// ------ PLAYERS ------
async function getAllPlayers() {
  const snap = await getDocs(collection(db, 'players'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getPlayer(id) {
  const snap = await getDoc(doc(db, 'players', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function upsertPlayer(player) {
  // player: { id?, displayName, realName?, birthday?, sound?, notes? }
  const id = player.id || player.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const data = { ...player };
  delete data.id;
  await setDoc(doc(db, 'players', id), data, { merge: true });
  return id;
}

function subscribeToPlayers(callback) {
  return onSnapshot(collection(db, 'players'), (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ------ SEASONS ------
async function getAllSeasons() {
  const snap = await getDocs(query(collection(db, 'seasons'), orderBy('startDate', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getActiveSeason() {
  const snap = await getDocs(query(collection(db, 'seasons'), where('status', '==', 'active'), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function upsertSeason(season) {
  const id = season.id;
  const data = { ...season };
  delete data.id;
  await setDoc(doc(db, 'seasons', id), data, { merge: true });
  return id;
}

// ------ GAMES ------
async function getGamesForSeason(seasonId) {
  const snap = await getDocs(query(
    collection(db, 'games'),
    where('seasonId', '==', seasonId),
    orderBy('gameNumber', 'asc')
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// All league games across all seasons. Sorted by date asc. No composite
// index needed — we filter on a single field (`type`) and sort client-side.
async function getAllLeagueGames() {
  const snap = await getDocs(query(collection(db, 'games'), where('type', '==', 'league')));
  const games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  games.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return games;
}

async function getAllHighRollerGames() {
  const snap = await getDocs(query(
    collection(db, 'games'),
    where('type', '==', 'highrollers'),
    orderBy('date', 'desc')
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getGameById(id) {
  const snap = await getDoc(doc(db, 'games', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

async function saveGame(game) {
  // game: full game record
  if (game.id) {
    const id = game.id;
    const data = { ...game };
    delete data.id;
    await setDoc(doc(db, 'games', id), data, { merge: true });
    return id;
  } else {
    const ref = await addDoc(collection(db, 'games'), game);
    return ref.id;
  }
}

async function deleteGame(id) {
  await deleteDoc(doc(db, 'games', id));
}

function subscribeToSeasonGames(seasonId, callback) {
  const q = query(
    collection(db, 'games'),
    where('seasonId', '==', seasonId),
    orderBy('gameNumber', 'asc')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ------ BULK / ADMIN ------
async function bulkImport({ players, seasons, games }) {
  const batch = writeBatch(db);
  for (const p of players || []) {
    const id = p.id || p.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const data = { ...p };
    delete data.id;
    batch.set(doc(db, 'players', id), data);
  }
  for (const s of seasons || []) {
    const id = s.id;
    const data = { ...s };
    delete data.id;
    batch.set(doc(db, 'seasons', id), data);
  }
  for (const g of games || []) {
    const id = g.id || `g-${Math.random().toString(36).slice(2, 10)}`;
    const data = { ...g };
    delete data.id;
    batch.set(doc(db, 'games', id), data);
  }
  await batch.commit();
}

// ------ LIVE GAME (in-progress tournament state) ------
// A single live game at a time, stored at liveGames/current. Holds the full
// timer state so the tournament can survive a refresh / crash / device swap.
// Cleared via clearLiveGame() once the game is saved to the games collection.
async function saveLiveGame(state) {
  const data = { ...state, savedAt: serverTimestamp() };
  await setDoc(doc(db, 'liveGames', 'current'), data);
}
async function getLiveGame() {
  const snap = await getDoc(doc(db, 'liveGames', 'current'));
  if (!snap.exists()) return null;
  return { ...snap.data() };
}
async function clearLiveGame() {
  try { await deleteDoc(doc(db, 'liveGames', 'current')); } catch (e) {}
}

// ------ PLAYER SOUND UPLOAD (Firebase Storage) ------
// Uploads an audio file for a player. Stores it at sounds/players/{pid}.{ext}
// (extension inferred from the file), retrieves the public download URL,
// and stamps it on the player doc as `customSoundUrl`. Returns the URL.
// Requires admin auth (Storage rules gate write).
async function uploadPlayerSound(pid, file) {
  if (!pid || !file) throw new Error('uploadPlayerSound: pid and file are required.');
  const nameParts = (file.name || '').split('.');
  const ext = (nameParts.length > 1 ? nameParts.pop() : 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
  const path = `sounds/players/${pid}.${ext}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type || `audio/${ext}` });
  const url = await getDownloadURL(ref);
  await setDoc(
    doc(db, 'players', pid),
    { customSoundUrl: url, customSoundPath: path },
    { merge: true }
  );
  return url;
}

// Removes a player's custom sound: deletes the Storage object (best-effort;
// non-fatal if it's already gone) and clears the fields on the player doc.
async function removePlayerSound(pid) {
  if (!pid) throw new Error('removePlayerSound: pid is required.');
  const snap = await getDoc(doc(db, 'players', pid));
  const path = snap.exists() ? snap.data().customSoundPath : null;
  if (path) {
    try { await deleteObject(storageRef(storage, path)); } catch (_) { /* already gone */ }
  }
  await setDoc(
    doc(db, 'players', pid),
    { customSoundUrl: null, customSoundPath: null },
    { merge: true }
  );
}

// ------ EMAIL / CLOUD FUNCTIONS ------
// Calls the `resendLatestResults` Cloud Function. Returns { ok, gameId, sent }
// or throws. Requires the caller to be authenticated.
async function resendLatestResults() {
  const fn = httpsCallable(functions, 'resendLatestResults');
  const res = await fn({});
  return res.data;
}

// Same as resendLatestResults, but for the most recent High Rollers game.
async function resendLatestHRResults() {
  const fn = httpsCallable(functions, 'resendLatestHRResults');
  const res = await fn({});
  return res.data;
}

// Admin: rename a season's id + name and migrate all of its games to match.
// Useful when a season was stored under the wrong id (e.g. "2026-r2" when the
// data really belongs to Round 1). Returns { ok, migratedGameCount, ... }
async function migrateSeason({ oldSeasonId, newSeasonId, newName }) {
  const fn = httpsCallable(functions, 'migrateSeason');
  const res = await fn({ oldSeasonId, newSeasonId, newName });
  return res.data;
}

// Admin: destructive / sandbox tools. The HR wipe was test-data cleanup
// only — removed once we had real games. The sim helpers are unused by
// any current UI but kept as break-glass.
async function wipeSimData() {
  const res = await httpsCallable(functions, 'wipeSimData')({});
  return res.data;
}
async function simulateGames() {
  const res = await httpsCallable(functions, 'simulateGames')({});
  return res.data;
}

window.GRP_DB = {
  // Players
  getAllPlayers, getPlayer, upsertPlayer, subscribeToPlayers,
  uploadPlayerSound, removePlayerSound,
  // Seasons
  getAllSeasons, getActiveSeason, upsertSeason,
  // Games
  getGamesForSeason, getAllLeagueGames, getAllHighRollerGames, getGameById, saveGame, deleteGame, subscribeToSeasonGames,
  // Live (in-progress) game persistence
  saveLiveGame, getLiveGame, clearLiveGame,
  // Email
  resendLatestResults, resendLatestHRResults,
  // Admin
  bulkImport, migrateSeason, wipeSimData, simulateGames,
};

window.dispatchEvent(new CustomEvent('firebase-ready'));
