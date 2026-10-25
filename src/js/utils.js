/**
 * Shared helpers used across the quiz application.
 * Kept as small, pure functions so they are easy to test and reuse.
 */

/**
 * Fisher-Yates (Knuth) shuffle.
 * Returns a NEW shuffled array and never mutates the input, so the
 * original question bank (and any external references) stay intact.
 *
 * @param {Array} items
 * @returns {Array}
 */
function shuffleArray(items) {
  const shuffled = Array.isArray(items) ? [...items] : [];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Picks `count` unique questions at random from a pool.
 * Because it shuffles first and then slices, duplicates cannot occur
 * and the original array is not modified.
 *
 * @param {Array} questions
 * @param {number} count
 * @returns {Array}
 */
function selectRandomQuestions(questions, count) {
  const pool = Array.isArray(questions) ? questions : [];
  const safeCount = Math.max(0, Math.min(Number(count) || 0, pool.length));

  return shuffleArray(pool).slice(0, safeCount);
}

/**
 * Interleaves an ordered list of question-like objects by their `type`,
 * preserving relative order within each type. Used for non-randomized
 * sessions so that "original order" mixes types (e.g. multiple-choice and
 * scramble) instead of returning only the first block of the bank.
 *
 * Items with no `type` are appended last in their original order.
 *
 * @param {Array} questions
 * @returns {Array}
 */
function interleaveByType(questions) {
  const list = Array.isArray(questions) ? questions : [];
  const groups = new Map();

  list.forEach((question) => {
    const key = question && question.type ? question.type : "";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(question);
  });

  const typedKeys = [...groups.keys()].filter((key) => key !== "");
  const result = [];
  let added = true;

  for (let i = 0; added; i += 1) {
    added = false;

    typedKeys.forEach((key) => {
      const group = groups.get(key);
      if (i < group.length) {
        result.push(group[i]);
        added = true;
      }
    });
  }

  if (groups.has("")) {
    result.push(...groups.get(""));
  }

  return result;
}

/**
 * Picks `count` questions while keeping a target mix of question types.
 *
 * The mix comes from the level's own composition: a level whose pool is
 * three quarters scramble produces rounds that are about three quarters
 * scramble too. Questions are drawn from each type group without
 * replacement, and the shortfall is backfilled from the other group so the
 * requested count is always met (as long as the pool is big enough).
 *
 * @param {Array}  questions    Pool of questions.
 * @param {number} count        How many questions to use.
 * @param {object} [options]
 * @param {number} [options.scrambleRatio] Share of the round that should be scramble (0 - 1).
 * @param {boolean}[options.randomize]      Shuffle the selection (false keeps bank order).
 * @returns {Array}
 */
function selectQuestionsByMix(questions, count, { scrambleRatio = 0, randomize = true } = {}) {
  const pool = Array.isArray(questions) ? questions : [];
  const total = Math.max(0, Math.min(Number(count) || 0, pool.length));

  if (total === 0) {
    return [];
  }

  const scrambles = pool.filter((question) => question && question.type === "scramble");
  const others = pool.filter((question) => question && question.type !== "scramble");

  const ratio = Math.min(1, Math.max(0, Number(scrambleRatio) || 0));

  let wantScramble = Math.min(Math.round(total * ratio), scrambles.length);
  let wantOther = Math.min(total - wantScramble, others.length);

  // Backfill from the other group when one of them ran out.
  let shortfall = total - wantScramble - wantOther;

  if (shortfall > 0) {
    const extra = Math.min(shortfall, scrambles.length - wantScramble);
    wantScramble += extra;
    shortfall -= extra;
  }

  if (shortfall > 0) {
    wantOther += Math.min(shortfall, others.length - wantOther);
  }

  const pickedScramble = randomize
    ? shuffleArray(scrambles).slice(0, wantScramble)
    : scrambles.slice(0, wantScramble);

  const pickedOther = randomize
    ? shuffleArray(others).slice(0, wantOther)
    : others.slice(0, wantOther);

  const picked = [...pickedScramble, ...pickedOther];

  return randomize ? shuffleArray(picked) : interleaveByType(picked);
}

/**
 * Normalizes a free-text answer for comparison:
 * lowercases, trims, collapses whitespace, and strips punctuation.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeAnswer(value) {
  return String(value === null || value === undefined ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats seconds as M:SS for the timer display.
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
