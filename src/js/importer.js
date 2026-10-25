/**
 * Question Importer
 * -----------------------------------------------------------
 * Turns imported files (JSON, CSV or plain text) into normalized
 * question objects that match the shape expected by the Question
 * value object. All functions here are pure and DOM-free so they can
 * be exercised directly from the Node test harness.
 *
 * Supported shapes
 *   JSON : [ { type, text, options, correctAnswer, acceptedAnswers, explanation } ]
 *          or { "questions": [ ... ] }
 *   CSV  : header row -> type,question,optionA..D,answer,acceptedAnswers,explanation
 *   TXT  : blank-line separated blocks using Q:/A)/Answer:/Accept:/Explanation:
 */

/** Reads a lowercase file extension (without the dot). */
function getFileExtension(fileName) {
  const name = String(fileName || "").toLowerCase();
  const dot = name.lastIndexOf(".");

  return dot === -1 ? "" : name.slice(dot + 1);
}

/** Normalizes a header/type token for tolerant matching. */
function squeezeToken(value) {
  return String(value === null || value === undefined ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Maps many human spellings onto the two canonical question types. */
function normalizeQuestionType(value) {
  const token = squeezeToken(value);

  if (["multiplechoice", "mc", "choice", "multichoice"].indexOf(token) !== -1) {
    return Question.TYPE_MULTIPLE_CHOICE;
  }

  if (["identification", "id", "identify", "fillin", "fillintheblank", "blank", "scramble"].indexOf(token) !== -1) {
    return Question.TYPE_SCRAMBLE;
  }

  return "";
}

/**
 * Resolves a multiple-choice answer expressed as an index, a letter
 * (A/B/C/D), or the exact/normalized option text.
 *
 * @returns {number} option index, or -1 when it cannot be matched.
 */
function resolveMultipleChoiceAnswer(answer, options) {
  if (answer === null || answer === undefined) {
    return -1;
  }

  if (typeof answer === "number" && Number.isInteger(answer)) {
    return answer >= 0 && answer < options.length ? answer : -1;
  }

  const raw = String(answer).trim();

  if (raw.length === 0) {
    return -1;
  }

  if (/^[A-Za-z]$/.test(raw)) {
    const letterIndex = raw.toUpperCase().charCodeAt(0) - 65;

    if (letterIndex >= 0 && letterIndex < options.length) {
      return letterIndex;
    }
  }

  if (/^\d+$/.test(raw)) {
    const numericIndex = Number(raw);

    if (numericIndex >= 0 && numericIndex < options.length) {
      return numericIndex;
    }
  }

  const exact = options.findIndex((option) => String(option).trim() === raw);

  if (exact !== -1) {
    return exact;
  }

  const normalized = normalizeAnswer(raw);

  return options.findIndex((option) => normalizeAnswer(option) === normalized);
}

/** Builds the accepted-answer list, always including the displayed answer. */
function buildAcceptedAnswers(answerText, rawAccepted) {
  const values = [];

  if (Array.isArray(rawAccepted)) {
    rawAccepted.forEach((value) => values.push(String(value)));
  } else if (rawAccepted !== null && rawAccepted !== undefined && String(rawAccepted).trim().length > 0) {
    String(rawAccepted).split(/[|;]/).forEach((value) => values.push(value));
  }

  values.push(answerText);

  const normalized = values.map((value) => normalizeAnswer(value)).filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

/**
 * Validates and coerces one raw question into the canonical bank shape.
 *
 * @returns {{ok: true, question: object}|{ok: false, error: string}}
 */
function normalizeRawQuestion(raw, index = 0) {
  const label = `Row ${index + 1}`;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `${label}: not a valid question object.` };
  }

  const text = String(raw.text || raw.question || raw.prompt || "").trim();

  if (text.length === 0) {
    return { ok: false, error: `${label}: missing question text.` };
  }

  // An imported question without a difficulty tag is a normal one.
  const difficulty = Levels.normalizeDifficultyTag(raw.difficulty);

  const rawAnswer = raw.correctAnswer !== undefined && raw.correctAnswer !== null
    ? raw.correctAnswer
    : raw.answer;

  const guessedOptions = Array.isArray(raw.options)
    ? raw.options.map((option) => String(option).trim()).filter((option) => option.length > 0)
    : [];

  let type = normalizeQuestionType(raw.type);

  if (!type) {
    type = guessedOptions.length >= 2 ? Question.TYPE_MULTIPLE_CHOICE : Question.TYPE_SCRAMBLE;
  }

  if (type === Question.TYPE_MULTIPLE_CHOICE) {
    if (guessedOptions.length < 2) {
      return { ok: false, error: `${label}: multiple-choice questions need at least 2 options.` };
    }

    const correctIndex = resolveMultipleChoiceAnswer(rawAnswer, guessedOptions);

    if (correctIndex === -1) {
      return { ok: false, error: `${label}: could not match the answer to any option.` };
    }

    return {
      ok: true,
      question: {
        type: Question.TYPE_MULTIPLE_CHOICE,
        difficulty,
        text,
        options: guessedOptions,
        correctAnswer: correctIndex,
        acceptedAnswers: [],
        explanation: String(raw.explanation || "").trim()
      }
    };
  }

  const answerText = String(rawAnswer || raw.correctAnswer || "").trim();

  if (answerText.length === 0) {
    return { ok: false, error: `${label}: scramble questions need an answer.` };
  }

  return {
    ok: true,
    question: {
      type: Question.TYPE_SCRAMBLE,
      difficulty,
      text,
      options: null,
      correctAnswer: answerText,
      acceptedAnswers: buildAcceptedAnswers(answerText, raw.acceptedAnswers),
      explanation: String(raw.explanation || "").trim()
    }
  };
}

/** A normalized key used to detect duplicate questions. */
function questionKey(question) {
  const text = question && question.text !== undefined ? question.text : question;

  return normalizeAnswer(text);
}

/**
 * Splits freshly imported questions into unique + duplicate buckets,
 * seeding the seen-set with keys from questions already in the bank.
 */
function filterDuplicateQuestions(questions, existingKeys) {
  const seen = new Set(Array.isArray(existingKeys) ? existingKeys : []);
  const unique = [];
  const duplicates = [];

  (Array.isArray(questions) ? questions : []).forEach((question) => {
    const key = questionKey(question);

    if (key.length === 0 || seen.has(key)) {
      duplicates.push(question);
    } else {
      seen.add(key);
      unique.push(question);
    }
  });

  return { unique, duplicates };
}

/* ============================ JSON ============================ */

function parseJsonQuestions(text) {
  const data = JSON.parse(text);

  if (Array.isArray(data)) {
    return data;
  }

  if (data && Array.isArray(data.questions)) {
    return data.questions;
  }

  throw new Error('JSON must be an array of questions or an object with a "questions" array.');
}

/* ============================ CSV ============================ */

/** Minimal quote-aware CSV reader (handles commas, quotes and newlines in quotes). */
function parseCsvRows(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => String(cell).trim().length > 0));
}

