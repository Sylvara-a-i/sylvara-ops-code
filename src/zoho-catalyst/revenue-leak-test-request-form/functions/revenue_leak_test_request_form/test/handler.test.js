"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { handleRequest } = require("../lib/handler");

const ISSUE_SECRET = "i".repeat(43);
const PREFILL_SECRET = "p".repeat(43);

function config() {
  return {
    issuePath: "/form1/issue-test",
    prefillPath: "/form1/prefill-test",
    issueHeaderName: "x-sylvara-issue-test",
    prefillHeaderName: "x-sylvara-prefill-test",
    issueHeaderSecret: ISSUE_SECRET,
    prefillHeaderSecret: PREFILL_SECRET,
  };
}

function unreadRequest(path, secretName, secret) {
  let payloadRead = false;
  const request = {
    method: "POST",
    url: path,
    headers: {
      "content-type": "application/json",
      [secretName]: secret,
    },
    on() {
      payloadRead = true;
      throw new Error("contained route must not attach payload listeners");
    },
  };
  Object.defineProperty(request, "rawBody", {
    get() {
      payloadRead = true;
      throw new Error("contained route must not read a buffered payload");
    },
  });
  return { request, payloadWasRead: () => payloadRead };
}

function guardedDependencies(events) {
  return new Proxy({ config: config() }, {
    get(target, key) {
      if (key !== "config") events.push(String(key));
      return Reflect.get(target, key);
    },
  });
}

test("Issue and Prefill return the exact contained response without payload or dependency access", async () => {
  const cases = [
    ["/form1/issue-test", "x-sylvara-issue-test", ISSUE_SECRET, "issue"],
    ["/form1/prefill-test", "x-sylvara-prefill-test", PREFILL_SECRET, "prefill"],
  ];
  for (const [path, headerName, secret, stage] of cases) {
    const events = [];
    const fixture = unreadRequest(path, headerName, secret);
    const result = await handleRequest(fixture.request, guardedDependencies(events));
    assert.deepEqual(result, {
      status: 503,
      body: { ok: false, code: "configuration_invalid" },
      stage,
      outcome: "assisted_route_disabled",
    });
    assert.equal(fixture.payloadWasRead(), false);
    assert.deepEqual(events, []);
  }
});

test("route authentication and the exact no-query route boundary precede containment", async () => {
  const wrongSecret = unreadRequest(
    "/form1/issue-test",
    "x-sylvara-issue-test",
    "wrong",
  );
  await assert.rejects(
    () => handleRequest(wrongSecret.request, { config: config() }),
    (error) => error.status === 401 && error.publicCode === "authentication_failed",
  );
  assert.equal(wrongSecret.payloadWasRead(), false);

  const queried = unreadRequest(
    "/form1/issue-test?leadId=forbidden",
    "x-sylvara-issue-test",
    ISSUE_SECRET,
  );
  await assert.rejects(
    () => handleRequest(queried.request, { config: config() }),
    (error) => error.status === 404 && error.publicCode === "route_not_found",
  );
  assert.equal(queried.payloadWasRead(), false);

  const wrongType = unreadRequest(
    "/form1/prefill-test",
    "x-sylvara-prefill-test",
    PREFILL_SECRET,
  );
  wrongType.request.headers["content-type"] = "text/plain";
  await assert.rejects(
    () => handleRequest(wrongType.request, { config: config() }),
    (error) => error.status === 415 && error.publicCode === "content_type_not_allowed",
  );
  assert.equal(wrongType.payloadWasRead(), false);
});
