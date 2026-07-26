"""A stand-in for leetcode-api-pied that invents submissions as you poll it.

Point the backend at this instead of the real API and the whole pipeline runs
for real: the polling worker fetches, the engine scores, SSE pushes, and the
board animates. Nothing is injected into the UI directly, so what you are
looking at is the production code path.

    uvicorn tools.fake_leetcode_api:app --port 9999
    LEETCODE_API_BASE=http://127.0.0.1:9999 uvicorn app.main:app --port 8080

Env:
  FAKE_SLUGS    comma-separated problem slugs to submit against
  FAKE_RATE     chance a given poll produces a new submission (0..1)
  FAKE_AVATARS  1 to hand out avatar URLs, 0 for the initials fallback
  FAKE_PROFILE_UPSTREAM
                base URL to fetch real profiles from, e.g.
                https://leetcode-api-pied.vercel.app. Submissions stay invented;
                only avatars and rankings come from upstream, so a rehearsal with
                the real roster shows the real faces. Unset = fully offline.

Turn FAKE_RATE up for a busy room (0.25 keeps the board churning), down to 0.05
if the ticker is too noisy to read.
"""

from __future__ import annotations

import os
import random
import time
from collections import defaultdict

import httpx
from fastapi import FastAPI

SLUGS = [s for s in os.environ.get("FAKE_SLUGS", "two-sum,valid-parentheses").split(",") if s]
RATE = float(os.environ.get("FAKE_RATE", "0.12"))
AVATARS = os.environ.get("FAKE_AVATARS", "0") == "1"
PROFILE_UPSTREAM = os.environ.get("FAKE_PROFILE_UPSTREAM", "").rstrip("/")

VERDICTS = (
    ("Accepted", 0.58),
    ("Wrong Answer", 0.18),
    ("Time Limit Exceeded", 0.12),
    ("Runtime Error", 0.07),
    ("Compile Error", 0.05),
)

app = FastAPI()
history: dict[str, list[dict]] = defaultdict(list)
profiles: dict[str, dict] = {}
next_id = [900_000_000]
made = [0]


def pick_verdict() -> str:
    roll = random.random()
    cumulative = 0.0
    for name, weight in VERDICTS:
        cumulative += weight
        if roll <= cumulative:
            return name
    return "Accepted"


@app.get("/health")
def health() -> dict:
    return {"ok": True, "generated": made[0], "slugs": SLUGS, "rate": RATE}


@app.get("/user/{username}")
async def profile(username: str) -> dict:
    if PROFILE_UPSTREAM:
        # Cached hard: profiles barely change, and a room full of students is
        # otherwise 50-odd upstream calls every time the backend restarts.
        if username in profiles:
            return profiles[username]
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(f"{PROFILE_UPSTREAM}/user/{username}")
            if r.status_code == 200:
                profiles[username] = r.json()
                return profiles[username]
        except Exception:
            pass  # fall through to the invented profile below

    seed = abs(hash(username))
    return {
        "username": username,
        "profile": {
            # Real LeetCode avatars are absolute URLs on their CDN; this stands
            # in for one so the portrait path gets exercised offline.
            "userAvatar": f"https://assets.leetcode.com/users/avatars/avatar_{seed % 9999}.png"
            if AVATARS
            else None,
            "ranking": 100_000 + seed % 900_000,
        },
        "submitStats": {
            "acSubmissionNum": [
                {"difficulty": "Easy", "count": seed % 180},
                {"difficulty": "Medium", "count": seed % 90},
                {"difficulty": "Hard", "count": seed % 25},
            ]
        },
    }


@app.get("/problem/{slug}")
def problem(slug: str) -> dict:
    return {"titleSlug": slug, "title": slug.replace("-", " ").title(), "questionFrontendId": "1"}


@app.get("/user/{username}/submissions")
def submissions(username: str, limit: int = 10) -> list[dict]:
    """Each poll is a dice roll. A hit appends one fresh submission for this
    user; the recent tail is replayed every time so the engine's dedupe by id
    is exercised the same way the real API exercises it."""
    if SLUGS and random.random() < RATE:
        next_id[0] += 1
        made[0] += 1
        status = pick_verdict()
        entry = {
            "id": str(next_id[0]),
            "statusDisplay": status,
            "titleSlug": random.choice(SLUGS),
            "timestamp": int(time.time()),
        }
        if status == "Accepted":
            # Skewed high so re-solves keep nudging the percentile track.
            entry["runtimePercentile"] = round(random.triangular(5.0, 99.9, 72.0), 1)
        history[username].append(entry)
        del history[username][:-40]

    return list(reversed(history[username][-limit:]))
