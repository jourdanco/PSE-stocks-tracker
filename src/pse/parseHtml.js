'use strict';
const cheerio = require('cheerio');
const { parseStockData } = require('./parseCore');

/** Read the raw HTML into the "tokens" + page text that parseCore understands. */
function parseStockHtml(html, opts = {}) {
  const $ = cheerio.load(html);
  const tokens = [];
  $('th, td').each((_, el) => {
    tokens.push($(el).text().replace(/\s+/g, ' ').trim());
  });
  const fullText = $('body').text().replace(/\s+/g, ' ').trim();
  return parseStockData(tokens, fullText, opts);
}

module.exports = { parseStockHtml };
