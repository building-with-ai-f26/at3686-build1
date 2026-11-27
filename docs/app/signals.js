/*
 * SCORING FORMULA
 * ---------------
 * Each signal produces one raw value. We turn it into a 0–100 sub-score with
 * a straight line between a "calm" value (scores 0) and a "frothy" value
 * (scores 100), clamped so it never goes below 0 or above 100:
 *
 *     sub-score = clamp( (value − calm) / (frothy − calm) × 100, 0, 100 )
 *
 * The Burst Index is the plain average of the sub-scores that loaded
 * (equal weights). If a signal fails to load, it is skipped and the others
 * are averaged.
 *
 *   1. Polymarket hype odds: average "Yes" chance across three AI-hype
 *      markets. Calm = 5%, Frothy = 50%.
 *   2. OpenRouter price trend: median input price of paid models released
 *      in the 180 days before a date ÷ median for models released in the year
 *      before that (180–545 days). ":batch" variants are left out: they are
 *      discounted copies of models already listed, so they skewed the median.
 *      Falling prices count as froth (labs pricing below cost to grab share).
 *      Calm = 1.2 (prices up 20%), Frothy = 0.6 (prices down 40%).
 *   3. Manual signal: AI's share of global VC funding, entered by hand each
 *      quarter from Crunchbase. Calm = 20%, Frothy = 80%.
 *
 * Bands: 0–20 Fearful · 20–40 Cautious · 40–60 Neutral · 60–80 Hot · 80–100 Frothy.
 * The cutoffs are prototype guesses, not calibrated against history.
 *
 * History (history.js) reuses these same functions for every past day, the way
 * a stock index is recalculated from its components.
 */

// Update each quarter: add the new figure at the TOP of `values`.
// `effective` is the day the figure starts counting in the index (the start of
// the following quarter, roughly when Crunchbase publishes it).
export const MANUAL_SIGNAL = {
  label: "AI share of global VC funding",
  source: "Crunchbase",
  values: [
    { quarter: "Q3 2026", value: 64, effective: "2026-10-01" },
    { quarter: "Q1 2026", value: 80, effective: "2026-04-01" },
    { quarter: "Q3 2025", value: 50, approx: true, effective: "2025-10-01" },
  ],
};

export const POLYMARKET_MARKETS = [
  { slug: "will-anthropics-valuation-hit-high-2pt5t-by-december-31-169", event: "will-anthropics-valuation-hit-by-december-31" },
  { slug: "openai-ipo-closing-market-cap-above-2t", event: "openai-ipo-closing-market-cap-above" },
  { slug: "openai-announces-it-has-achieved-agi-before-2027", event: "openai-announces-it-has-achieved-agi-before-2027" },
];

// `measures`: one line on the card face saying what the signal is and which
// way pushes froth up.
export const SIGNALS = [
  { id: "polymarket", name: "Polymarket AI-hype odds",
    measures: "Betting odds on extreme AI outcomes (a $2.5T Anthropic, a $2T OpenAI IPO, AGI before 2027). Higher odds → more froth." },
  { id: "openrouter", name: "OpenRouter model price trend",
    measures: "Are new AI models launching cheaper than last year's? Cheaper launches → more froth." },
  { id: "manual", name: MANUAL_SIGNAL.label,
    measures: "How much of all venture money goes to AI. Bigger share → more froth." },
];

export const BOUNDS = {
  polymarket: { calm: 0.05, frothy: 0.5 },
  openrouter: { calm: 1.2, frothy: 0.6 },
  manual: { calm: 20, frothy: 80 },
};

// `meaning`: the plain-English headline shown above the score.
export const BANDS = [
  { max: 20, name: "Fearful", meaning: "AI hype is running well below fundamentals." },
  { max: 40, name: "Cautious", meaning: "AI hype is cooler than usual." },
  { max: 60, name: "Neutral", meaning: "AI hype is roughly in line with fundamentals." },
  { max: 80, name: "Hot", meaning: "AI hype is running above fundamentals." },
  { max: 100, name: "Frothy", meaning: "AI hype is far above fundamentals: classic bubble territory." },
];

