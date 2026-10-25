/**
 * QuizApi
 * -----------------------------------------------------------
 * Thin async wrapper around the Tauri Rust commands that back the quiz
 * with SQLite. All persistence (questions, imports, attempts, settings)
 * goes through here so the rest of the app stays storage-agnostic.
 *
 * When running outside Tauri (e.g. the Node logic tests or a plain
 * browser) `isAvailable()` returns false and callers fall back to the
 * in-memory bank.
 */
window.QuizApi = {
  /** Resolves the Tauri invoke function, or null when unavailable. */
  _invoke() {
    const tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.invoke === "function") {
      return tauri.core.invoke;
    }
    return null;
  },

  /** True when the app is running inside the Tauri shell. */
  isAvailable() {
    return this._invoke() !== null;
  },

  async _call(command, args) {
    const invoke = this._invoke();
    if (!invoke) {
      throw new Error(`Tauri is not available (tried to call ${command}).`);
    }
    return invoke(command, args || {});
  },

  /** All questions in the bank. */
  getQuestions() {
    return this._call("get_questions");
  },

  /** Inserts imported questions; returns them with assigned ids/source. */
  addQuestions(questions) {
    return this._call("add_questions", { questions });
  },

  /** Removes every question from the bank. Returns the number removed. */
  clearImported() {
    return this._call("clear_imported");
  },

  /** Records one attempt (fire-and-forget). */
  recordAttempt(questionId, given, isCorrect) {
    return this._call("record_attempt", {
      questionId,
      given: given === null || given === undefined ? null : String(given),
      isCorrect: Boolean(isCorrect)
    });
  },

  /** Aggregate attempt statistics: { total, correct }. */
  getStats() {
    return this._call("get_stats");
  },

  /** Clears all recorded attempts. */
  resetAttempts() {
    return this._call("reset_attempts");
  },

  /** Persisted settings: { timerDefault, questionCountDefault, shuffleChoicesDefault, levelDefault, levelCounts, soundDefault, bgmDefault, bgmVolumeDefault }. */
  getSettings() {
    return this._call("get_settings");
  },

  /** Persists a single setting. */
  setSetting(key, value) {
    return this._call("set_setting", { key, value: String(value) });
  },

  /** True when at least one user is registered (backend only). */
  hasUsers() {
    return this._call("has_users");
  },

  /** Registers the first user account. */
  register(username, password) {
    return this._call("register", { username, password });
  },

  /** Signs a user in. */
  login(username, password) {
    return this._call("login", { username, password });
  },

  getTeams() {
    return this._call("get_teams");
  },

  /** Adds a team to a level. Every level has its own team list. */
  addTeam(name, level) {
    return this._call("add_team", { name, level: String(level || "normal") });
  },

  /** Deletes a team (and its score) from a level. */
  removeTeam(name, level) {
    return this._call("remove_team", { name, level: String(level || "normal") });
  },

  /**
   * Moves a team from a level into the recycle bin instead of deleting it.
   * The team's score and the moment it was moved are kept so the host can
   * recover it within 30 days. Returns true when a team was actually moved.
   */
  moveTeamToBin(name, level) {
    return this._call("move_team_to_bin", { name, level: String(level || "normal") });
  },

  /** Returns every team currently held in the recycle bin, newest first. */
  listDeletedTeams() {
    return this._call("list_deleted_teams");
  },

  /**
   * Restores a team from the recycle bin back into the active list, carrying
   * the score it had when it was deleted. Skipped when the team already exists
   * on that level. Returns true when a team was actually restored.
   */
  recoverTeamFromBin(name, level) {
    return this._call("recover_team_from_bin", { name, level: String(level || "normal") });
  },

  /** Purges every bin entry older than 30 days. Returns the number removed. */
  purgeExpiredDeletedTeams() {
    return this._call("purge_expired_deleted_teams");
  },

  /**
   * Permanently removes a team from the recycle bin. Unlike recovery this
   * cannot be undone. Returns true when a bin entry was actually deleted.
   */
  deleteTeamFromBin(name, level) {
    return this._call("delete_team_from_bin", { name, level: String(level || "normal") });
  },

  /** Stores a team's best result (score, questions played, answering time). */
  setTeamResult(name, level, score, totalQuestions, timeSeconds) {
    return this._call("set_team_result", {
      name,
      level: String(level || "normal"),
      score: Math.max(0, Number(score) || 0),
      totalQuestions: Math.max(0, Number(totalQuestions) || 0),
      timeSeconds: Math.max(0, Number(timeSeconds) || 0)
    });
  },

  /**
   * Verifies the admin account password. Used to unlock the answer review
   * without storing a second password.
   */
  verifyAdminPassword(password) {
    return this._call("verify_admin_password", { password: String(password || "") });
  },

  /** Saves the import template to the default Downloads folder; returns its path. */
  saveTemplateToDownloads(contents, fileName) {
    return this._call("save_template_to_downloads", { contents, file_name: fileName });
  },

  /** Saves the import template to an explicit path. */
  saveTemplateFile(path, contents) {
    return this._call("save_template_file", { path, contents });
  },

  /** Opens a file with the OS default application. */
  openFile(path) {
    return this._call("open_file", { path });
  },

  /**
   * The current Tauri window, or null when the app runs in a plain
   * browser (tests, dev server).
   */
  getWindow() {
    const tauri = window.__TAURI__;

    if (tauri && tauri.window && typeof tauri.window.getCurrentWindow === "function") {
      return tauri.window.getCurrentWindow();
    }

    return null;
  },

  /**
   * Puts the window into fullscreen (which hides the title bar) or leaves
   * it. In a plain browser the standard Fullscreen API is used instead.
   *
   * @param {boolean} enabled
   * @returns {Promise<boolean>} The state the window ended up in.
   */
  async setFullscreen(enabled) {
    const appWindow = this.getWindow();

    if (appWindow) {
      await appWindow.setFullscreen(Boolean(enabled));
      return this.isFullscreen();
    }

    if (enabled) {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } else if (document.exitFullscreen) {
      await document.exitFullscreen();
    }

    return this.isFullscreen();
  },

  /** True when the window (or the page) is currently fullscreen. */
  async isFullscreen() {
    const appWindow = this.getWindow();

    if (appWindow) {
      return appWindow.isFullscreen();
    }

    return Boolean(document.fullscreenElement);
  }
};