function parseCsvQuestions(text) {
  const rows = parseCsvRows(text);

  if (rows.length < 2) {
    throw new Error("CSV needs a header row and at least one question row.");
  }

  const header = rows[0].map(squeezeToken);
  const column = (...names) => {
    for (let i = 0; i < names.length; i += 1) {
      const index = header.indexOf(names[i]);

      if (index !== -1) {
        return index;
      }
    }

    return -1;
  };

  const idx = {
    type: column("type", "questiontype", "kind"),
    text: column("question", "text", "prompt", "questiontext"),
    a: column("optiona", "choicea", "a", "choice1"),
    b: column("optionb", "choiceb", "b", "choice2"),
    c: column("optionc", "choicec", "c", "choice3"),
    d: column("optiond", "choiced", "d", "choice4"),
    answer: column("answer", "correctanswer", "correct", "key"),
    accepted: column("acceptedanswers", "accepted", "accept", "alternatives"),
    explanation: column("explanation", "rationale", "note"),
    difficulty: column("difficulty", "level", "band")
  };

  if (idx.text === -1) {
    throw new Error('CSV is missing a "question" column.');
  }

  const cell = (row, index) => (index >= 0 && index < row.length ? String(row[index]).trim() : "");
  const list = [];
  const warnings = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];

    if (row.length < header.length) {
      warnings.push(
        `Row ${r + 1}: found ${row.length} of ${header.length} columns; missing trailing columns are treated as empty.`,
      );
    } else if (row.length > header.length) {
      warnings.push(
        `Row ${r + 1}: found ${row.length} columns but the header has ${header.length}; extra columns are ignored.`,
      );
    }

    while (row.length < header.length) {
      row.push("");
    }

    const options = [cell(row, idx.a), cell(row, idx.b), cell(row, idx.c), cell(row, idx.d)];

    while (options.length > 0 && options[options.length - 1].length === 0) {
      options.pop();
    }

    list.push({
      type: cell(row, idx.type),
      difficulty: cell(row, idx.difficulty),
      text: cell(row, idx.text),
      options: options.length > 0 ? options : null,
      correctAnswer: cell(row, idx.answer),
      acceptedAnswers: cell(row, idx.accepted),
      explanation: cell(row, idx.explanation)
    });
  }

  return { questions: list, warnings };
}

