'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseStockData, parseAsOf, parseChange, parsePrevClose } = require('../src/pse/parseCore');

// Cells copied (in order) from the real SM page fetched on 2026-10-22 (data "As of Oct 21, 2026 02:50 PM").
const SM_TOKENS = [
  'Status', 'Open', 'Market Capitalization', '671,098,285,500.00',
  'Issue Type', 'Common', 'Outstanding Shares', '1,209,186,100',
  'ISIN', 'PHY806761029', 'Listed Shares', '1,226,114,578',
  'Listing Date', 'Mar 22, 2005', 'Issued Shares', '1,233,154,140',
  'Board Lot', '10', 'Free Float Level(%)', '46.76%',
  'Par Value', '10.00', 'Foreign Ownership Limit(%)', '40%',
  'Last Traded Price', '550.00', 'Open', '555.00', 'Previous Close and Date', '555.00  (Oct 20, 2026)',
  'Change(% Change)', 'down   5.00  ( 0.90%)', 'High', '557.50', 'P/E Ratio', '',
  'Value', '115,575,185.00', 'Low', '545.00', 'Sector P/E Ratio', '',
  'Volume', '210,300', 'Average Price', '549.57', 'Book Value', '',
  '52-Week High', '757.50', '52-Week Low', '486.20', 'P/BV Ratio', ''
];
const SM_TEXT = 'SM Investments Corporation SM As of Oct 21, 2026 02:50 PM Stock Data';

test('parses the verified SM page layout', () => {
  const q = parseStockData(SM_TOKENS, SM_TEXT, { expectedTicker: 'SM' });
  assert.strictEqual(q.ok, true);
  assert.strictEqual(q.last, 550);
  assert.strictEqual(q.open, 555); // price "Open", not the status "Open"
  assert.strictEqual(q.status, 'Open');
  assert.strictEqual(q.high, 557.5);
  assert.strictEqual(q.low, 545);
  assert.strictEqual(q.change, -5);
  assert.strictEqual(q.changePct, -0.9);
  assert.strictEqual(q.changeSource, 'source');
  assert.strictEqual(q.prevClose, 555);
  assert.strictEqual(q.prevCloseDate, '2026-10-20');
  assert.strictEqual(q.volume, 210300);
  assert.strictEqual(q.value, 115575185);
  assert.strictEqual(q.week52High, 757.5);
  assert.strictEqual(q.asOf, '2026-10-21T14:50:00+08:00');
  assert.strictEqual(q.tradingDate, '2026-10-21');
  assert.deepStrictEqual(q.warnings, []);
});

test("parseAsOf handles AM/PM and 12 o'clock", () => {
  assert.strictEqual(parseAsOf('As of Jan 05, 2027 12:15 PM').asOf, '2027-01-05T12:15:00+08:00');
  assert.strictEqual(parseAsOf('As of Jan 05, 2027 12:15 AM').asOf, '2027-01-05T00:15:00+08:00');
  assert.strictEqual(parseAsOf('nothing here').asOf, null);
});

test('parseChange handles up, down and zero', () => {
  assert.deepStrictEqual(parseChange('up 1.50 ( 0.30%)'), { change: 1.5, changePct: 0.3 });
  assert.deepStrictEqual(parseChange('down 1.50 ( 0.30%)'), { change: -1.5, changePct: -0.3 });
  assert.deepStrictEqual(parseChange('0.00 ( 0.00%)'), { change: 0, changePct: 0 });
  assert.deepStrictEqual(parseChange(''), { change: null, changePct: null });
});

test('missing data is never invented', () => {
  const q = parseStockData(['Last Traded Price', '', 'Open', ''], 'As of Oct 21, 2026 02:50 PM SM');
  assert.strictEqual(q.ok, false);
  assert.strictEqual(q.last, null);
  assert.strictEqual(q.high, null);
  assert.ok(q.warnings.length > 0);
});

test('change is marked "calculated" when PSE does not provide it', () => {
  const tokens = ['Last Traded Price', '110.00', 'Previous Close and Date', '100.00 (Oct 20, 2026)', 'Change(% Change)', ''];
  const q = parseStockData(tokens, 'As of Oct 21, 2026 02:50 PM');
  assert.strictEqual(q.change, 10);
  assert.strictEqual(q.changePct, 10);
  assert.strictEqual(q.changeSource, 'calculated');
});

test('wrong cmpyId is flagged when the ticker is missing from the page', () => {
  const q = parseStockData(SM_TOKENS, SM_TEXT, { expectedTicker: 'BDO' });
  assert.ok(q.warnings.some((w) => w.includes('BDO')));
});

test('parsePrevClose', () => {
  assert.deepStrictEqual(parsePrevClose('555.00  (Oct 20, 2026)'), { price: 555, date: '2026-10-20' });
});
