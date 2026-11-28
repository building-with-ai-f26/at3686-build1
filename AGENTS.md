# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Burst or Not, a dashboard that shows a 0–100 AI froth score (Fearful → Frothy) built from Polymarket odds, OpenRouter model price trends, and one manually entered signal.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** One static page (`docs/app/index.html`): plain HTML, CSS, and JavaScript with no libraries or build step. It calls the public Polymarket and OpenRouter APIs directly from the browser, with no API keys. Published with the Product Page on GitHub Pages.
- **Live URLs:** app at https://building-with-ai-f26.github.io/at3686-build1/app/ · Product Page at https://building-with-ai-f26.github.io/at3686-build1/ (both deploy from `main` → `/docs` after each merge).

## 2. Project Structure
```
docs/app/index.html The app page: layout, dark theme, and Content-Security-Policy.
docs/app/main.js    The app's glue script (range tabs, refresh, cards, data table).
docs/posthog.js     PostHog snippet and settings, shared by both pages.
docs/app/signals.js Today's signals and the scoring formula (one comment block).
                    Shared by the live score and the history.
docs/app/history.js Daily Burst Index history since 2026-10-23, the main chart
                    (hover crosshair), and the card sparklines.
docs/app/congress.js          "Capitol Hill AI trades" panel: buys/sells chart from the
                              daily summary, and live member search (Bargo, from the browser).
docs/app/congress-common.js   AI ticker list and party matching, shared by the panel and the script.
docs/data/congress-ai-summary.json   Daily AGGREGATES (no raw trade records).
docs/data/party-lookup.json   Seat/name → party, from congress-legislators (CC0).
docs/data/members.json        Current members' public names, for search spelling help (CC0).
scripts/update-congress-summary.mjs  Builds both data files (no dependencies).
.github/workflows/congress-trades.yml Runs the script daily and commits data changes to main.
docs/index.html     Public Product Page and living PRD (GitHub Pages, from main → /docs).
docs/*.png          Screenshots shown on the Product Page.
README.md           Course instructions and quick run steps.
AGENTS.md           This file.
tests/README.md     Verification guidance (Build 4).
```
- **Signals:** Polymarket Gamma API (`gamma-api.polymarket.com/markets?slug=…`), Polymarket price history (`clob.polymarket.com/prices-history`), and OpenRouter (`openrouter.ai/api/v1/models`), all public with no keys. The manual signal is `MANUAL_SIGNAL` at the top of `docs/app/signals.js`; add each new quarter's figure at the top of its `values` list. OpenRouter skips `:batch` variants (discounted copies of listed models) and compares models released in the last 180 days with the 365 days before that (`OPENROUTER_WINDOW` in `signals.js`). Each signal's card-face explanation is its `measures` line in `SIGNALS`; each band's headline sentence is its `meaning` in `BANDS`.
- **Congress trades (Bargo):** **never commit raw trade records.** Bargo's terms forbid republishing them (files, feeds, or serving them from our site); only aggregates that can't be used to reconstruct records are allowed, plus live results fetched by the visitor's browser. Bargo attribution must stay visible without scrolling (top bar) and next to the panel. The optional key is the GitHub secret `BARGO_API_KEY` (locally: `.env`); never put it in the page. Without a key, Bargo allows 30 requests and 100 rows per IP per day, and returns an *empty* list (not an error) when the row quota runs out. Member search asks for 10 rows per search (about 10 searches a day per network address, shared on the same Wi-Fi). The summary counts every record Bargo returns (no extra de-duplication: identical-looking records are usually separate trades, e.g. self vs. spouse accounts). **Bargo's `page` parameter starts at 0** (`page=1` is the second page), which its docs don't say. Don't show Bargo's `perf_pct`/`outcome` fields (estimates; see PRD non-goal #4). The trade-size filter (`AMOUNT_FILTERS` in `congress-common.js`: low end of the disclosed range ≥ $15,001 / $50,001 / $250,001) uses `amount_filters` in the summary, which holds **buy/sell counts by chamber and party only**: no tickers or amounts, because large trades are rare and small groups could otherwise be traced to one record. The panel is not part of the Burst Index.
- **History:** each past day is recalculated with today's formula. A past day only counts if it has the same signals as today, so a failed source never creates a fake jump.
- **Security:** both pages have a Content-Security-Policy `<meta>` tag. **No inline scripts or `onclick` handlers** (the policy blocks them): put JavaScript in `.js` files and custom click events on `data-ph-event="name"`. A new API host must be added to the app's `connect-src`, or the browser blocks it. Escape every third-party string with `escapeHtml` before using `innerHTML` (or use `textContent`). Member search input is checked by `checkQuery` in `congress.js`; a query matching no current member (`members.json`) gets "Did you mean…?" suggestions before any Bargo call. Workflow actions are pinned to commit SHAs with the version in a comment.
- **Analytics:** PostHog (US Cloud) is on both pages via the shared `docs/posthog.js` (snippet, input masking in replays, and a `before_send` hook that strips `?member=` from event and replay URLs). Custom events: `signals_refreshed` (with `froth_score`, `signals_loaded`), `signal_card_opened` (with `signal`), `chart_range_changed` (with `range`), `congress_search` (counts only, never the query; `suggestions_shown` when "Did you mean" appeared), and `congress_amount_filter` (with `min_amount`, `label`). The `phc_` project token is a public client-side key that PostHog designs to live in browser code, so it is the one exception to rule 5 below. Never commit a `phx_` personal API key.
- **Data & sign-in:** the app has no sign-in and no database because it stores no user data: scores are computed in the visitor's browser, the Congress summary is a static JSON file, and member searches go straight from the browser to Bargo. If a crowd vote is added later, it will use Supabase with Row Level Security and server-side writes (never direct writes from the browser).