/* ============================ Plain text ============================ */

function parseTextQuestions(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\s*\n/).map((block) => block.trim()).filter((block) => block.length > 0);

  return blocks.map((block) => {
    const entry = {
      type: "",
      difficulty: "",
      text: "",
      options: [],
      correctAnswer: "",
      acceptedAnswers: "",
      explanation: ""
    };
    const lines = block.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

    let lastField = "";

    lines.forEach((line) => {
      const question = line.match(/^(?:q(?:uestion)?)\s*[:\-]\s*(.+)$/i);
      const answer = line.match(/^(?:answer|ans|correct(?:\s*answer)?)\s*[:\-]\s*(.+)$/i);
      const accepted = line.match(/^(?:accept(?:ed)?(?:\s*answers?)?|alternatives?)\s*[:\-]\s*(.+)$/i);
      const explanation = line.match(/^(?:explanation|rationale|note)\s*[:\-]\s*(.+)$/i);
      const difficulty = line.match(/^(?:difficulty|level|band)\s*[:\-]\s*(.+)$/i);
      const option = line.match(/^([A-Za-z])[\).:\-]\s*(.+)$/);

      if (question) {
        entry.text = question[1].trim();
        lastField = "text";
      } else if (answer) {
        entry.correctAnswer = answer[1].trim();
        lastField = "correctAnswer";
      } else if (accepted) {
        entry.acceptedAnswers = accepted[1].trim();
        lastField = "acceptedAnswers";
      } else if (explanation) {
        entry.explanation = explanation[1].trim();
        lastField = "explanation";
      } else if (difficulty) {
        entry.difficulty = difficulty[1].trim();
        lastField = "difficulty";
      } else if (option) {
        entry.options.push(option[2].trim());
        lastField = "";
      } else if (lastField) {
        entry[lastField] += ` ${line}`;
      }
    });

    return entry;
  });
}

/* ============================ Entry point ============================ */

/** Heuristic used when a file has no usable extension. */
function looksLikeCsv(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim().length > 0) || "";

  if (firstLine.indexOf(",") === -1) {
    return false;
  }

  const tokens = squeezeToken(firstLine);

  return tokens.indexOf("question") !== -1 || tokens.indexOf("answer") !== -1 || tokens.indexOf("option") !== -1;
}

/**
 * Parses a file's text into validated question objects.
 *
 * @param {string} fileName Used to pick the format by extension.
 * @param {string} content  Raw file text.
 * @returns {{questions: object[], errors: string[], warnings: string[]}}
 */
function parseImportFile(fileName, content) {
  const text = String(content === null || content === undefined ? "" : content);
  const extension = getFileExtension(fileName);
  let rawList;
  let warnings = [];

  try {
    if (extension === "json") {
      rawList = parseJsonQuestions(text);
    } else if (extension === "csv") {
      const csv = parseCsvQuestions(text);

      rawList = csv.questions;
      warnings = csv.warnings;
    } else if (extension === "txt") {
      rawList = parseTextQuestions(text);
    } else {
      const trimmed = text.trim();

      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        rawList = parseJsonQuestions(text);
      } else if (looksLikeCsv(text)) {
        const csv = parseCsvQuestions(text);

        rawList = csv.questions;
        warnings = csv.warnings;
      } else {
        rawList = parseTextQuestions(text);
      }
    }
  } catch (error) {
    return { questions: [], errors: [error && error.message ? error.message : "Could not read the file."], warnings: [] };
  }

  const questions = [];
  const errors = [];

  (Array.isArray(rawList) ? rawList : []).forEach((raw, index) => {
    const result = normalizeRawQuestion(raw, index);

    if (result.ok) {
      questions.push(result.question);
    } else {
      errors.push(result.error);
    }
  });

  return { questions, errors, warnings };
}
