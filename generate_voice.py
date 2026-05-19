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
  Creates ./sounds/voice/*.mp3 — one file per phrase. About 104 files,
  ~5MB total. Takes ~3-5 minutes to generate.
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

# 32 players from the GR Poker roster
PLAYERS = [
    "Cactus", "Chicken", "Duck", "Ostrich", "River Dan", "Quads",
    "Beans", "The Boxer", "Chit Chat", "Hair", "Shoes", "Moth",
    "Toby", "Fire Truck John", "David", "Graham Barlow",
    "The Dentist", "Dom", "The Agent", "Anthony Boden", "PTH",
    "Jay Gohil", "Simon Wilkins", "Santa", "Stephen",
    "Kelvin The Detective", "Ben Conolly", "Tinker-Bell",
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


def slugify(name):
    """Make a filename-safe slug from a player name."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def generate(text, filename):
    """Call ElevenLabs API and save MP3 to disk."""
    path = OUT / f"{filename}.mp3"
    if path.exists():
        print(f"  ✓ skip (exists): {path}")
        return

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    body = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.3,
            "use_speaker_boost": True,
        },
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

    # Per-player elimination phrases
    print("\n=== Eliminations (Goodbye, X) ===")
    for name in PLAYERS:
        generate(f"Goodbye, {name}.", f"goodbye-{slugify(name)}")
        time.sleep(0.5)

    # Per-player winner announcement
    print("\n=== Winner announcements ===")
    for name in PLAYERS:
        generate(f"And the winner is... {name}!", f"winner-{slugify(name)}")
        time.sleep(0.5)

    # Per-player congratulations
    print("\n=== Congratulations ===")
    for name in PLAYERS:
        generate(f"Congratulations, {name}!", f"congrats-{slugify(name)}")
        time.sleep(0.5)

    print(f"\n✅ Done. Files in {OUT.absolute()}/")
    print(f"   Commit them to your repo, then I'll wire the app to use them.")


if __name__ == "__main__":
    main()
