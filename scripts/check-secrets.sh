#!/bin/bash
# Searches the current files AND the full git history for secrets.
# Run from anywhere inside the repo:   bash scripts/check-secrets.sh
#
# 1. gitleaks (if installed, or if GITLEAKS=/path/to/gitleaks is set): scans
#    every commit, plus the current tracked and untracked (not ignored) files.
# 2. Always: a pattern search with git grep (current files) and git log -p
#    (every commit) for API keys, tokens, sk-..., BARGO_API_KEY values, and
#    password/secret assignments.
# Values are never printed, only where they were found. Ignored files such as
# .env are deliberately not scanned (they never leave this computer).
# The PostHog phc_ project token is expected: it is a public, write-only
# client token by design (see SECURITY.md), so it is reported but allowed.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2
SELF="scripts/check-secrets.sh"
found=0

echo "== Secret scan: $(git rev-parse --short HEAD), $(git rev-list --count --all) commits =="

# --- 1. gitleaks ---------------------------------------------------------------
GL="${GITLEAKS:-$(command -v gitleaks || true)}"
if [ -n "$GL" ] && [ -x "$GL" ]; then
  echo "-- gitleaks $("$GL" version): full git history"
  if ! "$GL" git --redact --no-banner .; then found=1; fi
  echo "-- gitleaks: current files (tracked + untracked, not ignored)"
  tmp=$(mktemp -d)
  git ls-files -z -co --exclude-standard | while IFS= read -r -d '' f; do
    [ -f "$f" ] && mkdir -p "$tmp/$(dirname "$f")" && cp "$f" "$tmp/$f"
  done
  if ! "$GL" dir --redact --no-banner "$tmp"; then found=1; fi
  rm -rf "$tmp"
else
  echo "-- gitleaks not installed: using the pattern search only"
fi

# --- 2. Pattern search ---------------------------------------------------------
# name|regex (extended). Matches containing "replace-" are .env.example placeholders.
PATTERNS='OpenAI/OpenRouter-style key (sk-)|sk-[A-Za-z0-9_-]{20,}
GitHub token|(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}
AWS access key|AKIA[0-9A-Z]{16}
Slack token|xox[abprs]-[A-Za-z0-9-]{10,}
PostHog personal API key (phx_)|phx_[A-Za-z0-9]{20,}
Private key|-----BEGIN [A-Z ]*PRIVATE KEY-----
Bargo key value|BARGO_API_KEY[ ]*=[ ]*[^ $]{8,}
Bearer token|[Bb]earer [A-Za-z0-9._~+/=-]{20,}
Password/secret/token assignment|(password|passwd|secret|token|api_?key)[ ]*[:=][ ]*["'\''][^"'\'' ]{8,}["'\'']'

echo "-- pattern search: current files (tracked + untracked, not ignored)"
echo "-- pattern search: full history (git log -p --all)"
history=$(git log -p --all --format='commit %h' -- . ":(exclude)$SELF")
while IFS='|' read -r name regex; do
  current=$(git grep -nIE --untracked -e "$regex" -- . ":(exclude)$SELF"; echo "status:$?")
  case "$current" in *"status:0"|*"status:1") ;; *) echo "   ERROR: search for $name failed"; found=1 ;; esac
  current=$(printf '%s\n' "$current" | grep -v '^status:' | grep -v 'replace-' | cut -d: -f1,2)
  past=$(printf '%s\n' "$history" | grep -E '^commit |^\+' | grep -E -e "^commit " -e "$regex" | grep -v 'replace-' \
    | awk '/^commit /{c=$2; next} {print "commit " c}' | sort -u)
  if [ -n "$current$past" ]; then
    found=1
    echo "   FOUND $name (values hidden):"
    [ -n "$current" ] && printf '     now in %s\n' $current
    [ -n "$past" ] && printf '     added in %s\n' "$past"
  fi
done <<< "$PATTERNS"

# --- 3. The allowed PostHog project token ---------------------------------------
phc_files=$(git grep -lIE 'phc_[A-Za-z0-9]{20,}' -- . ":(exclude)$SELF" | tr '\n' ' ')
phc_count=$(git grep -hoIE 'phc_[A-Za-z0-9]{20,}' -- . ":(exclude)$SELF" | sort -u | wc -l | tr -d ' ')
[ -n "$phc_files" ] && echo "-- allowed: $phc_count PostHog phc_ project token (public, write-only by design) in: $phc_files"

echo
if [ "$found" -eq 0 ]; then
  echo "RESULT: No secrets found (current files + full git history). The PostHog phc_ project token is expected and allowed."
  exit 0
else
  echo "RESULT: POSSIBLE SECRETS FOUND: see the lines above. Rotate any real key, then remove it from the code and history."
  exit 1
fi
