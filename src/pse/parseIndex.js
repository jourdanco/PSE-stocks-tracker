'use strict';
/**
 * PSE Edge "Index Summary" page (verified layout):
 *   table 1:  Index | Value | Chg | %Chg      e.g. "PSEi" "5,779.73" "41.78" "0.72▼"   (arrow gives direction)
 *   table 2:  "MARKET : CLOSED" | "As of Oct 22, 2026 4:37 PM"
 *             Total Volume / Total Trades / Total Value / Advances / Declines / Unchanged
 */
const { toNumber, findValue, parseAsOf } = require('./parseCore');

const INDEX_NAMES = ['PSEi', 'All Shares', 'Financials', 'Industrial', 'Holding Firms', 'Services', 'Mining and Oil', 'Property'];

function parseIndexRow(tokens, name) {
  const i = tokens.findIndex((t) => t.toLowerCase() === name.toLowerCase());
  if (i < 0 || i + 3 >= tokens.length) return null;
  const value = toNumber(tokens[i + 1]);
  const chg = toNumber(tokens[i + 2]);
  const pct = toNumber(tokens[i + 3]);
  if (value === null) return null;
  const arrow = tokens[i + 3];
  const sign = /▼/.test(arrow) ? -1 : /▲/.test(arrow) ? 1 : 0;
  return {
    name, value,
    change: chg === null ? null : sign * chg || 0,
    changePct: pct === null ? null : sign * pct || 0,
    directionKnown: sign !== 0
  };
}

function parseIndexPage(tokens, fullText) {
  const warnings = [];
  const { asOfRaw, asOf, tradingDate } = parseAsOf(fullText);
  if (!asOf) warnings.push('Could not read the index "As of" timestamp.');
  const status = ((fullText || '').match(/MARKET\s*:\s*([A-Za-z ]+?)\s+As of/i) || [])[1] || null;

  const indices = {};
  for (const n of INDEX_NAMES) { const r = parseIndexRow(tokens, n); if (r) indices[n] = r; }
  if (!indices.PSEi) warnings.push('PSEi row not found.');

  return {
    ok: Boolean(indices.PSEi && asOf),
    source: 'pse-edge-index-page',
    asOfRaw, asOf, tradingDate,
    marketStatus: status ? status.trim().toUpperCase() : null,
    psei: indices.PSEi || null,
    indices,
    totals: {
      volume: toNumber(findValue(tokens, 'Total Volume', { numeric: true })),
      trades: toNumber(findValue(tokens, 'Total Trades', { numeric: true })),
      value: toNumber(findValue(tokens, 'Total Value', { numeric: true })),
      advances: toNumber(findValue(tokens, 'Advances', { numeric: true })),
      declines: toNumber(findValue(tokens, 'Declines', { numeric: true })),
      unchanged: toNumber(findValue(tokens, 'Unchanged', { numeric: true }))
    },
    warnings
  };
}
module.exports = { parseIndexPage };
