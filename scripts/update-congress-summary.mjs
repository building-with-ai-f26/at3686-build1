// Builds docs/data/congress-ai-summary.json and docs/data/party-lookup.json.
// Run daily by .github/workflows/congress-trades.yml, or locally:
//   node --env-file=.env scripts/update-congress-summary.mjs   (key optional)
//
// Bargo's terms forbid republishing raw trade records, so this writes
// AGGREGATES ONLY: counts and summed amount ranges by chamber/party and by
// ticker, plus disclosure-lag stats. No member names, dates, or single trades.
// The app's member search calls Bargo live from the visitor's browser instead.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { AI_TICKERS, BARGO_API as API, buildPartyLookup, partyFor, partyBucket } from "../docs/app/congress-common.js";

const LEGISLATORS = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const OUT_DIR = new URL("../docs/data/", import.meta.url);
const DAY_MS = 86400000;

// Bargo's free quota: without a key, 30 requests and 100 rows per IP per day;
// with a free key, 100 requests and 1,000 rows. If a request asks for more rows
// than remain, Bargo returns an EMPTY list (not an error), so pages stay small
// without a key and the remaining-rows header is checked on every call.
const key = process.env.BARGO_API_KEY?.startsWith("replace-") ? "" : process.env.BARGO_API_KEY; // ignore the .env.example placeholder
const headers = key ? { "X-Api-Key": key } : {};
const PAGE_SIZE = key ? 100 : 25;
console.log(key ? "Using BARGO_API_KEY." : "No BARGO_API_KEY: using Bargo's keyless free limits.");

// Bargo can be slow, so allow 45 s and retry once on a timeout, network error, or 5xx.
async function getJson(url, options = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText} for ${url.split("?")[0]}`);
        error.retryable = response.status >= 500;
        throw error;
      }
      return { data: await response.json(), rowsLeft: Number(response.headers.get("x-ratelimit-rows-remaining")) };
    } catch (error) {
      const retryable = error.retryable ?? true; // timeouts and network errors have no status
      if (!retryable || attempt >= 2) throw error;
      console.log(`Retrying once after: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Every trade for one ticker in Bargo's free window (last ~3 months), all pages.
// Bargo's pages start at 0 (page=1 is the SECOND page); this isn't in its docs.
async function tradesFor(ticker) {
  const trades = [];
  for (let page = 0; page < 20; page++) {
    const { data, rowsLeft } = await getJson(`${API}/trades?ticker=${ticker}&limit=${PAGE_SIZE}&page=${page}`, { headers });
    console.log(`${ticker} page ${page}: ${data.trades.length} trades (rows left today: ${Number.isFinite(rowsLeft) ? rowsLeft : "not reported"})`);
    if (data.trades.length === 0 && Number.isFinite(rowsLeft) && rowsLeft < PAGE_SIZE) {
      throw new Error(`Bargo daily row quota too low (${rowsLeft} rows left); not overwriting the summary.`);
    }
    trades.push(...data.trades.filter((t) => t.ticker === ticker));
    if (data.trades.length < PAGE_SIZE) break;
  }
  return trades;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : null;
};

function emptyTally() {
  return { buys: 0, sells: 0, buy_amount_low: 0, buy_amount_high: 0, sell_amount_low: 0, sell_amount_high: 0, open_ended: 0 };
}

function addTrade(tally, trade) {
  const side = trade.type === "purchase" ? "buy" : trade.type === "sale" ? "sell" : null;
  if (!side) return;
  tally[`${side}s`] += 1;
  tally[`${side}_amount_low`] += Number(trade.amount_low) || 0;
  if (Number.isFinite(Number(trade.amount_high)) && trade.amount_high !== null) tally[`${side}_amount_high`] += Number(trade.amount_high);
  else tally.open_ended += 1; // e.g. "Over $50,000,000": no upper bound disclosed
}

// Compare everything except the timestamp, so unchanged data isn't recommitted.
async function writeIfChanged(name, data, ignoreKey) {
  const url = new URL(name, OUT_DIR);
  const strip = (obj) => JSON.stringify({ ...obj, [ignoreKey]: undefined });
  try {
    const existing = JSON.parse(await readFile(url, "utf8"));
    if (strip(existing) === strip(data)) return console.log(`${name}: unchanged`);
  } catch { /* first run: no file yet */ }
  await writeFile(url, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${name}: written`);
}

async function main() {
  const lookup = buildPartyLookup((await getJson(LEGISLATORS)).data);

  // Count every record Bargo returns. Bargo already de-duplicates; records that
  // look identical are usually separate trades (for example, the same purchase
  // in a member's and a spouse's account; Bargo omits the account owner).
  const trades = [];
  for (const ticker of AI_TICKERS) trades.push(...(await tradesFor(ticker)));
  if (trades.length === 0) throw new Error("No trades returned; not overwriting the summary.");

  const groups = {};
  const byTicker = {};
  const lags = [];
  let unmatched = 0;
  let exchanges = 0;
  for (const t of trades) {
    const party = partyBucket(partyFor(t, lookup));
    if (party === "Unknown") unmatched += 1;
    if (t.type === "exchange") exchanges += 1;
    addTrade((groups[`${t.chamber}|${party}`] ||= { chamber: t.chamber, party, ...emptyTally() }), t);
    addTrade((byTicker[t.ticker] ||= { ticker: t.ticker, ...emptyTally() }), t);
    const lag = (Date.parse(t.disclosure_date) - Date.parse(t.transaction_date)) / DAY_MS;
    if (Number.isFinite(lag) && lag >= 0) lags.push(lag);
  }

  const dates = (key) => trades.map((t) => t[key]).filter(Boolean).sort();
  const total = Object.values(groups).reduce((acc, g) => ({ buys: acc.buys + g.buys, sells: acc.sells + g.sells }), { buys: 0, sells: 0 });

  const summary = {
    generated_at: new Date().toISOString(),
    source: {
      name: "Bargo",
      url: "https://www.bargo.ai/free-apis/congress",
      note: "Official House and Senate periodic transaction reports, collected by Bargo. Aggregates only; raw records are not republished.",
    },
    tickers: AI_TICKERS,
    window: { first_transaction: dates("transaction_date")[0], last_transaction: dates("transaction_date").at(-1), last_disclosure: dates("disclosure_date").at(-1) },
    totals: { trades: trades.length, ...total, exchanges, unmatched_party: unmatched },
    disclosure_lag_days: { median: median(lags), max: lags.length ? Math.max(...lags) : null, over_45: lags.filter((d) => d > 45).length },
    by_group: Object.values(groups).sort((a, b) => a.chamber.localeCompare(b.chamber) || a.party.localeCompare(b.party)),
    by_ticker: Object.values(byTicker).sort((a, b) => b.buys + b.sells - (a.buys + a.sells)),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeIfChanged("congress-ai-summary.json", summary, "generated_at");
  await writeIfChanged("party-lookup.json", { source: "https://github.com/unitedstates/congress-legislators (CC0)", ...lookup }, "_none");
  console.log(`${trades.length} AI-ticker trades · ${total.buys} buys / ${total.sells} sells · ${unmatched} without a party match`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
