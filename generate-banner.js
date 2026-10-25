#!/usr/bin/env node
/**
 * Generates banner_wide.png from byte_builders_wide.gif using a headless
 * browser canvas. Run with: node generate-banner.js
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname);
const SRC = path.join(ROOT, "src");
const TEMP_HTML = path.join(SRC, "__generate-banner.html");
const OUTPUT = path.join(SRC, "assets", "banner_wide.png");
const PORT = 8125;

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const SCRIPT = `
(function() {
  const img = new Image();
  img.onload = function() {
    const canvas = document.getElementById("c");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    document.getElementById("result").textContent = dataUrl;
  };
  img.onerror = function() {
    document.getElementById("result").textContent = "ERROR: could not load image";
  };
  img.src = "assets/byte_builders_wide.gif";
})();
`;

function findBrowser() {
  return BROWSERS.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildPage() {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
    <canvas id="c"></canvas>
    <pre id="result"></pre>
    <script>${SCRIPT}</script>
  </body></html>`;
  fs.writeFileSync(TEMP_HTML, html, "utf8");
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(SRC, url === "/" ? "__generate-banner.html" : url);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      const types = { ".html": "text/html", ".gif": "image/gif", ".png": "image/png" };
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function runBrowser(browser) {
  return new Promise((resolve) => {
    const child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--no-sandbox",
      "--virtual-time-budget=15000", "--dump-dom",
      "http://localhost:" + PORT + "/__generate-banner.html"
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.on("close", () => resolve(out));
    child.on("error", () => resolve(""));
  });
}

function main() {
  const browser = findBrowser();
  if (!browser) { console.log("SKIP: no browser found"); process.exit(0); }
  buildPage();
  let server = null;
  startServer().then((running) => {
    server = running;
    return runBrowser(browser);
  }).then((dom) => {
    const match = dom.match(/<pre id="result">([^]*?)<\/pre>/);
    if (!match || match[1].startsWith("ERROR")) {
      console.error("FAIL: could not convert banner", match ? match[1].trim() : "no output");
      process.exitCode = 1;
      return;
    }
    const dataUrl = match[1].trim();
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, Buffer.from(base64, "base64"));
    console.log("OK: wrote " + OUTPUT + " (" + fs.statSync(OUTPUT).size + " bytes)");
  }).catch((error) => {
    console.error("Error:", error);
    process.exitCode = 1;
  }).finally(() => {
    if (fs.existsSync(TEMP_HTML)) fs.unlinkSync(TEMP_HTML);
    if (server) server.close();
  });
}

main();