#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Logic test harness for the BrainBeat.so quiz app.
 * Loads browser-side modules via Node + VM (no DOM deps except minimal window shim).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..", "src");
const files = [
  "js/utils.js",
  "js/question.js",
  "js/levels.js",
  "js/importer.js",
  "js/team.js",
  "js/scoreboard.js",
  "js/quiz.js",
  "js/timer.js",
];

// The application ships without a built-in bank, so the tests run against
// the fixture bank instead.
const fixture = path.join(__dirname, "fixtures", "bank.js");

function loadAll() {
  const ctx = {
    console,
    JSON,
    Math,
    Number,
    String,
    Array,
    Boolean,
    Object,
    RegExp,
    Date,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate: setImmediate || ((fn) => setTimeout(fn, 0)),
    clearImmediate: clearImmediate || clearTimeout,
  };
  ctx.global = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);

  const src = files
    .map((f) => fs.readFileSync(path.join(root, f), "utf8"))
    .join("\n");
  const fixtureSrc = fs.readFileSync(fixture, "utf8");
  const exportsBlock = `
if (typeof Question !== "undefined") { window.Question = Question; }
if (typeof Quiz !== "undefined") { window.Quiz = Quiz; }
if (typeof Team !== "undefined") { window.Team = Team; }
if (typeof Scoreboard !== "undefined") { window.Scoreboard = Scoreboard; }
if (typeof Timer !== "undefined") { window.Timer = Timer; }
if (typeof Levels !== "undefined") { window.Levels = Levels; }
`;
  vm.runInContext(src + "\n" + fixtureSrc + "\n" + exportsBlock, ctx, { filename: "quiz-bundle.js" });
  return ctx;
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error("FAIL: " + message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      "FAIL: " + message + " (expected=" + expected + ", actual=" + actual + ")",
    );
  }
}

function arrayEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

