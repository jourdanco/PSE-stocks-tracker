'use strict';
/** ECharts -> SVG (server-side) -> PNG (resvg). Heavy libraries load only when a chart is really rendered. */
const path = require('path');
const FONT_FILES = [path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf'), path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf')];

function renderPng(option, { width = 640, height = 340, scale = 2 } = {}) {
  const echarts = require('echarts');
  const { Resvg } = require('@resvg/resvg-js');
  const { _meta, ...clean } = option; // _meta is for our tests only
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption(clean);
    const svg = chart.renderToSVGString();
    const resvg = new Resvg(svg, {
      background: '#ffffff',
      fitTo: { mode: 'width', value: width * scale },
      font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' }
    });
    return resvg.render().asPng();
  } finally { chart.dispose(); }
}
module.exports = { renderPng };
