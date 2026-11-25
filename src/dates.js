// All "what day is it" logic lives here so the midnight rollover is defined in one place.
const { timezone } = require('./config');

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** YYYY-MM-DD in the game timezone. */
function todayKey(now = new Date()) {
  return dateFmt.format(now);
}

/** Milliseconds until the next midnight in the game timezone (off by an hour on DST change days; display only). */
function msUntilReset(now = new Date()) {
  const [h, m, s] = timeFmt.format(now).split(':').map(Number);
  return 86_400_000 - (h * 3600 + m * 60 + s) * 1000;
}

/** Hour (0-23) in the game timezone. */
function currentHour(now = new Date()) {
  return Number(timeFmt.format(now).split(':')[0]);
}

function tomorrowKey(now = new Date()) {
  return todayKey(new Date(now.getTime() + msUntilReset(now) + 60_000));
}

module.exports = { todayKey, tomorrowKey, msUntilReset, currentHour };
