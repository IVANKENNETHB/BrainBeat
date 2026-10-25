/**
 * Test fixture: a representative question bank for BrainBeat.so.
 * -----------------------------------------------------------
 * The application ships without a built-in bank, so the test harnesses
 * use this file instead. It is built to match the shape the quiz engine
 * and the assertions expect:
 *
 *   - 84 questions with unique ids
 *   - the bands easy (16), normal (21), hard (13) and expert (34)
 *   - 48 multiple choice + 36 scramble
 *   - id 25 is the "Phishing" scramble the answer checks rely on
 */
(function (global) {
  "use strict";

  // [term, short definition]
  const TERMS = [
    ["Firewall", "Filters network traffic using security rules"],
    ["Phishing", "Tricking people into revealing sensitive information"],
    ["Malware", "Software designed to damage or hijack a system"],
    ["Backup", "A safe copy of data kept for recovery"],
    ["Password", "A secret used to prove who you are"],
    ["Encryption", "Turning readable data into a coded form"],
    ["Antivirus", "Software that finds and removes malicious programs"],
    ["Access Control", "Deciding who may reach a resource"],
    ["Vulnerability", "A weakness that a system can be abused through"],
    ["Patch", "A fix shipped for a known flaw"],
    ["Two-Factor Authentication", "Using a password plus a second proof of identity"],
    ["Spam", "Unsolicited bulk messages"],
    ["Botnet", "A group of infected devices controlled remotely"],
    ["Ransomware", "Malware that locks data until a payment is made"],
    ["Spyware", "Software that secretly watches what a user does"],
    ["Adware", "Software that shows unwanted advertisements"],
    ["Trojan", "Malware disguised as a legitimate program"],
    ["Worm", "Malware that spreads from host to host on its own"],
    ["Rootkit", "Tools that hide an intruder inside a system"],
    ["Brute Force", "Trying many passwords until one works"],
    ["DDoS", "Flooding a service with traffic until it falls over"],
    ["Man-in-the-Middle", "Intercepting the traffic between two parties"],
    ["SQL Injection", "Pushing rogue SQL into an application's query"],
    ["XSS", "Injecting script into a page that a victim opens"],
    ["VPN", "A private encrypted tunnel to a remote network"],
    ["Proxy", "A middle server that forwards requests"],
    ["DNS", "The directory that turns names into addresses"],
    ["DHCP", "The service that hands out IP addresses"],
    ["NAT", "Translating private addresses into public ones"],
    ["ARP", "Mapping IP addresses to hardware addresses"],
    ["TLS", "The protocol that secures HTTP connections"],
    ["SSH", "A remote shell over an encrypted channel"],
    ["HTTPS", "HTTP running inside TLS"],
    ["MFA", "Two or more proofs of identity for one login"],
    ["SIEM", "A tool that collects and correlates security logs"],
    ["EDR", "Endpoint software that detects and responds to threats"],
    ["SOAR", "Automating security responses across tools"],
    ["IAM", "Managing identities and the permissions they hold"],
    ["Zero Trust", "Never trust, always verify"],
    ["Least Privilege", "Giving only the access that a job needs"],
    ["Defense in Depth", "Layering controls so one failure is not fatal"],
    ["Sandboxing", "Running risky code inside an isolated environment"],
    ["Penetration Testing", "Authorized testing of a system for weaknesses"],
    ["Red Team", "The offensive side of a security exercise"],
    ["Blue Team", "The defensive side of a security exercise"],
    ["Purple Team", "Red and Blue working through a problem together"],
    ["SOC", "The team that watches for security events"],
    ["Incident Response", "The plan for handling a security incident"],
    ["Forensic Analysis", "Digging through evidence after an incident"],
    ["Malware Analysis", "Studying malware to understand its behaviour"],
    ["Threat Intelligence", "Knowledge about who attacks and how"],
    ["CVE", "A public identifier for a known vulnerability"],
    ["Zero-Day", "A flaw that is exploited before a fix exists"],
    ["Exploit", "Code that takes advantage of a flaw"],
    ["Payload", "The part of an attack that does the damage"],
    ["Social Engineering", "Manipulating people instead of machines"],
    ["Tailgating", "Walking in behind someone through a locked door"],
    ["Shoulder Surfing", "Reading a password off someone's screen"],
    ["Insider Threat", "Risk that comes from someone with legitimate access"],
    ["Encryption at Rest", "Data kept on disk is stored in coded form"],
    ["Encryption in Transit", "Data moving across a network is coded"],
    ["Key Management", "Storing, rotating and protecting encryption keys"],
    ["Hashing", "Turning data into a fixed length fingerprint"],
    ["Salting", "Adding random data to a password before hashing"],
    ["Rainbow Table", "A precomputed list of password hashes"],
    ["Phishing Drill", "A rehearsed practice against phishing mails"]
  ];

  // "M" is a multiple choice question, "S" a scramble.
  const BANDS = [
    { name: "easy", layout: "M".repeat(11) + "S".repeat(5) },
    { name: "normal", layout: "MMMMMSMMSMSMSMSMMSMSM" },
    { name: "hard", layout: "M".repeat(9) + "S".repeat(4) },
    { name: "expert", layout: "M".repeat(14) + "S".repeat(20) }
  ];

  const SCRAMBLE_PROMPTS = [
    "Spell the security term shown in the tiles.",
    "Which security term is hidden in the tiles?",
    "Name the security term the tiles spell.",
    "Type the security term the tiles show."
  ];

  /**
   * Normalizes an answer the same way the app does, so a fixture question
   * always accepts its own correct answer.
   *
   * @param {string} value
   * @returns {string}
   */
  function norm(value) {
    return String(value === null || value === undefined ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Builds the fixture bank.
   * @returns {object[]}
   */
  function buildBank() {
    const bank = [];

    let mcIndex = 0;
    let scrambleIndex = 0;

    // The scramble terms are a permutation of the terms, so that the
    // "Phishing" question lands on id 25 without repeating a term.
    const scrambleTerms = TERMS.slice();
    const swapped = scrambleTerms[6];

    scrambleTerms[6] = scrambleTerms[1];
    scrambleTerms[1] = swapped;

    BANDS.forEach((band) => {
      band.layout.split("").forEach((kind) => {
        const position = bank.length + 1;

        // The first 56 questions keep the low ids, the rest are numbered
        // from 2000 on, the same way the original bank was laid out.
        const id = position <= 56 ? position : 2000 + (position - 57);

        if (kind === "M") {
          const term = TERMS[mcIndex % TERMS.length];
          const distractors = [17, 31, 47].map(
            (offset) => TERMS[(mcIndex + offset) % TERMS.length][1]
          );
          const correctIndex = mcIndex % 4;
          const options = distractors.slice();

          options.splice(correctIndex, 0, term[1]);
          mcIndex += 1;

          bank.push({
            id,
            difficulty: band.name,
            type: "multiple-choice",
            text: "What is " + term[0] + "?",
            options,
            correctAnswer: correctIndex,
            acceptedAnswers: [],
            explanation: term[0] + ": " + term[1] + "."
          });

          return;
        }

        const term = scrambleTerms[scrambleIndex % scrambleTerms.length];

        scrambleIndex += 1;

        bank.push({
          id,
          difficulty: band.name,
          type: "scramble",
          text: SCRAMBLE_PROMPTS[(id - 1) % SCRAMBLE_PROMPTS.length],
          options: null,
          correctAnswer: term[0],
          acceptedAnswers: [norm(term[0])],
          explanation: term[1] + "."
        });
      });
    });

    return bank;
  }

  /**
   * Checks that the fixture still has the shape the tests rely on.
   *
   * @param {object[]} bank
   */
  function verify(bank) {
    const problems = [];
    const bandSize = (tag) => bank.filter((q) => q.difficulty === tag).length;
    const countType = (list, type) => list.filter((q) => q.type === type).length;

    if (bank.length !== 84) {
      problems.push("the bank holds " + bank.length + " questions instead of 84");
    }

    [
      ["easy", 16],
      ["normal", 21],
      ["hard", 13],
      ["expert", 34]
    ].forEach((entry) => {
      if (bandSize(entry[0]) !== entry[1]) {
        problems.push(
          "the " + entry[0] + " band holds " + bandSize(entry[0]) + " instead of " + entry[1]
        );
      }
    });

    if (countType(bank, "multiple-choice") !== 48) {
      problems.push("the bank holds the wrong number of multiple choice");
    }

    if (countType(bank, "scramble") !== 36) {
      problems.push("the bank holds the wrong number of scramble");
    }

    const phishing = bank.find((q) => q.id === 25);

    if (!phishing || phishing.type !== "scramble" || phishing.correctAnswer !== "Phishing") {
      problems.push("id 25 is not the Phishing scramble");
    }

    if (problems.length > 0) {
      throw new Error("The fixture bank is broken: " + problems.join("; "));
    }
  }

  const bank = buildBank();

  verify(bank);

  global.TEST_QUESTION_BANK = bank;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = bank;
  }
})(typeof window !== "undefined" ? window : globalThis);