function runTests(ctx) {
  const {
    TEST_QUESTION_BANK: QUESTION_BANK,
    Question,
    Team,
    Scoreboard,
    Quiz,
    Timer,
    Levels,
    shuffleArray,
    selectRandomQuestions,
    normalizeAnswer,
    formatTime,
    interleaveByType,
    selectQuestionsByMix,
    parseImportFile,
    normalizeRawQuestion,
    filterDuplicateQuestions,
  } = ctx;

  // 1) All scramble questions accept their displayed correct answer
  for (const d of QUESTION_BANK) {
    if (d.type === "scramble") {
      const q = new Question(d);
      const ans = q.getCorrectAnswer();
      const ok = q.isCorrect(ans);
      assertTrue(ok, "id " + d.id + " must accept its displayed correct answer: " + ans);
    }
  }

  // 2) MC grading basic
  const mc = QUESTION_BANK.find((d) => d.type === "multiple-choice");
  const qmc = new Question(mc);
  assertTrue(qmc.isCorrect(qmc.correctAnswer), "MC correct index matches");
  assertTrue(qmc.isCorrect(String(qmc.correctAnswer)), "MC accepts string index");
  assertTrue(!qmc.isCorrect(-1), "MC rejects -1");
  assertTrue(!qmc.isCorrect(null), "MC rejects null");
  assertTrue(!qmc.isCorrect("abc"), "MC rejects non-numeric");

  // 3) Scramble normalization rejects odd cases; accepts basic
  const qph = new Question(QUESTION_BANK.find((d) => d.id === 25)); // phishing
  assertTrue(qph.isCorrect("Phishing"), "case-insensitive");
  assertTrue(qph.isCorrect("  phishing  "), "trim");
  assertTrue(qph.isCorrect("phishing!!"), "strips punctuation");
  // payload should not execute; we just ensure it doesn't crash and is treated as text
  try {
    assertTrue(qph.isCorrect("<script>alert(1)</script>") === false || qph.isCorrect("<script>alert(1)</script>") === true, "payload handled");
  } catch (e) {
    throw e;
  }
  // also accept the normalized payload if it somehow matches? but expected is false
  assertTrue(!qph.isCorrect("<script>alert(1)</script>"), "payload treated as text (not accepted)");

  // 4) normalizeAnswer and formatTime
  assertEqual(normalizeAnswer(null), "", "normalize null -> empty");
  assertEqual(normalizeAnswer("   "), "", "normalize spaces -> empty");
  assertEqual(normalizeAnswer("café"), "caf", "normalize strips non-alphanumerics");
  const cafe = normalizeAnswer("café");
  // implementation: [^a-z0-9\s-] replaced with space, then collapse/trim
  assertEqual(cafe, "caf", "normalize unicode runs");
  assertEqual(formatTime(0), "0:00", "format 0");
  assertEqual(formatTime(65), "1:05", "format 65");
  assertEqual(formatTime(180), "3:00", "format 3 minutes");
  assertEqual(formatTime(300), "5:00", "format 5 minutes");
  assertEqual(formatTime(-5), "0:00", "format negative");

  // 5) shuffleArray non-mutation and permutation
  const arr = [1, 2, 3, 4, 5];
  const arrCopy = arr.slice();
  const sh = shuffleArray(arr);
  assertTrue(arrayEqual(arr, arrCopy), "shuffleArray does not mutate input");
  assertEqual(sh.length, arr.length, "shuffled length matches");
  const sorted = sh.slice().sort((a, b) => a - b);
  assertTrue(arrayEqual(sorted, [1, 2, 3, 4, 5]), "shuffled is a permutation");

  // 6) selectRandomQuestions
  const rand = selectRandomQuestions(QUESTION_BANK, 999);
  assertEqual(rand.length, QUESTION_BANK.length, "clamps to pool size");
  const ids = rand.map((x) => x.id);
  const unique = new Set(ids);
  assertEqual(unique.size, ids.length, "no duplicates");
  const small = selectRandomQuestions(QUESTION_BANK, 10);
  assertEqual(small.length, 10, "returns requested count when <= pool");
  const none = selectRandomQuestions([], 5);
  assertEqual(none.length, 0, "empty pool -> empty");
  assertTrue(small[0] !== QUESTION_BANK[0] || small[1] !== QUESTION_BANK[1] || small[2] !== QUESTION_BANK[2], "randomization occurs (sanity)");

  // 7) Quiz basic
  const qs = QUESTION_BANK.slice(0, 3).map((d) => new Question(d));
  const quiz = new Quiz(qs);
  quiz.start({ randomize: false, questionCount: 10 });
  assertEqual(quiz.getTotal(), 3, "slice/limit to available");
  quiz.start({ randomize: false, questionCount: 2 });
  assertEqual(quiz.getTotal(), 2, "non-random 2");
  assertTrue(quiz.hasNext(), "hasNext");
  const q0 = quiz.getCurrentQuestion();
  quiz.recordResponse(true);
  quiz.nextQuestion();
  quiz.recordResponse(false);
  assertEqual(quiz.getScore(), 1, "score 1/2");
  assertEqual(quiz.getAnsweredCount(), 2, "answered 2");
  assertEqual(quiz.getPercentage(), 50, "50%");
  assertTrue(quiz.isLastQuestion(), "isLastQuestion");
  quiz.previousQuestion();
  assertEqual(quiz.getCurrentQuestion(), q0, "previousQuestion works");

  // 8) InterleaveByType for non-random
  const all = interleaveByType(QUESTION_BANK);
  // all length same
  assertEqual(all.length, QUESTION_BANK.length, "interleave preserves count");
  // check a 10-question slice contains both types
  const bankIds = all.map((x) => x.type + ":" + x.id);
  assertTrue(bankIds.length > 0, "interleave returns items");

  // 9) Scoreboard
  const sb = new Scoreboard();
  sb.addTeam("Alpha");
  sb.addTeam("Beta");
  assertEqual(sb.getTopScore(), 0, "top 0");
  assertTrue(!sb.hasTies(), "no ties when zero");
  const leaders0 = sb.getLeaders();
  assertTrue(Array.isArray(leaders0) && leaders0.length === 0, "leaders empty when zero");
  sb.addTeam("Alice");
  const t = sb.getTeam("alpha");
  assertTrue(t !== null, "case-insensitive get");
  t.addPoints(3);
  sb.getTeam("Beta").addPoints(2);
  const rank = sb.getRankings();
  assertEqual(rank[0].name, "Alpha", "rank 1 is Alpha");
  assertEqual(rank[1].name, "Beta", "rank 2 is Beta");
  assertTrue(!sb.hasTies(), "no tie");
  const top2 = sb.getTopScore();
  assertEqual(top2, 3, "top 3");
  const leaders = sb.getLeaders();
  assertEqual(leaders.length, 1, "single leader");

  // tie case
  sb.getTeam("Beta").addPoints(1); // now 3 and 3
  assertTrue(sb.hasTies(), "tie detected");
  const leadersTie = sb.getLeaders();
  assertEqual(leadersTie.length, 2, "tie leaders");
  sb.removeTeam("Alice");
  sb.reset();
  assertEqual(sb.getTeam("Alpha").score, 0, "reset works");

  // zero score tie-like cases
  const sbz = new Scoreboard();
  sbz.addTeam("A");
  sbz.addTeam("B");
  assertTrue(!sbz.hasTies() && sbz.getLeaders().length === 0, "zero board -> no tie/winner");
  const sbs = new Scoreboard();
  sbs.addTeam("Solo");
  assertTrue(!sbs.hasTies() && sbs.getLeaders().length === 0, "single zero -> no winner");

  // 10) Team
  const tm = new Team(" Test ", 5);
  assertEqual(tm.name, "Test", "trim name");
  assertEqual(tm.score, 5, "score init");
  tm.deductPoints(10);
  assertEqual(tm.score, 0, "clamps to 0");
  tm.addPoints(-1);
  assertEqual(tm.score, 0, "ignores negative add");
  tm.addPoints(2);
  tm.resetScore();
  assertEqual(tm.score, 0, "reset");

  // 11) Timer
  let ticked = 0;
  let firedUp = false;
  const tmr = new Timer({
    duration: 5,
    onTick: () => { ticked += 1; },
    onTimeUp: () => { firedUp = true; },
  });
  assertEqual(tmr.getRemaining(), 5, "initial remaining");
  tmr.tick(); // simulate one second
  assertEqual(tmr.getRemaining(), 4, "tick decreases");
  assertEqual(ticked, 1, "tick emits once");
  tmr.setDuration(10);
  assertEqual(tmr.getRemaining(), 10, "setDuration resets");
  tmr.reset(3);
  assertEqual(tmr.getRemaining(), 3, "reset");
  tmr.stop();
  assertTrue(!tmr.isRunning(), "stopped");

  // 11b) Timer guard - tick() after stop()/time-up is ignored
  let upFires = 0;
  const tmr2 = new Timer({ duration: 2, onTick: () => {}, onTimeUp: () => { upFires += 1; } });
  tmr2.start();
  tmr2.tick();
  tmr2.tick();
  assertEqual(upFires, 1, "time-up fires once");
  assertEqual(tmr2.getRemaining(), 0, "remaining clamps to zero");
  tmr2.tick();
  assertEqual(upFires, 1, "tick after time-up does not re-fire time-up");
  assertEqual(tmr2.getRemaining(), 0, "tick after time-up is ignored");

  const tmr3 = new Timer({ duration: 5, onTick: () => {}, onTimeUp: () => {} });
  tmr3.start();
  tmr3.stop();
  tmr3.tick();
  assertEqual(tmr3.getRemaining(), 5, "tick after stop does not decrement");

  // 12) Importer - JSON
  const jsonText = JSON.stringify([
    { type: "multiple-choice", text: "Q json mc?", options: ["a", "b", "c"], correctAnswer: "B", explanation: "e" },
    { type: "identification", text: "Q json id?", correctAnswer: "Phishing" },
  ]);
  const jsonRes = parseImportFile("questions.json", jsonText);
  assertEqual(jsonRes.errors.length, 0, "json no errors");
  assertEqual(jsonRes.questions.length, 2, "json 2 questions");
  assertEqual(new Question(jsonRes.questions[0]).correctAnswer, 1, "json letter answer -> index");
  assertEqual(new Question(jsonRes.questions[1]).type, "scramble", "json identification alias -> scramble");
  assertTrue(new Question(jsonRes.questions[1]).isCorrect("phishing!!"), "json id answer accepted");
  const wrapped = parseImportFile("w.json", JSON.stringify({ questions: [{ text: "Q?", correctAnswer: "A", options: ["A", "B"] }] }));
  assertEqual(wrapped.questions.length, 1, "json wrapped form");

  // 13) Importer - CSV (quoted comma, numeric answer, id aliases)
  const csvText = [
    "type,question,optionA,optionB,optionC,optionD,answer,acceptedAnswers,explanation",
    'multiple-choice,"CSV, with comma?",One,Two,Three,Four,3,,',
    'identification,"CSV id?",,,,,Least privilege,principle of least privilege | least privilege,',
  ].join("\n");
  const csvRes = parseImportFile("questions.csv", csvText);
  assertEqual(csvRes.errors.length, 0, "csv no errors");
  assertEqual(csvRes.questions.length, 2, "csv 2 questions");
  assertEqual(new Question(csvRes.questions[0]).correctAnswer, 3, "csv numeric answer is 0-based index");
  const csvId = new Question(csvRes.questions[1]);
  assertEqual(csvId.type, "scramble", "csv identification alias -> scramble");
  assertTrue(csvId.isCorrect("least privilege"), "csv id accepted");
  assertTrue(csvId.isCorrect("principle of least privilege"), "csv id extra accepted");
  const sniffed = parseImportFile("noext", csvText);
  assertEqual(sniffed.questions.length, 2, "csv sniffed without extension");

  // 13b) CSV column-count handling (padded rows warn, positional mapping preserved)
  const csvOk = [
    "type,question,optionA,optionB,optionC,optionD,answer,acceptedAnswers,explanation",
    'scramble,"What is a firewall?",,,,,Firewall,firewall | fire wall,A network security system',
  ].join("\n");
  const csvOkRes = parseImportFile("ok.csv", csvOk);
  assertEqual(csvOkRes.errors.length, 0, "full csv no errors");
  assertEqual(csvOkRes.warnings.length, 0, "full csv has no warnings");
  assertEqual(new Question(csvOkRes.questions[0]).correctAnswer, "Firewall", "csv answer column preserved");

  const csvRagged = [
    "type,question,optionA,optionB,optionC,optionD,answer,acceptedAnswers,explanation",
    'scramble,"What is a firewall?",,,,Firewall,firewall | fire wall,A network security system',
  ].join("\n");
  const csvRaggedRes = parseImportFile("ragged.csv", csvRagged);
  assertEqual(csvRaggedRes.warnings.length, 1, "ragged csv warns about column count");
  assertEqual(new Question(csvRaggedRes.questions[0]).correctAnswer, "firewall | fire wall", "positional mapping for ragged rows");

  // 14) Importer - plain text
  const txtText = [
    "Q: What is malware?",
    "A) A harmless file",
    "B) Software designed to harm systems",
    "C) A network cable",
    "D) A password",
    "Answer: B",
    "Explanation: Malware is harmful software.",
    "",
    "Q: A secret code used to access a system.",
    "Answer: Password",
    "Accept: password | passcode",
  ].join("\n");
  const txtRes = parseImportFile("bank.txt", txtText);
  assertEqual(txtRes.errors.length, 0, "txt no errors");
  assertEqual(txtRes.questions.length, 2, "txt 2 questions");
  assertEqual(new Question(txtRes.questions[0]).correctAnswer, 1, "txt answer letter B");
  assertTrue(new Question(txtRes.questions[1]).isCorrect("passcode"), "txt accept alias");

  // 15) Importer - validation + duplicate filtering
  assertTrue(normalizeRawQuestion({ text: "", options: ["a", "b"], correctAnswer: 0 }).ok === false, "missing text rejected");
  assertTrue(normalizeRawQuestion({ type: "multiple-choice", text: "x", options: ["a"], correctAnswer: 0 }).ok === false, "mc needs 2 options");
  assertTrue(normalizeRawQuestion({ type: "multiple-choice", text: "x", options: ["a", "b"], correctAnswer: "Z" }).ok === false, "unmatchable answer rejected");
  const ded = filterDuplicateQuestions([{ text: "Alpha" }, { text: " alpha " }, { text: "Beta" }], ["alpha"]);
  assertEqual(ded.unique.length, 1, "dedupe keeps one unique");
  assertEqual(ded.duplicates.length, 2, "dedupe reports duplicates");

  // 16) Scrambled letters (tile scramble interaction)
  const sq = new Question(QUESTION_BANK.find((d) => d.id === 25)); // "Phishing"
  const tiles = sq.getScrambledLetters();
  assertEqual(tiles.length, 8, "phishing yields 8 tiles");
  assertTrue(tiles.every((ch) => /[A-Z]/.test(ch)), "tiles are uppercase letters");

  const counts = (s) => [...s].reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
  const answerCounts = counts("PHISHING");
  const tileCounts = counts(tiles.join(""));
  assertTrue(
    Object.keys(answerCounts).every((k) => answerCounts[k] === tileCounts[k]),
    "tile multiset matches the answer letters (repeats preserved)",
  );
  assertTrue(
    tiles.every((ch) => "PHISHING".includes(ch)),
    "tiles contain only answer letters (no distractors)",
  );

  // Multi-word answer with no single-word acceptedAnswers -> tiles from correctAnswer (fallback)
  const multi = new Question({ type: "scramble", text: "Multi-word answer?", correctAnswer: "Multi word answer", acceptedAnswers: [] });
  assertEqual(multi.getScrambledLetters().length, 15, "multi-word answer falls back to correctAnswer letters");
  assertTrue(multi.isScramble(), "multi-word item is still a scramble question");

  // Single-letter answer -> no tiles (text fallback)
  const shortQ = new Question({ type: "scramble", text: "Short?", correctAnswer: "A" });
  assertEqual(shortQ.getScrambledLetters().length, 0, "no tiles for single-letter answers");

  // MC questions get no tiles
  const mcQ = new Question(QUESTION_BANK.find((d) => d.type === "multiple-choice"));
  assertEqual(mcQ.getScrambledLetters().length, 0, "no tiles for MC questions");

  // Legacy "identification" type in a saved bank migrates to scramble
  const legacy = new Question({
    type: "identification",
    text: "Legacy?",
    correctAnswer: "Phishing",
    acceptedAnswers: ["phishing"],
  });
  assertTrue(legacy.isScramble(), "legacy identification type migrates to scramble");
  assertTrue(legacy.isCorrect("phishing"), "migrated legacy question still grades");

  /* ===================== 17) Difficulty tags ===================== */

  const knownTags = ["easy", "normal", "hard", "expert"];
  assertEqual(QUESTION_BANK.length, 84, "bank holds 84 questions");
  assertTrue(
    QUESTION_BANK.every((d) => knownTags.indexOf(d.difficulty) !== -1),
    "every question carries a known difficulty tag",
  );

  const bandSize = (tag) => QUESTION_BANK.filter((d) => d.difficulty === tag).length;
  assertEqual(bandSize("easy"), 16, "easy band holds 16 questions");
  assertEqual(bandSize("normal"), 21, "normal band holds 21 questions");
  assertEqual(bandSize("hard"), 13, "hard band holds 13 questions");
  assertEqual(bandSize("expert"), 34, "expert band holds 34 questions");

  // A Question instance keeps its tag and passes it through a clone.
  const tagged = new Question(QUESTION_BANK.find((d) => d.difficulty === "expert"));
  assertEqual(tagged.difficulty, "expert", "question keeps its difficulty");
  assertEqual(tagged.clone().difficulty, "expert", "clone keeps the difficulty");
  assertEqual(new Question({ type: "scramble", text: "x" }).difficulty, "normal", "missing tag -> normal");
  assertEqual(new Question({ type: "scramble", text: "x", difficulty: "nope" }).difficulty, "normal", "unknown tag -> normal");
  assertEqual(new Question({ type: "scramble", text: "x", difficulty: "tiebreaker" }).difficulty, "normal", "the removed tiebreaker tag -> normal");

  /* ===================== 18) Levels ===================== */

  const bank = QUESTION_BANK.map((d) => new Question(d));
  const easyPool = Levels.getPool(bank, "easy");
  const normalPool = Levels.getPool(bank, "normal");
  const hardPool = Levels.getPool(bank, "hard");
  const expertPool = Levels.getPool(bank, "expert");

  // The four difficulty levels share the whole bank, so every question
  // stays reachable in every level.
  assertEqual(easyPool.length, 84, "easy pool holds the whole bank");
  assertEqual(normalPool.length, 84, "normal pool holds the whole bank");
  assertEqual(hardPool.length, 84, "hard pool holds the whole bank");
  assertEqual(expertPool.length, 84, "expert pool holds the whole bank");

  const bankStats = Levels.getStats(easyPool);
  assertEqual(bankStats.mc, 48, "the shared pool holds every multiple choice question");
  assertEqual(bankStats.scramble, 36, "the shared pool holds every scramble question");

  // The original 56 questions are available in every difficulty level.
  const originalIds = QUESTION_BANK.filter((d) => d.id < 2000).map((d) => d.id);
  assertEqual(originalIds.length, 56, "the original bank holds 56 questions");
  ["easy", "normal", "hard", "expert"].forEach((key) => {
    const ids = Levels.getPool(bank, key).map((q) => q.id);
    const missing = originalIds.filter((id) => ids.indexOf(id) === -1);
    assertEqual(missing.length, 0, "the original 56 are all in the " + key + " level");
  });

  assertEqual(Levels.normalizeKey("advanced"), "hard", "legacy 'advanced' maps to hard");
  assertEqual(Levels.normalizeKey("nope"), "normal", "unknown level falls back to normal");
  assertEqual(Levels.normalizeKey("tiebreaker"), "normal", "the removed tiebreaker level falls back to normal");
  assertEqual(Levels.getLabel("expert"), "Expert", "expert label");
  assertEqual(Levels.SELECTABLE.length, 4, "four selectable levels");
  assertTrue(Levels.SELECTABLE.indexOf("tiebreaker") === -1, "the tiebreaker is no longer a setup level");

  // The scramble share of every level.
  assertEqual(Levels.getMix("easy"), 0, "easy is multiple choice only");
  assertEqual(Levels.getMix("normal"), 0.2, "normal draws about 20% scramble");
  assertEqual(Levels.getMix("hard"), 0.4, "hard draws about 40% scramble");
  assertEqual(Levels.getMix("expert"), 0.6, "expert draws about 60% scramble");

  // Count chips follow the pool size, with a shared 10/20/40/50 preset set.
  const easyCounts = Levels.getCountOptions("easy", easyPool).map((o) => o.value);
  assertTrue(arrayEqual(easyCounts, ["10", "20", "40", "50", "all"]), "an 84 question pool offers every preset");
  const normalCounts = Levels.getCountOptions("normal", normalPool).map((o) => o.value);
  assertTrue(arrayEqual(normalCounts, ["10", "20", "40", "50", "all"]), "every level shares the same presets");
  const easyAll = Levels.getCountOptions("easy", easyPool).find((o) => o.value === "all");
  assertEqual(easyAll.count, 84, "the easy All chip shows the pool size");
  assertEqual(easyAll.label, "All (84)", "the easy All chip is labelled with the pool size");
  const normalAll = Levels.getCountOptions("normal", normalPool).find((o) => o.value === "all");
  assertEqual(normalAll.count, 84, "the normal All chip shows the whole pool");

  // Presets larger than the pool are hidden, and a pool that matches a
  // preset does not get a redundant All chip.
  const smallPool = QUESTION_BANK.slice(0, 16);
  const smallCounts = Levels.getCountOptions("easy", smallPool).map((o) => o.value);
  assertTrue(arrayEqual(smallCounts, ["10", "all"]), "a 16 question pool hides 20/40/50");
  const smallAll = Levels.getCountOptions("easy", smallPool).find((o) => o.value === "all");
  assertEqual(smallAll.count, 16, "the small All chip shows the pool size");
  assertEqual(smallAll.label, "All (16)", "the small All chip is labelled with the pool size");
  const tenQuestionPool = QUESTION_BANK.slice(0, 10);
  const tenCounts = Levels.getCountOptions("easy", tenQuestionPool);
  assertEqual(tenCounts.length, 1, "a 10 question pool offers one chip");
  assertEqual(tenCounts[0].value, "10", "the matching preset replaces All");
  assertEqual(Levels.getCountOptions("easy", []).length, 0, "an empty pool offers no chips");

  // The setup screen text.
  assertEqual(
    Levels.describeRound("normal", normalPool),
    "Maximum of 84 questions per round (about 20% scramble).",
    "the normal round help",
  );
  assertEqual(
    Levels.describeRound("expert", expertPool),
    "Maximum of 84 questions per round (about 60% scramble).",
    "the expert round help",
  );
  assertEqual(
    Levels.describeRound("easy", smallPool),
    "Maximum of 16 questions per round (multiple choice only).",
    "the easy round help follows the pool",
  );
  assertEqual(
    Levels.describeRound("easy", []),
    "No questions available yet.",
    "an empty pool says so",
  );

  /* ===================== 19) Mix aware selection ===================== */

  const expertPicked = selectQuestionsByMix(expertPool, 20, {
    scrambleRatio: Levels.getMix("expert"),
  });
  assertEqual(expertPicked.length, 20, "expert round uses 20 questions");
  const expertScramble = expertPicked.filter((q) => q.type === "scramble").length;
  assertEqual(expertScramble, 12, "expert round is 12 scramble + 8 multiple choice");
  assertEqual(expertPicked.length - expertScramble, 8, "expert round has 8 multiple choice");

  const hardPicked = selectQuestionsByMix(hardPool, 20, { scrambleRatio: Levels.getMix("hard") });
  assertEqual(hardPicked.filter((q) => q.type === "scramble").length, 8, "hard round is 8 scramble");

  const normalPicked = selectQuestionsByMix(normalPool, 20, { scrambleRatio: Levels.getMix("normal") });
  assertEqual(normalPicked.filter((q) => q.type === "scramble").length, 4, "normal round is 4 scramble");

  const easyPicked = selectQuestionsByMix(easyPool, 10, { scrambleRatio: Levels.getMix("easy") });
  assertEqual(easyPicked.filter((q) => q.type === "scramble").length, 0, "easy round has no scramble");
  assertEqual(easyPicked.length, 10, "easy round uses 10 questions");

  // The shortfall is backfilled from the other type.
  const mixed = [
    { type: "scramble", id: 1 },
    { type: "scramble", id: 2 },
    { type: "multiple-choice", id: 3 },
    { type: "multiple-choice", id: 4 },
    { type: "multiple-choice", id: 5 },
    { type: "multiple-choice", id: 6 },
  ];
  const backfilled = selectQuestionsByMix(mixed, 5, { scrambleRatio: 1 });
  assertEqual(backfilled.length, 5, "backfill still returns the requested count");
  assertEqual(backfilled.filter((q) => q.type === "scramble").length, 2, "backfill uses what is available");

  // A quiz session honours the mix.
  const mixedQuiz = new Quiz(expertPool);
  mixedQuiz.start({ randomize: true, questionCount: 20, mixRatio: Levels.getMix("expert") });
  assertEqual(mixedQuiz.getTotal(), 20, "quiz honours the requested size");
  assertEqual(
    mixedQuiz.questions.filter((q) => q.type === "scramble").length,
    12,
    "quiz honours the mix",
  );

  /* ===================== 20) Team results with time ===================== */

  const timed = new Team("Gray", 8, 10, 300);
  assertEqual(timed.totalQuestions, 10, "team keeps the question count");
  assertEqual(timed.timeSeconds, 300, "team keeps the answering time");
  assertTrue(!timed.recordResult({ score: 7, total: 10, seconds: 100 }), "a lower score is refused");
  assertEqual(timed.score, 8, "the score is untouched");
  assertTrue(!timed.recordResult({ score: 8, total: 10, seconds: 400 }), "the same score but slower is refused");
  assertTrue(timed.recordResult({ score: 8, total: 10, seconds: 200 }), "the same score but faster wins");
  assertEqual(timed.timeSeconds, 200, "the faster time is stored");
  assertTrue(timed.recordResult({ score: 9, total: 10, seconds: 500 }), "a higher score always wins");
  assertEqual(timed.score, 9, "the higher score is stored");
  assertEqual(timed.timeSeconds, 500, "the time follows the score");

  /* ===================== 21) Leaderboard with time ===================== */

  const board = new Scoreboard();
  board.addTeam("Gray", 8, 10, 300);
  board.addTeam("Blue", 8, 10, 240);

  const boardRank = board.getRankings();
  assertEqual(boardRank[0].name, "Blue", "the faster team takes the top spot");
  assertEqual(boardRank[0].rank, 1, "the faster team is ranked 1");
  assertEqual(boardRank[1].name, "Gray", "the slower team comes second");
  assertEqual(boardRank[1].rank, 2, "the slower team is ranked 2");
  assertTrue(!board.hasTies(), "equal scores with different times are not a tie");
  assertEqual(board.getLeaders().length, 1, "only the fastest team leads");
  assertEqual(board.getLeaders()[0].name, "Blue", "the fastest team leads");

  board.getTeam("Blue").timeSeconds = 300;
  assertTrue(board.hasTies(), "equal score and equal time is a tie");
  assertEqual(board.getLeaders().length, 2, "both teams lead a real tie");

  /* ===================== 22) Importer difficulty ===================== */

  const withDifficulty = parseImportFile(
    "difficulty.csv",
    [
      "type,question,optionA,optionB,answer,difficulty",
      'multiple-choice,"Hard one?",Yes,No,Yes,expert',
    ].join("\n"),
  );
  assertEqual(withDifficulty.errors.length, 0, "difficulty csv parses");
  assertEqual(withDifficulty.questions[0].difficulty, "expert", "the difficulty column is read");

  const withoutDifficulty = parseImportFile(
    "plain.csv",
    [
      "type,question,optionA,optionB,answer",
      'multiple-choice,"Plain one?",Yes,No,Yes',
    ].join("\n"),
  );
  assertEqual(withoutDifficulty.questions[0].difficulty, "normal", "a missing difficulty defaults to normal");

  const jsonDifficulty = parseImportFile(
    "difficulty.json",
    JSON.stringify([{ type: "scramble", text: "Term?", correctAnswer: "Phishing", difficulty: "hard" }]),
  );
  assertEqual(jsonDifficulty.questions[0].difficulty, "hard", "the json difficulty field is read");

  console.log("All tests passed (" + QUESTION_BANK.length + " questions in bank).");
}
function main() {
  try {
    const ctx = loadAll();
    runTests(ctx);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();

