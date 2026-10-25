/**
 * Scoreboard
 * -----------------------------------------------------------
 * Manages a collection of Team instances. Provides ranked views,
 * detects ties, and exposes the current leaders.
 *
 * Teams are ordered by score (descending) and, when the scores are equal,
 * by the time it took to answer (ascending) - so the team that answered
 * faster takes the top spot. A real tie (same score *and* same time) leaves
 * both teams as leaders.
 *
 * The internal team list keeps insertion order; rankings are returned as
 * copies.
 */
class Scoreboard {
  constructor() {
    /** @type {Team[]} */
    this.teams = [];
  }

  /**
   * Adds a team if the name is valid and not already used.
   * @param {string} name
   * @param {number} [score]
   * @param {number} [totalQuestions]
   * @param {number} [timeSeconds]
   * @returns {Team|null}
   */
  addTeam(name, score = 0, totalQuestions = 0, timeSeconds = 0) {
    const cleanName = String(name || "").trim();

    if (cleanName.length === 0 || this.getTeam(cleanName)) {
      return null;
    }

    const team = new Team(cleanName, score, totalQuestions, timeSeconds);
    this.teams.push(team);

    return team;
  }

  /**
   * Removes a team by name.
   * @param {string} name
   * @returns {boolean} True when a team was removed.
   */
  removeTeam(name) {
    const index = this.teams.findIndex((team) => team.name === name);

    if (index === -1) {
      return false;
    }

    this.teams.splice(index, 1);

    return true;
  }

  /**
   * Removes every team from the board.
   */
  clear() {
    this.teams = [];
  }

  /**
   * Case-insensitive lookup by team name.
   * @param {string} name
   * @returns {Team|null}
   */
  getTeam(name) {
    const target = String(name || "").trim().toLowerCase();

    return this.teams.find((team) => team.name.toLowerCase() === target) || null;
  }

  hasTeams() {
    return this.teams.length > 0;
  }

  getTeamNames() {
    return this.teams.map((team) => team.name);
  }

  reset() {
    this.teams.forEach((team) => team.resetScore());
  }

  /**
   * Highest score currently on the board (0 when empty).
   * @returns {number}
   */
  getTopScore() {
    return this.teams.reduce((max, team) => Math.max(max, team.score), 0);
  }

  /**
   * Sorts teams by score (desc) and then by time (asc). Teams that have
   * not played yet sort last within their score group.
   *
   * @param {Array<Team>} [teams]
   * @returns {Array<Team>}
   */
  sortTeams(teams = this.teams) {
    return [...teams].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return Scoreboard.timeOf(a) - Scoreboard.timeOf(b);
    });
  }

  /**
   * The time used for ranking. A team that has not played yet (no
   * questions answered) sorts after every team that has.
   *
   * @param {Team} team
   * @returns {number}
   */
  static timeOf(team) {
    if (!team) {
      return Number.MAX_SAFE_INTEGER;
    }

    if (!team.totalQuestions) {
      return Number.MAX_SAFE_INTEGER;
    }

    return team.timeSeconds;
  }

  /**
   * Returns teams sorted by score (desc) with a `rank` attached.
   * Equal scores are separated by answering time, so only teams with the
   * same score *and* the same time share a rank (standard competition
   * ranking).
   *
   * The scoreboard itself is NOT reordered.
   *
   * @returns {Array<{name:string, score:number, totalQuestions:number, timeSeconds:number, rank:number}>}
   */
  getRankings() {
    const sorted = this.sortTeams().map((team) => ({
      name: team.name,
      score: team.score,
      totalQuestions: team.totalQuestions,
      timeSeconds: team.timeSeconds
    }));

    let lastScore = null;
    let lastTime = null;
    let lastRank = 0;

    return sorted.map((entry, index) => {
      const tied = entry.score === lastScore && entry.timeSeconds === lastTime;
      const rank = tied ? lastRank : index + 1;

      lastScore = entry.score;
      lastTime = entry.timeSeconds;
      lastRank = rank;

      return { ...entry, rank };
    });
  }

  /**
   * True when two or more teams share the top score *and* the top time.
   * Returns false when no team has scored yet, so a 0-0 board is never
   * reported as a tie.
   *
   * Teams that only share a score are NOT tied: the faster one leads.
   *
   * @returns {boolean}
   */
  hasTies() {
    return this.getLeaders().length > 1;
  }

  /**
   * The teams in first place. A team leads when it has the top score and
   * answers at least as fast as every other team with that score - so a
   * slower team with the same score is passed.
   *
   * Empty when no team has scored, so an unscored board never declares a
   * winner.
   * @returns {Team[]}
   */
  getLeaders() {
    const topScore = this.getTopScore();

    if (topScore <= 0) {
      return [];
    }

    const contenders = this.teams.filter((team) => team.score === topScore);

    if (contenders.length === 0) {
      return [];
    }

    const topTime = Math.min(...contenders.map((team) => Scoreboard.timeOf(team)));

    return contenders.filter((team) => Scoreboard.timeOf(team) === topTime);
  }
}
