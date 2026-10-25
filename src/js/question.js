/**
 * Question
 * -----------------------------------------------------------
 * Immutable-ish value object that wraps a single quiz question.
 * It knows how to validate a response, expose the correct answer,
 * and produce safe copies (used when randomizing a session so the
 * original bank is never touched).
 */
class Question {
  static get TYPE_MULTIPLE_CHOICE() {
    return "multiple-choice";
  }

  static get TYPE_SCRAMBLE() {
    return "scramble";
  }

  /**
   * Difficulty tags a question can carry. The order is the difficulty
   * order (easiest first) and is used to build the level pools.
   */
  static get DIFFICULTIES() {
    return ["easy", "normal", "hard", "expert"];
  }

  /**
   * Normalizes a difficulty tag. Unknown or missing values fall back to
   * "normal" so an untagged question is still playable.
   *
   * @param {string} value
   * @returns {string}
   */
  static normalizeDifficulty(value) {
    const tag = String(value === null || value === undefined ? "" : value)
      .trim()
      .toLowerCase();

    return Question.DIFFICULTIES.indexOf(tag) !== -1 ? tag : "normal";
  }

  /**
   * @param {object} data Raw question data from the bank.
   */
  constructor(data) {
    this.id = data.id;
    this.type = data.type === "identification" ? Question.TYPE_SCRAMBLE : data.type;
    this.difficulty = Question.normalizeDifficulty(data.difficulty);
    this.text = data.text;
    this.options = Array.isArray(data.options) ? [...data.options] : null;
    this.correctAnswer = data.correctAnswer;
    this.acceptedAnswers = Array.isArray(data.acceptedAnswers) ? [...data.acceptedAnswers] : [];
    this.explanation = data.explanation || "";
  }

  isMultipleChoice() {
    return this.type === Question.TYPE_MULTIPLE_CHOICE;
  }

  isScramble() {
    return this.type === Question.TYPE_SCRAMBLE;
  }

  /**
   * Returns the human-readable correct answer.
   * @returns {string}
   */
  getCorrectAnswer() {
    switch (this.type) {
      case Question.TYPE_MULTIPLE_CHOICE:
        return this.options[this.correctAnswer] || "";

      case Question.TYPE_SCRAMBLE:
        return this.correctAnswer;

      default:
        return "";
    }
  }

  /**
   * Returns the answer's uppercase alphanumeric letters, shuffled, for the
   * scramble interaction (no distractors - the player must be able to form
   * the exact answer). For multi-word answers, a single-token accepted
   * answer (such as "VPN") can be used for the tiles.
   * @returns {string[]}
   */
  getScrambledLetters() {
    if (!this.isScramble()) return [];

    const candidates = [this.correctAnswer, ...this.acceptedAnswers]
      .map((candidate) => String(candidate || "").trim())
      .filter((candidate) => candidate && !/\s/.test(candidate));
    const answer = (candidates[0] || String(this.correctAnswer || "")).toUpperCase();
    const letters = answer.split("").filter((ch) => /[A-Z0-9]/.test(ch));

    if (letters.length < 2) return [];

    return shuffleArray(letters);
  }

  /**
   * Validates a user response against this question.
   * Multiple-choice expects an option index; scramble expects text.
   *
   * @param {number|string} response
   * @returns {boolean}
   */
  isCorrect(response) {
    switch (this.type) {
      case Question.TYPE_MULTIPLE_CHOICE: {
        if (response === null || response === undefined) {
          return false;
        }

        if (typeof response === "string" && response.trim().length === 0) {
          return false;
        }

        const index = Number(response);

        if (!Number.isFinite(index) || !Number.isInteger(index)) {
          return false;
        }

        return index === this.correctAnswer;
      }

      case Question.TYPE_SCRAMBLE: {
        const normalized = normalizeAnswer(response);

        return normalized.length > 0 && this.acceptedAnswers.includes(normalized);
      }

      default:
        return false;
    }
  }

  /**
   * Returns a deep-enough copy so mutations (like shuffling options)
   * never leak back into the shared bank.
   * @returns {Question}
   */
  clone() {
    return new Question({
      id: this.id,
      type: this.type,
      difficulty: this.difficulty,
      text: this.text,
      options: this.options,
      correctAnswer: this.correctAnswer,
      acceptedAnswers: this.acceptedAnswers,
      explanation: this.explanation
    });
  }

  /**
   * Returns a copy with multiple-choice options shuffled.
   * The correctAnswer index is remapped so the answer stays attached
   * to the same option text after shuffling.
   *
   * @param {Function} shuffleFn Injectable shuffle (defaults to Fisher-Yates).
   * @returns {Question}
   */
  withShuffledOptions(shuffleFn = shuffleArray) {
    const copy = this.clone();

    if (!copy.isMultipleChoice()) {
      return copy;
    }

    const correctOptionText = this.options[this.correctAnswer];
    const shuffledOptions = shuffleFn(this.options);

    copy.options = shuffledOptions;
    copy.correctAnswer = shuffledOptions.indexOf(correctOptionText);

    return copy;
  }
}
