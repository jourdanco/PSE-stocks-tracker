'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseIndexPage } = require('../src/pse/parseIndex');

// Cells in page order from the real https://edge.pse.com.ph/index/form.do fetched 2026-10-22.
const TOKENS = ['Index', 'Value', 'Chg', '%Chg', 'PSEi', '5,779.73', '41.78', '0.72▼', 'All Shares', '3,220.96', '17.65', '0.55▼',
  'Financials', '1,799.02', '12.04', '0.67▼', 'Industrial', '7,405.13', '58.13', '0.78▼', 'Holding Firms', '4,325.25', '19.31', '0.44▼',
  'Services', '3,016.44', '25.32', '0.83▼', 'Mining and Oil', '18,962.36', '30.29', '0.16▲', 'Property', '1,831.45', '9.43', '0.51▼',
  'MARKET : CLOSED', 'As of Oct 22, 2026 4:37 PM', 'Total Volume', '1,282,327,703', 'Total Trades', '90,098', 'Total Value', '8,209,706,319',
  'Advances', '64', 'Declines', '108', 'Unchanged', '62'];
const TEXT = 'Index Summary PSEi 5,779.73 MARKET : CLOSED As of Oct 22, 2026 4:37 PM Total Volume 1,282,327,703';

test('parses the verified PSEi page', () => {
  const r = parseIndexPage(TOKENS, TEXT);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.psei.value, 5779.73);
  assert.strictEqual(r.psei.change, -41.78);       // arrow gives direction
  assert.strictEqual(r.psei.changePct, -0.72);
  assert.strictEqual(r.indices['Mining and Oil'].change, 30.29); // ▲ positive
  assert.strictEqual(r.marketStatus, 'CLOSED');
  assert.strictEqual(r.asOf, '2026-10-22T16:37:00+08:00');
  assert.strictEqual(r.tradingDate, '2026-10-22');
  assert.deepStrictEqual(r.totals, { volume: 1282327703, trades: 90098, value: 8209706319, advances: 64, declines: 108, unchanged: 62 });
});
test('missing PSEi row -> not ok, nothing invented', () => {
  const r = parseIndexPage(['Total Volume', '1'], 'MARKET : OPEN As of Oct 22, 2026 10:00 AM');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.psei, null);
});
