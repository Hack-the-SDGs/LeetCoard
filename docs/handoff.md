# Handoff

Written at the end of the session that converted this repo from a one-off
contest scoreboard into a permanent classroom practice board. Everything below
is true of branch `feature/practice-mode`.

## Where things stand

- Branch `feature/practice-mode`, not yet merged to `main`.
- `pytest -q` → 64 passed. `ruff check app tests` → clean. `npm run build` →
  clean, ~104 kB JS gzipped.
- Two adversarial reviews (one with full context, one blind) were run against
  the code and their findings are fixed; each fix has a regression test.
- `.github/assets/*.png` are still the **old** pre-redesign screenshots, on
  purpose. The owner has not approved the new ones. Do not replace them without
  being asked.

## What it does

A projector board for a LeetCode practice session. There is no contest clock:
each problem carries its own list of open windows, and an AC scores only if it
lands inside one of them. The teacher opens and closes problems live from the
console. Six fixed teams; two leaderboards (teams across the header, individuals
down the left); each problem shows a three-portrait podium over a runtime
percentile distribution.

Read `README.md` first — it covers the scoring rules, the team model, the
polling behaviour and the classroom flow. This file only covers what a
successor needs that the README does not say.

## The next job: real data

The owner will supply real names, team assignments and LeetCode usernames.

Import format is `username,姓名,組別` (one per line, third column optional and
omitting it leaves an existing assignment alone). Paste it into the console's
學員 panel, or `PUT /api/admin/participants/bulk` with `{"text": "..."}`.

Watch for:

- **`username` is the LeetCode handle, not the student id.** Everything —
  polling, avatars, profile links — keys off it. A typo means that student is
  silently never polled. There is no validation that the handle exists.
- `姓名` is shown on the projector. That is deliberate; the owner confirmed real
  names are fine.
- Teams are fixed at six. Names and hex colours are editable in the console.
- Delete `data/contest.json` **and** `data/contest.json.bak` before the first
  run with real data. Older state files do not parse against the current schema
  and a failed load starts empty, then overwrites the backup within two saves.

## Things that will bite

- **`ADMIN_TOKEN` in `.env` is still a dev value.** It must be rotated before
  anything is exposed. The server logs an error at startup if it is literally
  `change-me`, but it does not refuse to start.
- `data/` and `.env` are gitignored. The repo is going private but backend
  state and secrets still must not be pushed.
- `LEETCODE_SESSIONS` is optional. Without it there are no runtime percentiles,
  so the podium falls back to solve order and the distribution bar disappears.
  With a single cookie and 66 students, expect some lookups to be rate-limited;
  solvers without a percentile are still placed, just unranked.
- The upstream (`leetcode-api-pied.vercel.app`) showed **no rate limiting** when
  probed: 24 concurrent and 15 req/s sustained, ~880 requests, zero 429s, and
  `x-vercel-cache: MISS` on every response. `POLL_MAX_RPS=6` is conservative and
  could go to 10–12. The untested path is the `submissionDetails` GraphQL call,
  which goes straight to leetcode.com with the session cookie and scales with
  AC count rather than poll count.
- A monthly Vercel quota on the upstream was not measured. 66 students × 2 hours
  is roughly 50k invocations.

## Looking at the board without a class

`tools/seed_demo_board.py` writes a populated state file; `tools/fake_leetcode_api.py`
is a stand-in upstream that invents submissions as it is polled, so the real
polling worker, scoring engine and SSE path all run. See the README section
「沒有真人也能看畫面」. The owner asked for these to be kept and expects to reuse
or adjust them.

**Never point `DATA_DIR` at the real folder when seeding** — it overwrites.

## Deliberately not done

- `.github/assets` screenshots (awaiting approval).
- The board is projector-first. Below about 1280px the team header hides its
  contributor portraits and the bottom ticker crowds; the owner declined fixes
  there since a projector is the only real target.
- No merge to `main`, no tag, no deploy.

---

## Paste this into the next session

> 這個專案是 LeetCode 課堂練習即時計分板（FastAPI + React），分支
> `feature/practice-mode`。先讀 `README.md` 和 `docs/handoff.md`，不要重新推導架構。
>
> 這次要做的是**灌入正式資料**：我會給你真實姓名、組別、以及對應的 LeetCode
> username。匯入格式是 `username,姓名,組別`。
>
> 重要前提：
> - `username` 是 LeetCode 帳號，打錯會導致那個人永遠不被輪詢，且系統不會報錯
> - 第一次用正式資料前，要先刪掉 `data/contest.json` 與 `data/contest.json.bak`
> - `.env` 的 `ADMIN_TOKEN` 還是開發用的值，上線前必須換掉
> - 這個 repo 會轉為 private，但 `data/` 與 `.env` 仍然不可以推上遠端
> - **不要動 `.github/`**，裡面的截圖還沒經過我確認
>
> `tools/` 底下有假上游與假資料的腳本，請保留，我可能會再調整。
>
> 動手前先確認 `pytest -q`、`ruff check app tests`、`cd frontend && npm run build`
> 都是綠的。
