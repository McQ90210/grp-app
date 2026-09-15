#!/usr/bin/env python3
"""
GR Poker — ElevenLabs voice generator

Generates all the audio files used by the GR Poker PWA, using your
ElevenLabs account. Run once; commit the output to /sounds/voice/ in
the repo and the app will use them instead of the browser's voice.

PREREQ:
  pip install requests
  export ELEVENLABS_API_KEY="sk_..."
  export ELEVENLABS_VOICE_ID="..."   # see "Picking a voice" below

PICKING A VOICE:
  Go to https://elevenlabs.io/app/voice-library
  Pick a voice you like (try "Adam", "Antoni", "Bill", or "Rachel"
  for a US accent; "Charlie" or "Dave" for British). Click it →
  "Voice ID" is shown in the right panel. Copy that ID.

RUN:
  python3 generate_voice.py

OUTPUT:
  Creates ./sounds/voice/*.mp3 — one file per phrase. About 149 files,
  ~7MB total. Takes ~5-7 minutes to generate.
"""

import os
import sys
import json
import re
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("Run: pip install requests")
    sys.exit(1)

API_KEY = os.environ.get("ELEVENLABS_API_KEY")
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID")

if not API_KEY or not VOICE_ID:
    print("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID env vars first.")
    print("See top of script for how to pick a voice ID.")
    sys.exit(1)

# Model — eleven_turbo_v2_5 is fast and high quality. eleven_multilingual_v2
# is the highest quality but a bit slower. Choose:
MODEL = "eleven_turbo_v2_5"

# Output folder
OUT = Path("sounds/voice")
OUT.mkdir(parents=True, exist_ok=True)

# 32 players from the GR Poker roster. Names here must match Firestore
# displayName exactly — the app looks up clips via
# slugifyName(player.name), not by any stored player ID (which doesn't
# change on a rename, e.g. Mr Toby's doc ID is still "toby").
PLAYERS = [
    "Cactus", "Chicken", "Duck", "Ostrich", "River Dan", "Quads",
    "Beans", "The Boxer", "Chit Chat", "Hair", "Shoes", "Moth",
    "Mr Toby", "Fire Truck John", "David", "Graham Barlow",
    "The Dentist", "Dom", "The Agent", "Anthony Boden", "PTH",
    "Jay Gohil", "Simon Wilkins", "Santa", "Stephen",
    "Kelvin The Detective", "Ben", "Ben Conolly", "Tinker-Bell",
    "Michael Barnes", "Oli Elsaesser", "Sam Maffia", "Jimmy",
]

# Static phrases — phrases that don't depend on a player name
STATIC = {
    "break-5":    "Break time. Five minute break. Stretch your legs.",
    "break-10":   "Break time. Ten minute break. Stretch your legs.",
    "break-15":   "Break time. Fifteen minute break. Stretch your legs.",
    "five-min":   "Five minutes remaining in this round.",
    "one-min":    "One minute remaining.",
    "final-3":    "We are down to the final three!",
    "complete":   "Tournament complete. Well played.",
    "voice-ready":"Voice ready.",
}

# Seat draw — played in sequence via speakClipQueue, e.g. table-1,
# seat-1, dealer, name-beans for "Table 1, Seat 1, dealer... Beans."
# Generated with EXCITED_SETTINGS (see generate()) for a punchier,
# more game-show read than the flatter default phrases above.
STATIC_SEAT_DRAW = {
    "table-1":    "Table 1.",
    "table-2":    "Table 2.",
    "table-3":    "Table 3.",
    "seat-1":     "Seat 1.",
    "seat-2":     "Seat 2.",
    "seat-3":     "Seat 3.",
    "seat-4":     "Seat 4.",
    "seat-5":     "Seat 5.",
    "seat-6":     "Seat 6.",
    "seat-7":     "Seat 7.",
    "seat-8":     "Seat 8.",
    "seat-9":     "Seat 9.",
    "dealer":     "Dealer...",
}


