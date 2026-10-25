'use strict';
/**
 * Decide what a freshly parsed quote means, given the last stored state ("prev").
 * Pure function: no network, no database.
 *
 * Rules (the "As of" timestamp is the freshness signal):
 *  - quote not ok                         -> invalid        (nothing is stored)
 *  - new trading session / no prev        -> baseline       (first observation of the session)
 *  - asOf older than stored               -> out_of_order   (cached/old page; ignored)
 *  - asOf same as stored:
 *        price changed AND volume rose    -> price_change   (timeVerified=false: trades happened but the stamp didn't move)
 *        otherwise                        -> stale          (NOT a new market observation)
 *  - asOf newer than stored:
 *        price changed                    -> price_change   (timeVerified=true)
 *        price same                       -> heartbeat      (fresh data, no price change => no observation record)
 * A failed fetch never reaches this function, so a failure can never look like a price change.
 */
const { epochSeconds } = require('../time');

function decide({ prev, quote, collectedAt, ticker }) {
  if (!quote || !quote.ok || !(quote.last > 0)) return { action: 'invalid', reason: 'quote not ok' };

  const asOfEpoch = epochSeconds(quote.asOf);
  const sameSession = prev && prev.tradingDate === quote.tradingDate;

  if (prev && prev.tradingDate > quote.tradingDate) return { action: 'out_of_order', reason: 'older trading date than stored' };

  const mkObservation = (timeVerified, previousPrice) => {
    const collectedEpoch = epochSeconds(collectedAt);
    const id = timeVerified
      ? `${ticker}_${quote.tradingDate}_${asOfEpoch}`
      : `${ticker}_${quote.tradingDate}_${asOfEpoch}_u${collectedEpoch}`;
    const change = previousPrice != null ? Math.round((quote.last - previousPrice) * 10000) / 10000 : null;
    return {
      id, ticker, tradingDate: quote.tradingDate,
      price: quote.last, previousPrice: previousPrice ?? null, changeFromPrevious: change,
      volume: quote.volume, value: quote.value,
      sourceAsOf: quote.asOf, sourceAsOfEpoch: asOfEpoch,
      observedAt: timeVerified ? quote.asOf : collectedAt, // time used on charts
      timeVerified, collectedAt, source: 'pse-edge-stock-page'
    };
  };

  if (!sameSession) {
    return { action: 'baseline', reason: prev ? 'new trading session' : 'first observation', observation: mkObservation(true, null) };
  }

  if (asOfEpoch < prev.asOfEpoch) return { action: 'out_of_order', reason: 'asOf older than stored' };

  if (asOfEpoch === prev.asOfEpoch) {
    if (quote.last !== prev.last && (quote.volume ?? 0) > (prev.volume ?? 0)) {
      return { action: 'price_change', reason: 'price+volume moved but asOf did not', observation: mkObservation(false, prev.last) };
    }
    return { action: 'stale', reason: 'asOf unchanged' };
  }

  if (quote.last !== prev.last) {
    return { action: 'price_change', reason: 'price changed', observation: mkObservation(true, prev.last) };
  }
  return { action: 'heartbeat', reason: 'new asOf, same price' };
}

module.exports = { decide };
