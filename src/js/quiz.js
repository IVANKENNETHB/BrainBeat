/**
 * Quiz
 * -----------------------------------------------------------
 * Owns the *active session*: which questions are in play, the current
 * index, and the recorded responses. The source bank passed in is
 * copied, so a session never mutates the original question set.
 */
class Quiz {
  /**
   * @param {Question[]} questions Full question bank (Question instances).
   */
  constructor(questions) {
    this.sourceQuestions = Array.isArray(questions) ? [...questions] : [];
    this.questions = [];
    this.responses = [];
    this.currentIndex = 0;
    this.active = false;
  }

  /**
   * Starts (or restarts) a session.
   *
   * @param {object} options
   * @param {boolean} options.randomize      Randomize question order + selection.
   * @param {number}  options.questionCount  How many questions to use.
   * @param {boolean} options.shuffleChoices Shuffle each MC question's options.
   * @param {number} [options.mixRatio]      Share of the round that should be
   *                                         scramble (0 - 1). When omitted the
   *                                         questions are picked at random.
   */
  start({
    randomize = true,
    questionCount = this.sourceQuestions.length,
    shuffleChoices = false,
    mixRatio = null
  } = {}) {
    const ordered = mixRatio === null || mixRatio === undefined
      ? (randomize
        ? selectRandomQuestions(this.sourceQuestions, questionCount)
        : interleaveByType(this.sourceQuestions).slice(0, questionCount))
      : selectQuestionsByMix(this.sourceQuestions, questionCount, {
        scrambleRatio: mixRatio,
        randomize
      });

    this.questions = shuffleChoices
      ? ordered.map((question) => question.withShuffledOptions())
      : ordered.map((question) => question.clone());

    this.responses = new Array(this.questions.length).fill(null);
    this.currentIndex = 0;
    this.active = true;

    return this.questions;
  }

  end() {
    this.active = false;
  }

  getCurrentQuestion() {
    return this.questions[this.currentIndex] || null;
  }

  getTotal() {
    return this.questions.length;
  }

  getProgressNumber() {
    return this.questions.length === 0 ? 0 : this.currentIndex + 1;
  }

  hasNext() {
    return this.currentIndex < this.questions.length - 1;
  }

  hasPrevious() {
    return this.currentIndex > 0;
  }

  isLastQuestion() {
    return this.currentIndex === this.questions.length - 1;
  }

  nextQuestion() {
    if (this.hasNext()) {
      this.currentIndex += 1;
    }

    return this.getCurrentQuestion();
  }

  previousQuestion() {
    if (this.hasPrevious()) {
      this.currentIndex -= 1;
    }

    return this.getCurrentQuestion();
  }

  goToQuestion(index) {
    if (Number.isInteger(index) && index >= 0 && index < this.questions.length) {
      this.currentIndex = index;
    }

    return this.getCurrentQuestion();
  }

  /**
   * Stores whether the response at the current index was correct.
   * @param {boolean} isCorrect
   */
  recordResponse(isCorrect) {
    this.responses[this.currentIndex] = { isCorrect: Boolean(isCorrect) };
  }

  /**
   * Number of correct responses recorded so far.
   * @returns {number}
   */
  getScore() {
    return this.responses.reduce((total, entry) => total + (entry && entry.isCorrect ? 1 : 0), 0);
  }

  getAnsweredCount() {
    return this.responses.reduce((total, entry) => total + (entry ? 1 : 0), 0);
  }

  getPercentage() {
    if (this.questions.length === 0) {
      return 0;
    }

    return Math.round((this.getScore() / this.questions.length) * 100);
  }
}
