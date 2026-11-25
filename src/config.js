const path = require('node:path');

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

// QUESTION_MIX = "source:count,source:count". Counts are relative shares of the day's chain.
// Sources: opentdb, flags, dogs, wiki, versus, history, claude, seed
const DEFAULT_MIX = 'opentdb:14,flags:6,dogs:4,wiki:6,versus:6,history:4';
const mix = Object.fromEntries(
  (process.env.QUESTION_MIX || DEFAULT_MIX).split(',').map((p) => p.trim().split(':')).filter((p) => p[0])
    .map(([k, v]) => [k, int(v, 1)]),
);
const mixTotal = Object.values(mix).reduce((a, b) => a + b, 0);

module.exports = {
  port: int(process.env.PORT, 3000),
  timezone: process.env.GAME_TIMEZONE || 'America/New_York',
  timeLimit: int(process.env.QUESTION_TIME_LIMIT, 15),
  graceMs: 1500, // network slack on top of the time limit
  leadMs: 1500,  // each question's clock starts this long after it's served, covering reveal/transition animations
  questionsPerDay: int(process.env.QUESTIONS_PER_DAY, mixTotal),
  mix,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  adminToken: process.env.ADMIN_TOKEN || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
};
