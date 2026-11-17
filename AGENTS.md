# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Burst or Not, a dashboard that shows a 0–100 AI froth score (Fearful → Frothy) built from Polymarket odds, OpenRouter model price trends, and one manually entered signal.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** One static page (`app/index.html`): plain HTML, CSS, and JavaScript with no libraries or build step. It calls the public Polymarket Gamma API and OpenRouter models API directly from the browser, with no API keys.

## 2. Project Structure
```
app/index.html      The app page: layout, dark theme, PostHog snippet, and the glue
                    script (range tabs, refresh, cards, data table).
app/signals.js      Today's signals and the scoring formula (one comment block).
                    Shared by the live score and the history.
app/history.js      Daily Burst Index history since 2026-10-23, the main chart
                    (hover crosshair), and the card sparklines.
docs/index.html     Public Product Page and living PRD (GitHub Pages, from main → /docs).
docs/*.png          Screenshots shown on the Product Page.
README.md           Course instructions and quick run steps.
AGENTS.md           This file.
tests/README.md     Verification guidance (Build 4).
```
- **Signals:** Polymarket Gamma API (`gamma-api.polymarket.com/markets?slug=…`), Polymarket price history (`clob.polymarket.com/prices-history`), and OpenRouter (`openrouter.ai/api/v1/models`), all public with no keys. The manual signal is `MANUAL_SIGNAL` at the top of `app/signals.js`; add each new quarter's figure at the top of its `values` list.
- **History:** each past day is recalculated with today's formula. A past day only counts if it has the same signals as today, so a failed source never creates a fake jump.
- **Analytics:** PostHog (US Cloud) is on both pages. Custom events: `signals_refreshed` (with `froth_score`, `signals_loaded`), `signal_card_opened` (with `signal`), and `chart_range_changed` (with `range`). The `phc_` project token is a public client-side key that PostHog designs to live in browser code, so it is the one exception to rule 5 below. Never commit a `phx_` personal API key.

## 3. Commands
- **Setup / install dependencies:** None. You need Python 3 (preinstalled on macOS), a browser, and an internet connection.
- **Run locally:** from the repo root, run `python3 -m http.server 8000`, then open http://localhost:8000/app/ (app) or http://localhost:8000/docs/ (Product Page). Stop the server with Ctrl+C. Serve over localhost rather than opening the file directly: the app uses JavaScript modules, which browsers block on `file://`, and PostHog needs a real origin.
- **Run deterministic tests:** None yet.
- **Run model evals:** None yet (Build 4).
- **Manual check:** the page loads the Burst Index, the history chart, and three cards; hovering the chart shows each day's index and sub-scores; the 1W / 1M / 3M / All tabs update the change, chart, driver line, sparklines, and data table; the chart's last point matches the headline number; "Refresh signals" shows "Refreshing…" and then a new "Updated" time; opening a card shows its drivers; PostHog → Activity shows `$pageview`, `signals_refreshed`, `signal_card_opened`, and `chart_range_changed`.

## 4. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
