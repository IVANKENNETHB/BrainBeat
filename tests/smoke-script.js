/**
 * Browser smoke test. Injected into a copy of index.html and executed
 * against the real DOM, so it exercises the actual wiring (level chips,
 * count chips, quiz mix, leaderboard, locked review).
 */
(function () {
  const results = [];
  const ok = (name, cond, extra) => {
    results.push((cond ? "PASS" : "FAIL") + " :: " + name + (extra ? " :: " + extra : ""));
  };

  const chips = () => Array.from(document.querySelectorAll("#count-group .count-option"))
    .map((label) => label.querySelector("span").textContent);

  const fire = (element, type) => element.dispatchEvent(new Event(type, { bubbles: true }));

  function pickLevel(level) {
    const input = document.querySelector('input[name="level"][value="' + level + '"]');
    input.checked = true;
    fire(input, "change");
  }

  function pickMode(mode) {
    const input = document.querySelector('input[name="mode"][value="' + mode + '"]');
    input.checked = true;
    fire(input, "change");
  }

  function pickCount(value) {
    const input = document.querySelector('#count-group input[value="' + value + '"]');
    input.checked = true;
    fire(input, "change");
  }

  function checkedCount() {
    const input = document.querySelector("#count-group input:checked");
    return input ? input.value : "none";
  }

  /**
   * The application ships without a built-in bank, so the test seeds the
   * fixture bank the way an import would.
   *
   * @param {object} app
   */
  function seedBank(app) {
    const bank = window.TEST_QUESTION_BANK || [];

    app.importedQuestions = bank.map((data) => new Question(data));
    app.rebuildBank();
    app.updateBankStats();
  }

  function run() {
    const app = window.quizApp;

    if (!app) {
      results.push("FAIL :: the app did not start");
      return;
    }

    seedBank(app);

    ok("the fixture bank is loaded", app.questions.length === 84, String(app.questions.length));

    const settingsSummary = [
      document.getElementById("bank-total").textContent,
      document.getElementById("bank-mc").textContent,
      document.getElementById("bank-id").textContent
    ].join("/");

    ok("the settings bank summary follows the bank", settingsSummary === "84/48/36", settingsSummary);
    ok("the header has a settings button",
      document.getElementById("settings-open") !== null);

    /* ---------------- the full width layout ---------------- */

    const styleOf = (selector) => getComputedStyle(document.querySelector(selector));
    const trackCount = (value) => String(value).trim().split(/\s+/).filter(Boolean).length;

    ok("the shell is capped at 1800px", styleOf(".app-shell").maxWidth === "1800px",
      styleOf(".app-shell").maxWidth);
    ok("the shell fills the window",
      parseFloat(styleOf(".app-shell").width) > 1200, styleOf(".app-shell").width);
    ok("the body fills the window", styleOf("body").width === styleOf("html").width,
      styleOf("body").width + " / " + styleOf("html").width);
    ok("the home grid has two columns", trackCount(styleOf(".home-grid").gridTemplateColumns) === 2,
      styleOf(".home-grid").gridTemplateColumns);
    ok("the setup options have two columns",
      trackCount(styleOf(".setup-fields").gridTemplateColumns) === 2,
      styleOf(".setup-fields").gridTemplateColumns);
    ok("the level spans the full row",
      styleOf(".setup-fields .field-wide").gridColumnEnd === "-1",
      styleOf(".setup-fields .field-wide").gridColumnStart + " / " + styleOf(".setup-fields .field-wide").gridColumnEnd);
    ok("the hero banner fits the artwork",
      parseFloat(styleOf(".home-hero").height) <= 430, styleOf(".home-hero").height);

    /* ---------------- the banner emblem ---------------- */

    const art = document.querySelector(".home-hero-art");
    const artImgEl = art ? art.querySelector("img") : null;
    const artBox = art ? art.getBoundingClientRect() : null;
    const artImg = artImgEl ? getComputedStyle(artImgEl) : null;
    const hero = document.querySelector(".home-hero");
    const heroBox = hero ? hero.getBoundingClientRect() : null;

    ok("the banner shows the artwork", art !== null);
    ok("the banner uses the extended animation",
      artImgEl && /byte_builders_wide\.gif/.test(artImgEl.getAttribute("src")),
      artImgEl ? artImgEl.getAttribute("src") : "none");
    ok("the artwork fills the banner", artImg && artImg.objectFit === "cover",
      artImg ? artImg.objectFit : "none");
    ok("the artwork covers the whole banner",
      artBox && heroBox
        && Math.abs(artBox.width - heroBox.width) <= 4
        && Math.abs(artBox.height - heroBox.height) <= 4,
      artBox ? Math.round(artBox.width) + "x" + Math.round(artBox.height) : "none");
    ok("the artwork is centred on the banner",
      artBox && Math.abs((artBox.left + artBox.width / 2)
        - (document.documentElement.clientWidth / 2)) < 3,
      artBox ? String(Math.round(artBox.left + artBox.width / 2)) : "none");

    // The animation is already extended to the band, so it is wider than the
    // band and only the sides get cropped - the badge stays whole.
    const natural = artImgEl && artImgEl.naturalWidth
      ? artImgEl.naturalWidth / artImgEl.naturalHeight
      : 0;
    const band = heroBox ? heroBox.width / heroBox.height : 0;

    ok("the animation is wider than the banner",
      natural > 0 && band > 1 && natural > band,
      natural.toFixed(2) + ":1 in a " + band.toFixed(2) + ":1 band");

    // The static backdrop paints the band while the animation is still
    // decoding, so the banner never flashes empty.
    const backdrop = getComputedStyle(document.querySelector(".home-hero"), "::before");

    ok("the banner is filled by the extended backdrop",
      /banner_wide\.png/.test(backdrop.backgroundImage) && backdrop.backgroundSize === "cover",
      backdrop.backgroundImage);
    ok("the caption stays on the bottom left",
      getComputedStyle(document.querySelector(".home-hero-overlay")).bottom === "0px",
      getComputedStyle(document.querySelector(".home-hero-overlay")).bottom);

    /* ---------------- the fullscreen controls ---------------- */

    ok("the settings have a fullscreen button", app.dom.fullscreenBtn !== null);
    ok("the settings have an exit fullscreen button", app.dom.exitFullscreenBtn !== null);
    ok("the fullscreen button is enabled while windowed", app.dom.fullscreenBtn.disabled === false);
    ok("the exit fullscreen button is disabled while windowed",
      app.dom.exitFullscreenBtn.disabled === true);
    ok("the hint explains the state",
      app.dom.fullscreenHint.textContent.indexOf("not fullscreen") !== -1,
      app.dom.fullscreenHint.textContent);

    app.isFullscreen = true;
    app.updateFullscreenControls();
    ok("the buttons follow the state",
      app.dom.fullscreenBtn.disabled === true && app.dom.exitFullscreenBtn.disabled === false,
      "fullscreen=" + app.dom.fullscreenBtn.disabled + "/" + app.dom.exitFullscreenBtn.disabled);
    ok("the hint follows the state",
      app.dom.fullscreenHint.textContent.indexOf("fullscreen,") !== -1,
      app.dom.fullscreenHint.textContent);
    app.isFullscreen = false;
    app.updateFullscreenControls();

    /* ---------------- levels and count chips ---------------- */

    ok("four level chips", document.querySelectorAll("#level-group input[name='level']").length === 4,
      String(document.querySelectorAll("#level-group input[name='level']").length));

    pickLevel("expert");
    ok("expert chips", chips().join(",") === "10,20,40,50,All (84)", chips().join(","));
    ok("expert round help",
      document.getElementById("count-help").textContent
        === "Maximum of 84 questions per round (about 60% scramble).",
      document.getElementById("count-help").textContent);

    pickLevel("easy");
    ok("easy chips", chips().join(",") === "10,20,40,50,All (84)", chips().join(","));
    ok("easy round help",
      document.getElementById("count-help").textContent
        === "Maximum of 84 questions per round (multiple choice only).",
      document.getElementById("count-help").textContent);

    pickLevel("normal");
    ok("normal chips", chips().join(",") === "10,20,40,50,All (84)", chips().join(","));
    ok("normal round help",
      document.getElementById("count-help").textContent
        === "Maximum of 84 questions per round (about 20% scramble).",
      document.getElementById("count-help").textContent);

    pickLevel("hard");
    ok("hard chips", chips().join(",") === "10,20,40,50,All (84)", chips().join(","));
    ok("hard round help",
      document.getElementById("count-help").textContent
        === "Maximum of 84 questions per round (about 40% scramble).",
      document.getElementById("count-help").textContent);

    const shuffleBox = document.getElementById("shuffle-choices");
    ok("shuffle lives in settings",
      shuffleBox !== null && shuffleBox.closest("#screen-settings") !== null);

    ok("the bank lives in settings",
      document.querySelector("#screen-settings #bank-total") !== null
        && document.querySelector("#screen-settings #bank-mc") !== null
        && document.querySelector("#screen-settings #bank-id") !== null);
    ok("the settings offer the bank tools",
      ["import-file", "download-template", "clear-imported"].every(
        (action) => document.querySelector(`#screen-settings [data-action="${action}"]`) !== null));
    ok("the home no longer holds the import tools",
      document.querySelectorAll('#screen-home #import-file, #screen-home [data-action="import-file"]').length === 0);

    const settingsBtn = document.getElementById("settings-open");
    settingsBtn.click();
    ok("the settings button opens settings", app.currentScreen === "settings",
      app.currentScreen);
    settingsBtn.click();
    ok("the settings button toggles closed", app.currentScreen === "home", app.currentScreen);
    ok("closing settings keeps the count chips", chips().length === 5, String(chips().length));

    pickLevel("expert");
    pickCount("20");
    ok("expert keeps its own count", checkedCount() === "20", checkedCount());

    pickLevel("easy");
    ok("easy uses its own count", checkedCount() !== "20", checkedCount());
    pickLevel("expert");
    ok("expert count is remembered", checkedCount() === "20", checkedCount());

    /* ---------------- the round mix ---------------- */

    pickLevel("expert");
    pickCount("20");
    app.startQuiz();
    const expertRound = app.quiz.questions;
    const expertScramble = expertRound.filter((q) => q.type === "scramble").length;
    ok("expert round size", expertRound.length === 20, String(expertRound.length));
    ok("expert round mix", expertScramble === 12, expertScramble + " scramble");

    pickLevel("normal");
    pickCount("20");
    app.startQuiz();
    ok("normal round mix",
      app.quiz.questions.filter((q) => q.type === "scramble").length === 4,
      String(app.quiz.questions.filter((q) => q.type === "scramble").length));

    pickLevel("easy");
    pickCount("all");
    app.startQuiz();
    ok("easy round uses the whole pool", app.quiz.questions.length === 84,
      String(app.quiz.questions.length));
    ok("the whole-pool easy round backfills scramble",
      app.quiz.questions.filter((q) => q.type === "scramble").length === 36,
      String(app.quiz.questions.filter((q) => q.type === "scramble").length));

    pickCount("40");
    app.startQuiz();
    ok("a 40 question easy round has no scramble",
      app.quiz.questions.every((q) => q.type === "multiple-choice"),
      String(app.quiz.questions.filter((q) => q.type === "scramble").length));

    /* ---------------- the timer options ---------------- */

    const timerInputs = Array.from(document.querySelectorAll('input[name="timer"]'));
    ok("timer chips offer 2m and 3m",
      timerInputs.map((input) => input.value).join(",") === "0,15,30,60,120,180",
      timerInputs.map((input) => input.value).join(","));

    const threeMinute = timerInputs.find((input) => input.value === "180");
    threeMinute.checked = true;
    fire(threeMinute, "change");
    pickLevel("easy");
    pickCount("10");
    app.startQuiz();
    ok("a 3 minute timer is used", app.questionSeconds === 180, String(app.questionSeconds));
    ok("the timer shows 3:00", app.dom.timerText.textContent === "3:00",
      app.dom.timerText.textContent);
    app.clearCountdown();
    app.timer.stop();

    const timerOff = timerInputs.find((input) => input.value === "0");
    timerOff.checked = true;
    fire(timerOff, "change");

    /* ---------------- quizmaster leaderboard with time ---------------- */

    pickLevel("normal");
    pickMode("quizmaster");
    ["Gray", "Blue"].forEach((name) => app.getTeamDrafts("normal").push(name));
    app.renderTeamsDraft();
    app.startQuiz();

    app.responses = new Map();
    app.quiz.questions.forEach((question, index) => {
      const correct = index < 8;
      app.quiz.recordResponse(correct);
      app.responses.set(index, {
        response: 0,
        isCorrect: correct,
        answered: true,
        revealed: true,
        team: "Gray",
        timeSpent: 30
      });
    });
    app.roundTimeSeconds = 300;
    app.finishQuiz();

    const board = app.dom.resultsLeaderboard.textContent;
    ok("leaderboard shows the points", board.indexOf("8/") !== -1, board);
    ok("leaderboard shows the time", board.indexOf("5:00") !== -1, board);
    ok("leaderboard shows the team", board.indexOf("Gray") !== -1);
    ok("the answered team leads",
      app.scoreboard.getLeaders().length === 1 && app.scoreboard.getLeaders()[0].name === "Gray");
    ok("the winner line shows the time",
      app.dom.resultsSummary.textContent.indexOf("5:00") !== -1,
      app.dom.resultsSummary.textContent);

    /* ---------------- every level has its own teams ---------------- */

    ok("the normal level has its own teams", app.getTeamDrafts("normal").join(",") === "Gray,Blue");
    ok("the expert level starts empty", app.getTeamDrafts("expert").length === 0);
    ok("the expert board holds no team of the normal level",
      app.getScoreboard("expert").getTeamNames().indexOf("Gray") === -1,
      app.getScoreboard("expert").getTeamNames().join(","));

    pickLevel("expert");
    app.renderTeamsDraft();
    ok("another level shows another team list", app.teamsDraft.length === 0);
    ok("the lobby shows the level of the teams",
      app.dom.lobbyLevelBadge.textContent === "Expert level",
      app.dom.lobbyLevelBadge.textContent);

    ["Rust", "Zinc"].forEach((name) => app.getTeamDrafts("expert").push(name));
    app.renderTeamsDraft();
    app.getScoreboard("expert").getTeam("Rust").addPoints(4);

    pickLevel("normal");
    app.renderTeamsDraft();
    ok("switching back shows the normal teams", app.teamsDraft.join(",") === "Gray,Blue");
    ok("the normal standings are untouched", app.getScoreboard("normal").getTopScore() === 8);
    ok("the expert standings are their own", app.getScoreboard("expert").getTopScore() === 4);
    ok("the lobby shows the normal teams again",
      app.dom.lobbyLevelBadge.textContent === "Normal level",
      app.dom.lobbyLevelBadge.textContent);

    /* ---------------- the locked answer review ---------------- */

    const review = app.dom.reviewList.textContent;
    ok("the review is locked", review.indexOf("locked - admin password required") !== -1);
    ok("the review badge is neutral",
      app.dom.reviewList.querySelector(".review-badge").textContent === "Answered",
      app.dom.reviewList.querySelector(".review-badge").textContent);
    ok("the review item is marked as locked",
      app.dom.reviewList.querySelector(".review-item").classList.contains("review-locked"));
    ok("the reveal button is offered", !app.dom.revealAnswersBtn.hidden);
    ok("the hide button is hidden", app.dom.hideAnswersBtn.hidden);

    // A wrong password must not unlock anything.
    app.dom.revealPassword.value = "wrong";
    app.confirmRevealAnswers().then(() => {
      ok("a wrong password does not unlock", app.answersRevealed === false);
      ok("the wrong password is reported",
        !app.dom.revealError.hidden && app.dom.revealError.textContent.length > 0);

      app.dom.revealPassword.value = "admin123";
      return app.confirmRevealAnswers();
    }).then(() => {
      const unlocked = app.dom.reviewList.textContent;
      ok("the admin password unlocks the review", app.answersRevealed === true);
      ok("the answers are visible", unlocked.indexOf("Correct answer") !== -1
        && unlocked.indexOf("locked - admin password required") === -1);
      ok("the badge comes back", unlocked.indexOf("Correct") !== -1);
      ok("the hide button is offered", !app.dom.hideAnswersBtn.hidden);

      app.hideAnswers();
      ok("the answers can be locked again", app.answersRevealed === false);
      ok("the locked review is back",
        app.dom.reviewList.textContent.indexOf("locked - admin password required") !== -1);

      /* ---------------- level ties ---------------- */

      const blue = app.scoreboard.getTeam("Blue");
      blue.recordResult({ score: 8, total: 10, seconds: 300 });
      ok("a real tie is detected", app.scoreboard.hasTies() === true);

      // A faster team with the same score takes the lead.
      blue.timeSeconds = 240;
      ok("the faster team wins the tie", app.scoreboard.getLeaders()[0].name === "Blue",
        app.scoreboard.getLeaders()[0].name);
      ok("the tie is gone", app.scoreboard.hasTies() === false);
    });
  }

  /* A rejected sign-in must tell the user why it failed. The login call is
     stubbed so the rejection is deterministic without a Tauri backend. */
  async function checkSignInError() {
    const errorEl = document.getElementById("login-error");
    const usernameEl = document.getElementById("login-username");
    const passwordEl = document.getElementById("login-password");
    const button = document.querySelector('[data-action="login"]');

    if (!errorEl || !usernameEl || !passwordEl || !button || !window.QuizApi) {
      ok("a rejected sign-in shows the error message", false, "the sign-in form is missing");
      return;
    }

    const originalLogin = window.QuizApi.login;

    window.QuizApi.login = () => Promise.reject(new Error("Invalid username or password."));

    usernameEl.value = "tester";
    passwordEl.value = "wrong-password";
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 200));

    ok("a rejected sign-in shows the error message",
      errorEl.hidden === false && errorEl.textContent.length > 0,
      errorEl.textContent);

    window.QuizApi.login = originalLogin;
  }

  function finish() {
    const pre = document.createElement("pre");
    pre.id = "smoke-results";
    pre.textContent = results.join("\n");
    document.body.appendChild(pre);
  }

  window.addEventListener("load", () => {
    setTimeout(async () => {
      try {
        run();
        await checkSignInError();
      } catch (error) {
        results.push("FAIL :: threw " + error.message);
      }
      finish();
    }, 300);
  });
})();