## 3. Commands
- **Setup / install dependencies:** None. You need Python 3 (preinstalled on macOS), a browser, and an internet connection.
- **Run locally:** from the repo root, run `python3 -m http.server 8000 --directory docs`, then open http://localhost:8000/app/ (app) or http://localhost:8000/ (Product Page). Serving `docs` keeps local paths the same as the live site. Stop the server with Ctrl+C. Serve over localhost rather than opening the file directly: the app uses JavaScript modules, which browsers block on `file://`, and PostHog needs a real origin.
- **Refresh Congress data locally:** `node --env-file=.env scripts/update-congress-summary.mjs` (key optional), or on GitHub: Actions → "Update Congress AI trades summary" → Run workflow.
- **Check for secrets:** `bash scripts/check-secrets.sh` (current files + full git history; uses gitleaks if installed). Run before every PR; it must end with "RESULT: No secrets found". Security overview: `SECURITY.md`.
- **Run deterministic tests:** None yet.
- **Run model evals:** None yet (Build 4).
- **Manual check:** the page loads the Burst Index, the history chart, and three cards; hovering the chart shows each day's index and sub-scores; the 1W / 1M / 3M / All tabs update the change, chart, driver line, sparklines, and data table; the chart's last point matches the headline number; "Refresh signals" shows "Refreshing…" and then a new "Updated" time; opening a card shows its drivers; PostHog → Activity shows `$pageview`, `signals_refreshed`, `signal_card_opened`, and `chart_range_changed`.
- **Deploy (GitHub Pages):** there is no build step. Pages publishes the `/docs` folder of `main` (Settings → Pages → Source: "Deploy from a branch", `main`, `/docs`), so **merging a PR to `main` is the deploy**. Every push to `main` starts the "pages build and deployment" workflow, which takes about a minute. Never push straight to `main` yourself; open a PR (the daily data bot below is the one exception).
- **Verify a deploy:**
  1. `gh run list --workflow pages-build-deployment --limit 1` shows `completed success` for the merge commit (or Actions tab → "pages build and deployment").
  2. `curl -sI https://building-with-ai-f26.github.io/at3686-build1/app/` returns `200`, and `curl -s` of a changed file shows the new content (Pages caches for up to 10 minutes; add `?v=1` to skip the cache).
  3. Open the live app in a browser (hard refresh: Cmd+Shift+R) and run the manual check above, including the Console showing no errors or Content-Security-Policy violations, and the Capitol Hill panel showing today's summary.
  4. Check at phone width (390 px) that the page doesn't scroll sideways.
- **Daily Congress data:** `.github/workflows/congress-trades.yml` runs every day at 13:17 UTC (and on Actions → "Update Congress AI trades summary" → Run workflow). It runs `scripts/update-congress-summary.mjs`, and if `docs/data/*.json` changed it commits to `main` as `github-actions[bot]`, which triggers a normal Pages deploy. If Bargo fails or the quota is used up, the job fails and the last good summary stays live. Check runs with `gh run list --workflow congress-trades.yml`.
- **Where the Bargo key lives:** repo Settings → Secrets and variables → Actions → Repository secrets → `BARGO_API_KEY`. Only the workflow reads it (as an environment variable); it is never in the repo, the logs, or the page. Locally it goes in `.env` (ignored by Git). To rotate it: get a new key from https://www.bargo.ai/free-apis/dash and update the secret.

## 4. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
