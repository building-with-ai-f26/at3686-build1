# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Burst or Not, a dashboard that shows a 0–100 AI froth score (Fearful → Frothy) built from Polymarket odds, OpenRouter model price trends, and one manually entered signal.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** One static page (`app/index.html`): plain HTML, CSS, and JavaScript with no libraries or build step. It calls the public Polymarket Gamma API and OpenRouter models API directly from the browser, with no API keys.

## 2. Commands
- **Install dependencies:** None.
- **Run locally:** `open app/index.html` (macOS), or double-click the file. It needs an internet connection for the live signals.
- **Run deterministic tests:** None yet.
- **Run model evals:** None yet (Build 4).

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