const DAY_SECONDS = 86400;

export function subScore(value, { calm, frothy }) {
  const scaled = ((value - calm) / (frothy - calm)) * 100;
  return Math.max(0, Math.min(100, scaled));
}

export function bandFor(score) {
  return BANDS.find((b) => score <= b.max) || BANDS[BANDS.length - 1];
}

// The index for one day: the average of whichever sub-scores are available.
export function indexScore(subScores) {
  const available = Object.values(subScores).filter(Number.isFinite);
  if (available.length === 0) return null;
  return available.reduce((sum, s) => sum + s, 0) / available.length;
}

export function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export async function getJson(url) {
  // cache: "no-store" makes every refresh a real network call, not a cached copy.
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// --- Signal 1: Polymarket -------------------------------------------------

// Fetches today's odds for each market, plus the token id needed for its price history.
// Each market reports outcomes, prices, and token ids as JSON strings, in the same order.
export async function fetchPolymarketMarkets() {
  const results = await Promise.allSettled(
    POLYMARKET_MARKETS.map(async ({ slug, event }) => {
      const [market] = await getJson(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
      if (!market) throw new Error("market not found");
      const outcomes = JSON.parse(market.outcomes);
      const yesIndex = outcomes.indexOf("Yes");
      const yes = JSON.parse(market.outcomePrices).map(Number)[yesIndex];
      if (!Number.isFinite(yes)) throw new Error("no Yes price");
      return {
        question: market.question,
        yes,
        yesToken: JSON.parse(market.clobTokenIds)[yesIndex],
        endDate: market.endDate,
        url: `https://polymarket.com/event/${event}`,
      };
    })
  );
  return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
}

export function polymarketSubScore(yesValues) {
  if (yesValues.length === 0) return null;
  const avgYes = yesValues.reduce((sum, y) => sum + y, 0) / yesValues.length;
  return { avgYes, score: subScore(avgYes, BOUNDS.polymarket) };
}

// --- Signal 2: OpenRouter -------------------------------------------------

export async function fetchOpenRouterModels() {
  const { data } = await getJson("https://openrouter.ai/api/v1/models");
  return data;
}

// Price trend as of a moment in time (seconds). Prices are USD per token;
// free and special models (price ≤ 0) and ":batch" variants are skipped. Uses
// today's listed prices, so past days are an approximation (old prices and
// removed models are unknown).
export const OPENROUTER_WINDOW = { recentDays: 180, priorDays: 365 };
export const isBatchVariant = (model) => /:batch$/i.test(model.id || "");

export function openRouterTrendAt(models, atSeconds) {
  const recent = [];
  const prior = [];
  for (const model of models) {
    const pricePerMillion = Number(model.pricing?.prompt) * 1e6;
    if (!(pricePerMillion > 0) || !model.created || model.created > atSeconds || isBatchVariant(model)) continue;
    const ageDays = (atSeconds - model.created) / DAY_SECONDS;
    const { recentDays, priorDays } = OPENROUTER_WINDOW;
    if (ageDays < recentDays) recent.push(pricePerMillion);
    else if (ageDays < recentDays + priorDays) prior.push(pricePerMillion);
  }
  if (recent.length < 5 || prior.length < 5) return null;
  const recentMedian = median(recent);
  const priorMedian = median(prior);
  const ratio = recentMedian / priorMedian;
  return { recentMedian, priorMedian, recentCount: recent.length, priorCount: prior.length, ratio, score: subScore(ratio, BOUNDS.openrouter) };
}

// --- Signal 3: manual -----------------------------------------------------

// The figure in effect on a given day ("YYYY-MM-DD"), or null before the first one.
export function manualAt(isoDate) {
  return MANUAL_SIGNAL.values.find((v) => v.effective <= isoDate) || null;
}

export function manualSubScore(entry) {
  return entry ? subScore(entry.value, BOUNDS.manual) : null;
}
