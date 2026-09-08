"use strict";

const crypto = require("node:crypto");
const { APPROVED_FORMS_PUBLIC_HOSTS } = require("./destinations");

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
      let setupToken = fragment.get("setupToken") || "";
      let verificationId = "";
      let busy = "";
      let closed = false;
      let emailVerified = false;
      let canVerify = false;
      let canResend = false;
      history.replaceState(null, "", location.pathname);
      const showStatus = (message, tone = "neutral") => {
        status.textContent = message;
        status.dataset.tone = tone;
      };
      const updateControls = () => {
        code.disabled = Boolean(busy) || closed || !canVerify;
        button.disabled = Boolean(busy) || closed || !canVerify;
        resend.disabled = Boolean(busy) || closed || !canResend;
        button.setAttribute("aria-busy", String(busy === "verify"));
        resend.setAttribute("aria-busy", String(busy === "send"));
        button.textContent = busy === "verify" ? "Verifying…"
          : emailVerified ? "Email verified" : "Continue to setup";
        resend.textContent = busy === "send" ? "Sending code…" : "Send another code";
      };
      const close = (message, verified = false) => {
        closed = true;
        busy = "";
        emailVerified = verified;
        setupToken = "";
        verificationId = "";
        code.value = "";
        showStatus(message, verified ? "success" : "warning");
        updateControls();
      };
      if (!/^[A-Za-z0-9_-]{43}$/.test(setupToken)) {
        close("This setup link is unavailable. Open setup again from CRM.");
        return;
      }
      const sendBody = async (path, body) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const response = await fetch(path, {
            method: "POST", credentials: "omit", cache: "no-store", redirect: "error",
            headers: { "content-type": "application/json" }, body, signal: controller.signal,
          });
          const result = await response.json();
          if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
          return { response, body: result };
        } finally {
          clearTimeout(timeout);
        }
      };
      const send = (path, value) => sendBody(path, JSON.stringify(value));
      const openSetup = (body) => {
        if (typeof body.formUrl !== "string") return false;
        let destination;
        try { destination = new URL(body.formUrl); } catch { return false; }
        const parameters = [...destination.searchParams.values()];
        if (destination.protocol !== "https:" || destination.username || destination.password ||
            destination.port || destination.hash || body.formUrl !== destination.href ||
            !${JSON.stringify(APPROVED_FORMS_PUBLIC_HOSTS)}.includes(destination.hostname) ||
            destination.pathname === "/" || parameters.length !== 1 ||
            !/^[A-Za-z0-9_-]{43}$/.test(parameters[0])) return false;
        close("Email verified. Opening your setup form…", true);
        // Give the live status a paint before navigation; this never retries I/O.
        setTimeout(() => {
          try { location.assign(destination.href); }
          catch { showStatus("Email verified. The setup form could not open. Contact your operator.", "warning"); }
        }, 150);
        return true;
      };
      const setupPending = (response, body) => {
        if (response.status !== 503 || body.ok !== false ||
            body.state !== "verified_setup_pending" || body.code !== "setup_preparation_unavailable") return false;
        close("Email verified. Setup is temporarily unavailable. Contact your operator to resume.", true);
        return true;
      };
      const requestCode = async (initial = false) => {
        if (busy || closed || (!initial && !canResend)) return;
        busy = "send";
        code.value = "";
        updateControls();
        showStatus("Requesting your verification email…");
        try {
          let result;
          if (verificationId) {
            result = await send(${JSON.stringify(requestPath)}, { verificationId });
          } else {
            const body = JSON.stringify({ setupToken });
            setupToken = "";
            result = await sendBody(${JSON.stringify(requestPath)}, body);
          }
          const { response, body } = result;
          if (setupPending(response, body)) return;
          const validIdentity = typeof body.verificationId === "string" &&
            /^[a-f0-9]{64}$/.test(body.verificationId);
          const acceptedRequest = response.status === 202 && body.ok === true && validIdentity;
          const rejectedRequest = response.status === 503 && body.ok === false && validIdentity;
          if (response.status === 200 && body.ok === true && body.state === "already_verified" &&
              validIdentity && openSetup(body)) return;
          if (acceptedRequest && body.state === "sent_confirmed") {
            verificationId = body.verificationId;
            canVerify = true;
            canResend = true;
            code.value = "";
            showStatus("Code sent. Enter the latest eight-digit code from the approved email address.", "success");
          } else if (rejectedRequest && body.state === "retryable_failure") {
            verificationId = body.verificationId;
            canVerify = false;
            canResend = true;
            showStatus("The email was not sent. Select Send another code only when ready to retry.", "warning");
          } else if (acceptedRequest && body.state === "in_flight") {
            close("The email request is still processing. Do not request another code; contact your operator.");
          } else if (rejectedRequest && body.state === "delivery_disabled") {
            close("Email delivery is disabled in this test environment.");
          } else if (rejectedRequest && body.state === "terminal_failure") {
            close("The verification email could not be sent. Contact your operator before trying again.");
          } else {
            close("The email request could not be confirmed. Do not request another code; contact your operator.");
          }
        } catch {
          close("The email request outcome is unknown. Do not request another code; contact your operator.");
        } finally {
          busy = "";
          updateControls();
          if (!code.disabled) code.focus();
        }
      };
      requestCode(true);
      resend.addEventListener("click", () => requestCode());
      const verifyCode = async () => {
        if (busy || closed || !canVerify) return;
        const value = code.value.trim();
        if (!/^[0-9]{8}$/.test(value)) {
          showStatus("Enter the eight-digit code from your email.", "warning");
          code.focus();
          return;
        }
        busy = "verify";
        updateControls();
        showStatus("Checking your code and preparing setup…");
        try {
          const { response, body } = await send(${JSON.stringify(verifyPath)}, {
            verificationId, code: value,
          });
          if (setupPending(response, body)) return;
          if (response.status === 200 && body.ok === true && openSetup(body)) return;
          if (response.status === 403 && body.ok === false && body.code === "verification_required") {
            showStatus("This code is not currently accepted. Check the latest email code or contact your operator.", "warning");
          } else {
            close("Verification could not be completed. This does not mean the code was wrong. Do not request another code; contact your operator.");
          }
        } catch {
          close("The verification outcome is unknown. Do not enter another code or resend; contact your operator.");
        } finally {
          busy = "";
          updateControls();
        }
      };
      button.addEventListener("click", verifyCode);
      code.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); verifyCode(); }
      });
    })();`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify setup access</title>
<style nonce="${escapeHtml(nonce)}">body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f5f7f8;color:#152025}main{max-width:34rem;margin:10vh auto;padding:2rem;background:#fff;border:1px solid #e3edef;border-radius:1rem;box-shadow:0 8px 30px #0001}h1{letter-spacing:-.035em}label,input,button{display:block;width:100%;box-sizing:border-box}label{font-size:.9rem;font-weight:600}input{font:inherit;font-size:1.3rem;letter-spacing:.2em;padding:.85rem;margin:.5rem 0 1.25rem;border:1px solid #aac5ca;border-radius:.5rem;background:#fff;color:#152025}button{position:relative;min-height:3rem;padding:.85rem;background:#00A6C1;color:#061a1e;border:1px solid transparent;border-radius:.5rem;font:inherit;font-weight:650;cursor:pointer;transition:background .16s,box-shadow .16s,transform .16s}button+button{margin-top:.75rem;background:#e1f8fc;color:#064d5a;border-color:#8ad2dd}button:not(:disabled):hover{background:#0094ad;box-shadow:0 4px 12px #006e8024;transform:translateY(-1px)}button+button:not(:disabled):hover{background:#cef1f7}button:not(:disabled):active{transform:translateY(1px);box-shadow:0 1px 3px #006e8024}button:focus-visible,input:focus-visible{outline:3px solid #075a6a;outline-offset:3px}button:disabled{cursor:default;opacity:.55;transform:none;box-shadow:none}input:disabled{background:#f5f8f9}button[aria-busy="true"]{opacity:1;cursor:wait}button[aria-busy="true"]::before{content:"";display:inline-block;width:.85rem;height:.85rem;margin-right:.65rem;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-.1rem;animation:spin .7s linear infinite}#status{min-height:3.5rem;line-height:1.5;color:#425b61}#status[data-tone="success"]{color:#006879}#status[data-tone="warning"]{color:#805016}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){button{transition:none}button:not(:disabled):hover,button:not(:disabled):active{transform:none}button[aria-busy="true"]::before{animation:none}}@media(max-width:40rem){main{margin:4vh 1rem;padding:1.5rem}}</style>
</head><body><main><h1>Verify your email</h1><p id="status" role="status" aria-live="polite" aria-atomic="true">Preparing secure access…</p><label for="code">Eight-digit code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" aria-describedby="status" disabled><button id="verify" type="button" aria-busy="false" disabled>Continue to setup</button><button id="resend" type="button" aria-busy="false" disabled>Send another code</button><noscript>JavaScript is required for secure verification.</noscript></main><script nonce="${escapeHtml(nonce)}">${script}</script></body></html>`;
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
