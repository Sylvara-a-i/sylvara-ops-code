"use strict";

const crypto = require("node:crypto");

function validatePath(value) {
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value ?? "")) {
    throw new Error("Access-page route configuration is invalid");
  }
  return value;
}

function renderAccessPage({ exchangePath, randomBytes = crypto.randomBytes }) {
  const path = validatePath(exchangePath);
  const bytes = randomBytes(18);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 18) {
    throw new Error("Access-page nonce source is invalid");
  }
  const nonce = bytes.toString("base64");
  const script = `
    (() => {
      "use strict";
      const status = document.getElementById("status");
      const fragment = new URLSearchParams(location.hash.slice(1));
      let journeyToken = fragment.get("journeyToken") || "";
      history.replaceState(null, "", location.pathname);
      if (!/^[A-Za-z0-9_-]{43}$/.test(journeyToken)) {
        journeyToken = "";
        status.textContent = "This setup link is unavailable.";
        return;
      }
      const body = JSON.stringify({ journeyToken });
      journeyToken = "";
      fetch(${JSON.stringify(path)}, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body,
      }).then(async (response) => ({ response, body: await response.json() }))
        .then(({ response, body: result }) => {
          if (!response.ok || typeof result.formUrl !== "string") {
            status.textContent = "This setup link is unavailable.";
            return;
          }
          location.replace(result.formUrl);
        })
        .catch(() => {
          status.textContent = "Setup is temporarily unavailable.";
        });
    })();`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open free-test request</title>
<style nonce="${nonce}">body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f5f7f8;color:#152025}main{max-width:34rem;margin:10vh auto;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 8px 30px #0001}#status{min-height:2.5rem}</style>
</head><body><main><h1>Preparing your request</h1><p id="status">Opening the secure form…</p><noscript>JavaScript is required for secure setup.</noscript></main><script nonce="${nonce}">${script}</script></body></html>`;
  return Object.freeze({
    html,
    headers: Object.freeze({
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    }),
  });
}

module.exports = { renderAccessPage };
