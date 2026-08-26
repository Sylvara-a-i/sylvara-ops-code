"use strict";

const crypto = require("node:crypto");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validatePath(value) {
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value ?? "")) {
    throw new Error("Access-page route configuration is invalid");
  }
  return value;
}

function renderAccessPage({ otpRequestPath, otpVerifyPath, randomBytes = crypto.randomBytes }) {
  const requestPath = validatePath(otpRequestPath);
  const verifyPath = validatePath(otpVerifyPath);
  const bytes = randomBytes(18);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 18) {
    throw new Error("Access-page nonce source is invalid");
  }
  const nonce = bytes.toString("base64");
  const script = `
    (() => {
      "use strict";
      const status = document.getElementById("status");
      const code = document.getElementById("code");
      const button = document.getElementById("verify");
      const resend = document.getElementById("resend");
      const fragment = new URLSearchParams(location.hash.slice(1));
      const setupToken = fragment.get("setupToken") || "";
      history.replaceState(null, "", location.pathname);
      if (!/^[A-Za-z0-9_-]{43}$/.test(setupToken)) {
        status.textContent = "This setup link is unavailable.";
        button.disabled = true;
        resend.disabled = true;
        return;
      }
      const send = (path, body) => fetch(path, {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (response) => ({ response, body: await response.json() }));
      const requestCode = () => {
        resend.disabled = true;
        return send(${JSON.stringify(requestPath)}, { setupToken })
          .then(({ response, body }) => {
          if (response.ok && typeof body.formUrl === "string") {
            location.assign(body.formUrl);
            return;
          }
          if (response.ok && body.state === "sent_confirmed") {
            status.textContent = "A verification code was sent to the approved email address.";
            code.disabled = false;
            button.disabled = false;
            resend.disabled = false;
            return;
          }
          code.disabled = true;
          button.disabled = true;
          if (body.state === "in_flight") {
            status.textContent = "The email request is still processing. Wait before trying again.";
            resend.disabled = false;
          } else if (body.state === "retryable_failure") {
            status.textContent = "The verification email could not be sent. Select Send another code to retry.";
            resend.disabled = false;
          } else if (body.state === "delivery_disabled") {
            status.textContent = "Email delivery is disabled in this test environment.";
          } else {
            status.textContent = "Email verification is unavailable.";
          }
        })
          .catch(() => {
            status.textContent = "Verification is temporarily unavailable.";
            resend.disabled = false;
          });
      };
      requestCode();
      resend.addEventListener("click", requestCode);
      button.addEventListener("click", async () => {
        const value = code.value.trim();
        if (!/^[0-9]{8}$/.test(value)) {
          status.textContent = "Enter the eight-digit code from your email.";
          return;
        }
        button.disabled = true;
        try {
          const { response, body } = await send(${JSON.stringify(verifyPath)}, {
            setupToken,
            code: value,
          });
          if (!response.ok || typeof body.formUrl !== "string") {
            status.textContent = "That code could not be verified.";
            button.disabled = false;
            return;
          }
          location.assign(body.formUrl);
        } catch {
          status.textContent = "Verification is temporarily unavailable.";
          button.disabled = false;
        }
      });
    })();`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify setup access</title>
<style nonce="${escapeHtml(nonce)}">body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f5f7f8;color:#152025}main{max-width:34rem;margin:10vh auto;padding:2rem;background:#fff;border-radius:1rem;box-shadow:0 8px 30px #0001}label,input,button{display:block;width:100%;box-sizing:border-box}input{font-size:1.25rem;padding:.75rem;margin:.5rem 0 1rem}button{padding:.8rem;background:#00A6C1;color:#061a1e;border:0;border-radius:.5rem;font-weight:650}button+button{margin-top:.75rem;background:#e1f8fc;color:#064d5a;border:1px solid #00A6C1}#status{min-height:2.5rem}</style>
</head><body><main><h1>Verify your email</h1><p id="status">Preparing secure access…</p><label for="code">Eight-digit code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" disabled><button id="verify" type="button" disabled>Continue to setup</button><button id="resend" type="button" disabled>Send another code</button><noscript>JavaScript is required for secure verification.</noscript></main><script nonce="${escapeHtml(nonce)}">${script}</script></body></html>`;
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
