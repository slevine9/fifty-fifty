# Fifty Fifty

A daily two-choice game. Everyone gets the same chain of questions each day. Your score is how many you get right in a row, and the first miss ends your run. The leaderboard ranks today's best streaks.

No npm install needed. The server uses only Node built-ins (including `node:sqlite`), so it needs **Node 22.13 or newer**.

## Run it locally

```bash
cd ~/Desktop/fiftyfifty
node server.js            # http://localhost:3000
```

The first start builds today's questions from the internet (about 20 seconds, because Open Trivia DB allows one request per 5 seconds). To preview a day's set with the answers marked:

```bash
node scripts/generate.js
```

Run the tests (offline; external APIs are stubbed):

```bash
npm test
```

## The experience

- **Landing:** a drifting field of tumbling gold and silver coins (`public/bg.js`), defaulting to **Daily** mode.
- **Left Menu:** the top-left menu button opens a drawer to switch between **Daily** (today's shared chain, 1 run/day) and **Arcade** (play as many unlimited runs as you want), view **All-Time Stats**, or manage your account.
- **Start:** pressing the button plays a coin toss (`public/flip.js`). A thumb rises, flicks a 3D coin, the coin lands, and the question screen opens out of it in a circle.
- **Playing:** two answers, silver on one side and gold on the other. After you answer, the correct side expands to take the screen. Picture questions start blurred and sharpen as the clock runs down.
- **Accounts & Stats:** sign in with **Google (Gmail)** or **Email & Password** to store your account and view Wordle-style all-time stats (Games Played, Best Streak, Average, Daily Day Streak, and Streak Distribution chart) for both Daily and Arcade across devices. Guest runs automatically merge when you sign in.
- **Reduced motion:** with the OS setting on, the toss and the background are skipped.

Palette and fonts live at the top of `public/style.css` (`--gold`, `--silver`, `--felt-*`, plus Unbounded and Hanken Grotesk from Google Fonts).

## Question types

Each day's chain is a blend of sources, set by `QUESTION_MIX` (see `.env.example`). Within a day the chain runs easy to hard, shuffled inside each tier and avoiding back-to-back questions from the same source.

| Source | Example | Data from | Picture |
|---|---|---|---|
| `opentdb` | "True or false: ..." / multiple choice cut to two options | Open Trivia DB | no |
| `flags` | Which country's flag is this? | REST Countries + flagcdn | yes |
| `dogs` | Which breed is this? | Dog CEO API | yes |
| `wiki` | Which landmark / animal is this? | Wikipedia page images (titles curated in `wiki.js`) | yes |
| `versus` | Which country has more people / is bigger by area? | REST Countries | no |
| `history` | Which happened first? | Wikipedia On This Day | no |
| `claude` | Anything you prompt for (optional) | Anthropic API | no |
| `seed` | Offline fallback so the chain never comes up short | `seed.js` | no |

If a source is down, the others (then the seed list) fill in. A question or photo isn't repeated for 60 days.

**Adding a type.** Create a file in `src/questions/` exporting `fetchQuestions(count)` that returns objects built with `makeQuestion()` from `util.js`, register it in `src/questions/index.js`, and add it to `QUESTION_MIX`. A question is just `{ q, options: [a, b], answer, difficulty, type, image?, credit?, key }`. Anything with an `image` renders a picture on the question screen.

**Ideas that fit the same shape:** higher or lower (box office, Wikipedia page views), "real or fake" (words, headlines), which came first (inventions), guess the decade from a photo, zoomed-in crops that zoom out, country silhouettes, "which is older", and audio clips.

### Reviewing questions
Open Trivia DB is community-written and sometimes wrong or ambiguous, and LLM-written trivia can be too, so spot-check before launch. `node scripts/generate.js 2026-11-24` previews a day's set the evening before. To rebuild today's before anyone plays: `node scripts/generate.js --force`, or `POST /admin/regenerate` with header `x-admin-token`.

### Image licensing
Wikipedia/Wikimedia photos carry their own licenses (mostly CC BY-SA or public domain), and the app shows a short credit line under each picture. Pictures are hotlinked, not copied. If you want to be strict about attribution, store the license and author from the Wikimedia API in the question's `credit` field.

## How it works

| Piece | File |
|---|---|
| HTTP server, routes, cookies | `server.js` |
| Daily rules: runs, timer, scoring, leaderboard | `src/game.js` |
| Arcade rules: unlimited runs, pool, leaderboard | `src/arcade.js` |
| Accounts: Google OAuth 2.0, email/password, sessions | `src/auth.js` |
| Wordle-style stats & distribution | `src/stats.js` |
| Midnight rollover logic | `src/dates.js` |
| Daily question builder + scheduler | `src/questions/index.js` |
| Sources | `src/questions/*.js` |
| Tables & migrations | `src/db.js` |
| Front end | `public/` |

**Same for everyone, fresh at midnight.** A day is `YYYY-MM-DD` in `GAME_TIMEZONE` (default America/New_York). The first request of a day builds and stores that day's chain, and after 11pm game time the server pre-builds tomorrow's so nobody waits at midnight.

**Cheat resistance.**
- Answers never leave the server (in either Daily or Arcade mode). The client only receives the current question, and the next one only after a correct answer.
- Each question has a server-enforced timer (`QUESTION_TIME_LIMIT`, default 15s) that keeps running across reloads. The clock starts 1.5 seconds after a question is served, so reveal animations and image loading don't cost the player time.
- One run per player per day in Daily mode; unlimited runs in Arcade mode.

**Google (Gmail) Sign-In setup.**
1. Open [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID** (Web application).
2. Add authorized redirect URI: `http://localhost:3000/auth/google/callback` (and `https://your-app.onrender.com/auth/google/callback` in production).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` (or Render environment variables).

**Leaderboard.** Most correct in a row wins. Ties go to whoever reached the streak first.

## Deploy on Render

1. Push this folder to a GitHub repo. Run `git status` first and confirm `src/` and `public/` are included.
2. Create a **Web Service** (not a Static Site). Runtime Node, start command `node server.js`, health check `/healthz`. Or create a **Blueprint** from the repo and Render reads `render.yaml`.
3. **Add a persistent disk** mounted at `/var/data` and set `DATA_DIR=/var/data`. Without it, Render wipes the SQLite file on every deploy and restart, and you lose players, stats, and leaderboards. Disks need a paid instance.
4. Set `NODE_VERSION=22` (already in `render.yaml`).
5. Optional: add `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` for Google Sign-In, or `ANTHROPIC_API_KEY` if you include `claude:N` in `QUESTION_MIX`.

## Known limits / next steps

- Single server only (SQLite file + in-memory throttling). For multiple instances, move to Postgres.
- Third-party APIs (REST Countries, Dog CEO, Wikipedia, Open Trivia DB) can be slow or down. The builder tolerates that, but a day's set is built once, so check it before launch.
- The midnight countdown can be an hour off on the two daylight-saving change days (the day boundary itself is always correct).
