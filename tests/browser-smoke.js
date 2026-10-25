#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Browser smoke test runner.
 *
 * Builds a temporary copy of index.html with the smoke script inlined,
 * serves the app over HTTP, drives it in a headless Edge/Chrome and
 * reports every check. Run with: npm run test:browser
 */
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const TEMP_HTML = path.join(SRC, "__smoke.html");
const PORT = 8124;

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml"
};

function findBrowser() {
  const found = BROWSERS.find((candidate) => fs.existsSync(candidate));

  return found || null;
}

function buildPage() {
  const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "bank.js"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "smoke-script.js"), "utf8");

  const page = html.replace(
    "</body>",
    `  <script>\n${fixture}\n  </script>\n  <script>\n${script}\n  </script>\n</body>`
  );

  fs.writeFileSync(TEMP_HTML, page, "utf8");
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(SRC, url === "/" ? "index.html" : url);

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

function runBrowser(browser) {
  return new Promise((resolve) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--window-size=1400,1000",
      "--virtual-time-budget=15000",
      "--dump-dom",
      `http://localhost:${PORT}/__smoke.html`
    ];

    const child = spawn(browser, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";

    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });

    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}

function main() {
  const browser = findBrowser();

  if (!browser) {
    console.log("SKIP: no Edge or Chrome found, the browser smoke test cannot run.");
    process.exit(0);
  }

  buildPage();

  let server = null;

  startServer()
    .then((running) => {
      server = running;
      return runBrowser(browser);
    })
    .then((dom) => {
      const match = dom.match(/<pre id="smoke-results">([\s\S]*?)<\/pre>/);

      if (!match) {
        console.error("FAIL: the smoke test produced no results.");
        process.exitCode = 1;
        return;
      }

      const results = match[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim()
        .split("\n");

      results.forEach((line) => console.log(line));

      const failures = results.filter((line) => line.startsWith("FAIL"));

      console.log("");
      console.log(`${results.length - failures.length} passed, ${failures.length} failed.`);

      if (failures.length > 0) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error("The browser smoke test crashed:", error);
      process.exitCode = 1;
    })
    .finally(() => {
      if (fs.existsSync(TEMP_HTML)) {
        fs.unlinkSync(TEMP_HTML);
      }

      if (server) {
        server.close();
      }
    });
}

main();
