'use strict';
/** Resend REST API (verified: attachments use content_id for inline CID images; content is base64). */
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendEmail({ apiKey, from, to, subject, html, text, attachments = [] }, fetchImpl = fetch) {
  if (!apiKey) throw Object.assign(new Error('RESEND_API_KEY is not set'), { retryable: false });
  if (!to) throw Object.assign(new Error('EMAIL_TO is not set'), { retryable: false });
  let res;
  try {
    res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to], subject, html, text,
        attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType || 'image/png', content_id: a.cid }))
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (e) { throw Object.assign(new Error(`Network error sending email: ${e.message}`), { retryable: true }); }

  let body = {};
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(`Resend HTTP ${res.status}: ${body.message || JSON.stringify(body).slice(0, 200)}`);
    err.retryable = res.status === 429 || res.status >= 500;
    err.status = res.status;
    throw err;
  }
  return { id: body.id };
}

/** Retry only errors that can succeed later (network, 429, 5xx). Never retries bad keys / validation errors. */
async function withRetry(fn, { attempts = 3, baseDelayMs = 2000, sleep = sleepDefault, log = console } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) {
      lastErr = e;
      if (!e.retryable || i === attempts) break;
      const wait = baseDelayMs * 2 ** (i - 1);
      log.error(`[email] attempt ${i} failed (${e.message}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

module.exports = { sendEmail, withRetry };