def slugify(name):
    """Make a filename-safe slug from a player name."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


# Mr Toby gets his own voice on every clip that says his name.
TOBY_VOICE_ID = "9lHjugDhwqoxA5MhX0az"


def is_toby(name):
    return name == "Mr Toby"


def voice_id_for(name):
    return TOBY_VOICE_ID if is_toby(name) else VOICE_ID


# Mr Toby's voice needs its own settings regardless of category — a low
# "style" value (what DEFAULT_SETTINGS and EXCITED_SETTINGS both use,
# tuned for Adam) mutes how much of a voice's own natural character
# comes through, which is why his clips sounded like a flattened
# version of what ElevenLabs' own preview plays. Style pushed near max
# and stability dropped to let the accent come through consistently.
def voice_settings_for(name, base_settings):
    if not is_toby(name):
        return base_settings
    return {
        "stability": 0.2,
        "similarity_boost": 0.75,
        "style": 1.0,
        "use_speaker_boost": True,
    }


# Default delivery — used for everything except the seat draw (see
# EXCITED_SETTINGS below). Lower stability + higher style = more
# expressive/varied delivery; this is the flatter, more consistent end
# of that range, which is what the original 104 clips were built with.
DEFAULT_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.3,
    "use_speaker_boost": True,
}

# More energetic read for the seat draw's live-reveal phrases (table /
# seat / dealer / bare names) — lower stability and higher style push
# the same voice toward a punchier, more excited delivery rather than
# the flatter read used for the original static/per-player phrases.
EXCITED_SETTINGS = {
    "stability": 0.35,
    "similarity_boost": 0.75,
    "style": 0.65,
    "use_speaker_boost": True,
}


def generate(text, filename, voice_settings=None, voice_id=None):
    """Call ElevenLabs API and save MP3 to disk."""
    path = OUT / f"{filename}.mp3"
    if path.exists():
        print(f"  ✓ skip (exists): {path}")
        return

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id or VOICE_ID}"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    body = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": voice_settings or DEFAULT_SETTINGS,
    }
    r = requests.post(url, headers=headers, json=body, timeout=60)
    if r.status_code != 200:
        print(f"  ✗ FAILED: {filename} — HTTP {r.status_code}: {r.text[:200]}")
        return False
    path.write_bytes(r.content)
    size_kb = len(r.content) / 1024
    print(f"  ✓ {path} ({size_kb:.0f}KB)")
    return True


def main():
    print(f"Using voice ID: {VOICE_ID}")
    print(f"Output folder:  {OUT.absolute()}")
    print()

    # Static phrases
    print("=== Static phrases ===")
    for key, text in STATIC.items():
        generate(text, key)
        time.sleep(0.5)  # be nice to the API

    # Seat draw static phrases — excited delivery
    print("\n=== Seat draw (table / seat / dealer) ===")
    for key, text in STATIC_SEAT_DRAW.items():
        generate(text, key, voice_settings=EXCITED_SETTINGS)
        time.sleep(0.5)

    # Per-player elimination phrases. Mr Toby gets a fully custom line
    # instead of the template, in his own voice.
    print("\n=== Eliminations (Goodbye, X) ===")
    for name in PLAYERS:
        text = (
            "Goodbye Mr Toby, I see you very very soon. Love you long time."
            if is_toby(name) else f"Goodbye, {name}."
        )
        generate(text, f"goodbye-{slugify(name)}", voice_settings=voice_settings_for(name, DEFAULT_SETTINGS), voice_id=voice_id_for(name))
        time.sleep(0.5)

    # Per-player winner announcement
    print("\n=== Winner announcements ===")
    for name in PLAYERS:
        generate(f"And the winner is... {name}!", f"winner-{slugify(name)}", voice_settings=voice_settings_for(name, DEFAULT_SETTINGS), voice_id=voice_id_for(name))
        time.sleep(0.5)

    # Per-player congratulations
    print("\n=== Congratulations ===")
    for name in PLAYERS:
        generate(f"Congratulations, {name}!", f"congrats-{slugify(name)}", voice_settings=voice_settings_for(name, DEFAULT_SETTINGS), voice_id=voice_id_for(name))
        time.sleep(0.5)

    # Per-player rebuy announcement (app plays this on every rebuy). Not
    # previously tracked by this script — most already exist from an
    # earlier ad-hoc pass, this just fills in any gaps (Ben never had
    # one) and keeps everyone on the right voice going forward. Mr Toby
    # gets his own tag line, same running joke as his goodbye.
    print("\n=== Rebuys ===")
    for name in PLAYERS:
        text = (
            "Rebuy for Mr Toby. Love you longtime!"
            if is_toby(name) else f"Rebuy for {name}."
        )
        generate(text, f"rebuy-{slugify(name)}", voice_settings=voice_settings_for(name, DEFAULT_SETTINGS), voice_id=voice_id_for(name))
        time.sleep(0.5)

    # Per-player bare name — for the seat draw, chained after table/seat/
    # dealer clips via speakClipQueue rather than embedded in a phrase.
    # Excited delivery, matching the table/seat/dealer clips above.
    print("\n=== Bare names (seat draw) ===")
    for name in PLAYERS:
        generate(f"{name}!", f"name-{slugify(name)}", voice_settings=voice_settings_for(name, EXCITED_SETTINGS), voice_id=voice_id_for(name))
        time.sleep(0.5)

    print(f"\n✅ Done. Files in {OUT.absolute()}/")
    print(f"   Commit them to your repo, then I'll wire the app to use them.")


if __name__ == "__main__":
    main()
