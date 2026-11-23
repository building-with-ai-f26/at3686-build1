# Security

Burst or Not is a static web page on GitHub Pages:
https://building-with-ai-f26.github.io/at3686-build1/app/

## What the app stores

**No user data.** There is no sign-in, no database, and no AI model call.

- The Burst Index is computed in the visitor's browser from public Polymarket and OpenRouter data.
- The Capitol Hill summary is a static JSON file (`docs/data/`) that holds aggregates only, with no names or individual trades.
- Member searches go straight from the visitor's browser to Bargo, and the results are shown but never saved.
- PostHog collects anonymous usage analytics: pageviews, clicks, session replays, and the custom events listed in `AGENTS.md`.

If a crowd vote is added later, it will use Supabase with Row Level Security and server-side writes.

## Secrets

- **`BARGO_API_KEY`** lives only in GitHub Actions secrets (repo Settings → Secrets and variables → Actions). Only the daily workflow reads it, as an environment variable. It is never in the code, the logs, or the page. Locally it goes in `.env`.
- **`.env` is gitignored** (see `.gitignore`) and has never been committed. `.env.example` holds placeholders only.
- **The PostHog `phc_` project token in `docs/posthog.js` is not a secret.** It is a public, write-only client token by design. It can only send events to our project and cannot read any data. PostHog personal API keys (`phx_`) must never be committed.
- **Check for secrets:** `bash scripts/check-secrets.sh` scans the current files and the full git history. It uses gitleaks if installed, plus a built-in pattern search, and ends with a one-line result.

## How the pages handle data

- **Third-party data is rendered as text, not HTML.** Every name, question, and amount from Polymarket, OpenRouter, and Bargo is either escaped with `escapeHtml` before it reaches the page or set with `textContent`, so it can't run as code. API numbers are converted to numbers first.
- **Content-Security-Policy:** both pages carry a CSP `<meta>` tag. It allows only our own scripts and PostHog's and blocks inline scripts. The app can connect only to Polymarket, OpenRouter, Bargo, and PostHog.
- **Member search input:** 2–60 characters, letters plus spaces, periods, apostrophes, and hyphens only. It is checked before any request, including for shared `?member=` links.

## PostHog session replay

- Replays mask everything typed into inputs (`maskAllInputs: true`).
- A `before_send` hook removes `?member=…` from event and replay URLs, so PostHog never stores what people searched for.

## GitHub Actions

- The only workflow (`congress-trades.yml`) has no permissions by default. Its single job gets `contents: write`, the minimum it needs to commit the updated data. The repo's default token is read-only.
- Actions are pinned to exact commit SHAs, with the version in a comment.
- The workflow uses no third-party packages; the script has no dependencies.

## Known risks and fallbacks

| Risk | What happens | Fallback |
|---|---|---|
| Polymarket or OpenRouter is down or changes its API | That signal's card shows "Unavailable" | The index uses the remaining signals, and past days are compared like-for-like, so there is no fake jump |
| Bargo is down, over quota, or changes its API | The daily job fails | The last good summary stays live; the job never overwrites it with empty data |
| Some networks block or can't reach `bargo.ai` (seen on a shared Wi-Fi) | Member search says "Couldn't reach Bargo" | The rest of the app, including the Congress summary, still works. Try another network |
| Bargo's free search limit is per network address | Everyone on the same Wi-Fi shares about 10 searches a day | A clear "used today's free lookups" message |
| GitHub Pages can't send security headers | No clickjacking protection (`frame-ancestors`) | CSP is set by meta tag; the app has no sign-in or actions worth hijacking |
| The CSP allows inline styles | Needed for chart bar widths | Scripts stay strictly blocked |

## Reporting a problem

Open a GitHub issue that says a security problem exists, but don't include the details or any key. The owner will follow up privately.
