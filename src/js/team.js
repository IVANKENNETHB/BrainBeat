/**
 * Team
 * -----------------------------------------------------------
 * Holds a team's display name and its best result: the score, how many
 * questions it played and how long it took to answer them. Scores never
 * drop below zero.
 */
class Team {
  /**
   * @param {string} name
   * @param {number} [score]
   * @param {number} [totalQuestions]
   * @param {number} [timeSeconds]
   */
  constructor(name, score = 0, totalQuestions = 0, timeSeconds = 0) {
    this.name = String(name || "Unnamed team").trim() || "Unnamed team";
    this.score = Math.max(0, Number(score) || 0);
    this.totalQuestions = Math.max(0, Number(totalQuestions) || 0);
    this.timeSeconds = Math.max(0, Number(timeSeconds) || 0);
  }

  /**
   * Adds points to the team's score.
   * @param {number} points
   * @returns {number} The new score.
   */
  addPoints(points) {
    const amount = Math.max(0, Number(points) || 0);
    this.score += amount;

    return this.score;
  }

  /**
   * Deducts points, clamping the score at zero.
   * @param {number} points
   * @returns {number} The new score.
   */
  deductPoints(points) {
    const amount = Math.abs(Number(points) || 0);
    this.score = Math.max(0, this.score - amount);

    return this.score;
  }

  /**
   * Resets the score back to zero.
   * @returns {number}
   */
  resetScore() {
    this.score = 0;

    return this.score;
  }

  /**
   * Records the result of a finished round.
   *
   * The better result wins: a higher score always replaces the stored one,
   * and an equal score only replaces it when it was achieved in less time.
   * The question count and the time always belong to the score they were
   * achieved with, so the leaderboard can show a consistent
   * "8/10 pts in 5:00".
   *
   * @param {object} result
   * @param {number} result.score      Correct answers in the round.
   * @param {number} [result.total]    Questions in the round.
   * @param {number} [result.seconds]  Time spent answering the round.
   * @returns {boolean} True when the stored result was replaced.
   */
  recordResult({ score = 0, total = 0, seconds = 0 } = {}) {
    const newScore = Math.max(0, Number(score) || 0);
    const newTotal = Math.max(0, Number(total) || 0);
    const newTime = Math.max(0, Number(seconds) || 0);

    const better = newScore > this.score
      || (newScore === this.score && newTime < this.timeSeconds);

    if (!better) {
      return false;
    }

    this.score = newScore;
    this.totalQuestions = newTotal;
    this.timeSeconds = newTime;

    return true;
  }

  /**
   * True when this team shares both its score and its time with another
   * team.
   *
   * @param {Team} other
   * @returns {boolean}
   */
  isTiedWith(other) {
    if (!other) {
      return false;
    }

    return this.score === other.score && this.timeSeconds === other.timeSeconds;
  }
}
