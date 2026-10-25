'use strict';
/** All time helpers use Asia/Manila (UTC+8, no daylight saving). */
const TZ = 'Asia/Manila';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
});
const displayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
});

function manilaParts(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  const hh = Number(p.hour) % 24;
  const mm = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hh, mm, minutes: hh * 60 + mm,
    weekday: p.weekday,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  };
}

const hhmmToMinutes = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
const isWeekend = (dateStr) => [0, 6].includes(dayOfWeek(dateStr));
const isTradingDay = (dateStr, holidays = new Set()) => !isWeekend(dateStr) && !holidays.has(dateStr);

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function inTradingWindow(now, { start, end }, holidays = new Set()) {
  const p = manilaParts(now);
  return isTradingDay(p.date, holidays) && p.minutes >= hhmmToMinutes(start) && p.minutes <= hhmmToMinutes(end);
}

/** Report is "due" from reportTime until reportTime + catch-up window (every day, incl. weekends). */
function reportDue(now, { reportTime, catchupMinutes }) {
  const p = manilaParts(now);
  const t = hhmmToMinutes(reportTime);
  return p.minutes >= t && p.minutes < t + catchupMinutes;
}

const toMDY = (dateStr) => { const [y, m, d] = dateStr.split('-'); return `${m}-${d}-${y}`; };
const epochSeconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const minutesOfDayManila = (iso) => manilaParts(new Date(iso)).minutes;

function fmtClock(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const fmtManila = (iso) => (iso ? displayFmt.format(new Date(iso)).replace(/(\d{4}),/, '$1') : 'n/a');

module.exports = {
  TZ, manilaParts, hhmmToMinutes, dayOfWeek, isWeekend, isTradingDay, addDays,
  inTradingWindow, reportDue, toMDY, epochSeconds, minutesOfDayManila, fmtClock, fmtManila
};
