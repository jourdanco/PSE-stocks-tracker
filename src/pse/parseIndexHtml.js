'use strict';
const cheerio = require('cheerio');
const { parseIndexPage } = require('./parseIndex');

function parseIndexHtml(html) {
  const $ = cheerio.load(html);
  const tokens = [];
  $('th, td').each((_, el) => tokens.push($(el).text().replace(/\s+/g, ' ').trim()));
  return parseIndexPage(tokens, $('body').text().replace(/\s+/g, ' ').trim());
}
module.exports = { parseIndexHtml };
