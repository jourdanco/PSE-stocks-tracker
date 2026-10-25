'use strict';

const DEFAULTS = {
  baseUrl: process.env.PSE_BASE_URL || 'https://edge.pse.com.ph',
  userAgent: process.env.PSE_USER_AGENT || 'PersonalStockTracker/0.1 (personal use)',
  timeoutMs: Number(process.env.PSE_REQUEST_TIMEOUT_MS || 15000)
};

/** Download one company's "Stock Data" page. Throws on network/HTTP errors. */
async function fetchStockPage(cmpyId, options = {}) {
  const { baseUrl, userAgent, timeoutMs } = { ...DEFAULTS, ...options };
  const url = `${baseUrl}/companyPage/stockData.do?cmpy_id=${encodeURIComponent(cmpyId)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`PSE Edge returned HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return { url, html, fetchedAt: new Date().toISOString(), httpStatus: res.status };
}

/** Download the "Index Summary" page (PSEi, sector indices, market totals). */
async function fetchIndexPage(options = {}) {
  const { baseUrl, userAgent, timeoutMs } = { ...DEFAULTS, ...options };
  const url = `${baseUrl}/index/form.do`;
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'text/html', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`PSE Edge returned HTTP ${res.status} for ${url}`);
  return { url, html: await res.text(), fetchedAt: new Date().toISOString(), httpStatus: res.status };
}

module.exports = { fetchStockPage, fetchIndexPage };
