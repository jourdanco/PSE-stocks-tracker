'use strict';
const fs = require('fs');
const path = require('path');
const { manilaParts, addDays } = require('../time');
const { buildLineOption, buildCandleOption } = require('../charts/options');
const { buildEmail } = require('../email/template');
const { withRetry } = require('../email/sender');

const cidOf = (kind, ticker) => `${kind}-${ticker}`.replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * Build and (if allowed) send the daily report.
 *  - TEST MODE (default): builds the email and saves a preview in ./debug. Sends nothing, records nothing.
 *  - REAL MODE: first claims the date in the database (so two triggers cannot both send),
 *    sends with retries, then records success. A failed chart never blocks the email.
 */
async function runReport({ repo, config, deps, date, now = () => new Date(), log = console }) {
  const reportDate = date || manilaParts(now()).date;
  const testMode = config.email.testMode;

  if (!testMode) {
    const claim = await repo.claimReport(reportDate, now().getTime(), { maxAttempts: config.report.maxAttempts });
    if (!claim.ok) return { status: 'skipped', reason: claim.reason, date: reportDate };
  }

  try {
    const notes = [];
    const watchlist = config.getWatchlist().filter((s) => s.cmpyId);

    // 1) Freshest market-wide data; fall back to the last stored snapshot.
    let psei = null;
    try { const r = await deps.collectPsei(); psei = r && r.snapshot ? r.snapshot : null; } catch (e) { log.error('[report] PSEi refresh failed:', e.message); }
    if (!psei) { psei = await repo.getLatestPsei(); if (psei) notes.push(`PSEi figures are the last stored snapshot (${psei.tradingDate}), a fresh read failed.`); }

    // 2) Make sure daily OHLC is as final as possible.
    try { if (deps.refreshHistory) await deps.refreshHistory(); } catch (e) { notes.push('Daily OHLC refresh failed; candlesticks use the last stored records.'); }

    // 3) Gather stored data and render charts. Every chart is isolated in its own try/catch.
    const stocks = [];
    const attachments = [];
    for (const w of watchlist) {
      const latest = await repo.getLatest(w.ticker);
      const sessionDate = latest ? latest.tradingDate : null;
      const to = sessionDate || reportDate;
      const from = addDays(to, -config.report.chartPeriodDays);
      const observations = sessionDate ? await repo.listObservations(w.ticker, sessionDate) : [];
      const daily = await repo.listDaily(w.ticker, from, to);
      const entry = { ticker: w.ticker, name: w.name, latest, dailyLatest: daily[daily.length - 1] || null };

      try {
        const png = deps.renderPng(buildLineOption({ ticker: w.ticker, name: w.name, tradingDate: sessionDate, observations }), { width: 640, height: 340 });
        entry.lineCid = cidOf('line', w.ticker);
        attachments.push({ filename: `${entry.lineCid}.png`, content: png, cid: entry.lineCid, contentType: 'image/png' });
      } catch (e) { entry.lineError = e.message; notes.push(`Intraday chart for ${w.ticker} failed: ${e.message}`); }

      try {
        const png = deps.renderPng(buildCandleOption({ ticker: w.ticker, name: w.name, rows: daily, periodLabel: `${from} to ${to}` }), { width: 640, height: 420 });
        entry.candleCid = cidOf('candle', w.ticker);
        attachments.push({ filename: `${entry.candleCid}.png`, content: png, cid: entry.candleCid, contentType: 'image/png' });
      } catch (e) { entry.candleError = e.message; notes.push(`Candlestick chart for ${w.ticker} failed: ${e.message}`); }

      if (latest && latest.tradingDate < reportDate) notes.push(`${w.ticker}: no newer session than ${latest.tradingDate}; showing the most recent available session.`);
      stocks.push(entry);
    }

    const email = buildEmail({ date: reportDate, psei, stocks, notes });

    // 4a) Test mode: preview only.
    if (testMode) {
      const dir = path.join(config.root, 'debug');
      const assets = path.join(dir, 'preview-assets');
      fs.mkdirSync(assets, { recursive: true });
      let html = email.html;
      for (const a of attachments) {
        fs.writeFileSync(path.join(assets, a.filename), a.content);
        html = html.split(`cid:${a.cid}`).join(`preview-assets/${a.filename}`);
      }
      const file = path.join(dir, `report-preview-${reportDate}.html`);
      fs.writeFileSync(file, html);
      fs.writeFileSync(path.join(dir, `report-preview-${reportDate}.txt`), email.text);
      return { status: 'preview', date: reportDate, file, charts: attachments.length, notes };
    }

    // 4b) Real send with retries.
    const sent = await withRetry(() => deps.sendEmail({
      apiKey: config.email.apiKey, from: config.email.from, to: config.email.to,
      subject: email.subject, html: email.html, text: email.text, attachments
    }), { log });
    await repo.markReportSent(reportDate, { messageId: sent.id, charts: attachments.length, notes });
    return { status: 'sent', date: reportDate, messageId: sent.id, charts: attachments.length, notes };
  } catch (e) {
    log.error('[report] failed:', e.message);
    if (!testMode) { try { await repo.markReportFailed(reportDate, e.message); } catch (e2) { log.error('[report] could not record failure:', e2.message); } }
    return { status: 'failed', date: reportDate, error: e.message };
  }
}

module.exports = { runReport };
