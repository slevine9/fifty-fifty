// Optional source: ask Claude to write fresh two-option questions in the style of
// "What's the most popular sport in America? Football or soccer."
// Enable with QUESTION_SOURCES=opentdb,claude (or just claude) and ANTHROPIC_API_KEY.
//
// Heads up: LLM-written trivia can contain mistakes. Consider reviewing a day's set before it goes live
// (see README "Reviewing questions").
const config = require('../config');
const { makeQuestion } = require('./util');

const SYSTEM = `You write trivia for a daily game called Fifty Fifty. Every question has exactly two answer choices:
one correct, one wrong but plausible. Rules:
- Questions must have a single, objectively verifiable answer that will not change over time.
- No opinion questions, no "which is better", no trick wording.
- Mix of topics: sports, history, geography, science, food, pop culture, nature, everyday life, "most popular / largest / first" comparisons.
- Order from easy (most people get it) to hard (a coin flip for most people).
- Keep each question under 140 characters and each option under 40 characters.
- The wrong option should be tempting, not absurd.
Return ONLY a JSON array, no prose, no code fences. Each item: {"q": string, "correct": string, "wrong": string, "category": string}`;

async function fetchQuestions(count, { avoid = [] } = {}) {
  if (!config.anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

  const today = new Date().toISOString().slice(0, 10);
  const user = `Write ${count} questions for ${today}. Make them different from these recent ones:\n${avoid.slice(0, 40).map((q) => `- ${q}`).join('\n') || '(none)'}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const items = JSON.parse(text.replace(/^```(?:json)?|```$/gm, '').trim());

  return items
    .filter((i) => i && i.q && i.correct && i.wrong && i.correct !== i.wrong)
    .map((i) => makeQuestion({ ...i, source: 'claude' }));
}

module.exports = { fetchQuestions, name: 'claude' };
