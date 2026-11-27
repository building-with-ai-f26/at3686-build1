// Shared settings for the "Capitol Hill AI trades" panel, used by both the
// daily script (scripts/update-congress-summary.mjs) and the app (congress.js).

// AI tickers tracked. Bargo lists Alphabet as GOOG; GOOGL is kept in case it appears.
export const AI_TICKERS = ["NVDA", "MSFT", "GOOGL", "GOOG", "META", "AMD", "AVGO", "TSM", "PLTR"];

export const BARGO_API = "https://www.bargo.ai/free-apis/congress/v1";

// Trade-size filter. Members disclose a range (e.g. $15,001–$50,000), so a trade
// counts as "$15K+" when the LOW end of its range is at least $15,001.
export const AMOUNT_FILTERS = [
  { min: 15001, label: "$15K+" },
  { min: 50001, label: "$50K+" },
  { min: 250001, label: "$250K+" },
];

// Party matching. Bargo's data has no party field, so each trade is matched to
// the public-domain congress-legislators dataset
// (https://github.com/unitedstates/congress-legislators, CC0):
//   - House: by state + district (Bargo's "state" looks like "FL27")
//   - Senate: by state + last name

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function normalizeName(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((part) => part && !SUFFIXES.has(part));
}

// "FL27" → "FL27", "CA1" → "CA01", "AKAL" / "AK" / "AK00" → "AK00".
export function houseSeat(state) {
  const match = /^([A-Z]{2})(\d{1,2}|AL)?$/i.exec(String(state || "").trim());
  if (!match) return null;
  const district = !match[2] || match[2].toUpperCase() === "AL" ? 0 : Number(match[2]);
  return `${match[1].toUpperCase()}${String(district).padStart(2, "0")}`;
}

// Builds the compact lookup from legislators-current.json:
// { house: { "FL27": "Republican" }, senate: { "WA": { "cantwell": "Democrat" } } }
export function buildPartyLookup(legislators) {
  const lookup = { house: {}, senate: {} };
  for (const person of legislators) {
    const term = person.terms[person.terms.length - 1];
    if (term.type === "rep") {
      lookup.house[`${term.state}${String(term.district ?? 0).padStart(2, "0")}`] = term.party;
    } else if (term.type === "sen") {
      const parts = normalizeName(person.name.last);
      const byState = (lookup.senate[term.state] ||= {});
      byState[parts.join(" ")] = term.party; // full last name, e.g. "van hollen"
      byState[parts[parts.length - 1]] = term.party; // last word, e.g. "hollen"
    }
  }
  return lookup;
}

// Returns "Democrat", "Republican", "Independent", or null when no match.
export function partyFor(trade, lookup) {
  if (trade.chamber === "house") {
    const seat = houseSeat(trade.state);
    return (seat && lookup.house[seat]) || null;
  }
  if (trade.chamber === "senate") {
    const state = String(trade.state || "").slice(0, 2).toUpperCase();
    const parts = normalizeName(trade.member);
    return lookup.senate[state]?.[parts[parts.length - 1]] || null;
  }
  return null;
}

// Groups any party value into the four buckets the panel shows.
export function partyBucket(party) {
  return ["Democrat", "Republican", "Independent"].includes(party) ? party : "Unknown";
}
