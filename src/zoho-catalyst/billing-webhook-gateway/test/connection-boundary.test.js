"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ConnectionAuthorizationError,
  createConnectionAuthorizationProvider,
} = require("../lib/connection-boundary");

const VALID_AUTHORIZATION = "Zoho-oauthtoken SyntheticConnectionToken_123456789";
const CONFIG = {
  creatorConnectionLinkName: "SyntheticCreatorConnection",
  platformOperationTimeoutMs: 100,
};

function fixture(result) {
  const calls = [];
  const app = {
    connections() {
      return {
        async getConnectionCredentials(linkName) {
          calls.push(linkName);
          if (result instanceof Error) throw result;
          return result;
        },
      };
    },
  };
  return {
    calls,
    provider: createConnectionAuthorizationProvider(app, CONFIG),
  };
}

test("returns the sole Catalyst Connection Authorization header", async () => {
  const { calls, provider } = fixture({
    headers: { Authorization: VALID_AUTHORIZATION },
    parameters: {},
  });

  assert.equal(await provider(), VALID_AUTHORIZATION);
  assert.deepEqual(calls, [CONFIG.creatorConnectionLinkName]);
});

test("accepts case-insensitive Authorization naming without changing its value", async () => {
  const { provider } = fixture({
    headers: { authorization: VALID_AUTHORIZATION },
    parameters: {},
  });

  assert.equal(await provider(), VALID_AUTHORIZATION);
});

test("rejects missing, malformed, or over-broad credential containers", async () => {
  const invalidResponses = [
    null,
    {},
    { headers: null, parameters: {} },
    { headers: { Authorization: VALID_AUTHORIZATION }, parameters: null },
    { headers: [], parameters: {} },
    { headers: { Authorization: VALID_AUTHORIZATION }, parameters: [] },
    {
      headers: { Authorization: VALID_AUTHORIZATION, "x-extra": "not-approved" },
      parameters: {},
    },
    {
      headers: { Authorization: VALID_AUTHORIZATION, authorization: VALID_AUTHORIZATION },
      parameters: {},
    },
  ];

  for (const response of invalidResponses) {
    const { provider } = fixture(response);
    await assert.rejects(
      provider(),
      (error) => error instanceof ConnectionAuthorizationError &&
        error.publicCode === "connection_unavailable",
    );
  }
});

test("rejects all Connection query parameters", async () => {
  const { provider } = fixture({
    headers: { Authorization: VALID_AUTHORIZATION },
    parameters: { ["access" + "_token"]: "synthetic-prohibited-value" },
  });

  await assert.rejects(
    provider(),
    (error) => error instanceof ConnectionAuthorizationError &&
      error.publicCode === "connection_unavailable",
  );
});

test("rejects invalid Authorization schemes, token shapes, and values", async () => {
  for (const authorization of [
    ["Bearer", "SyntheticConnectionToken_123456789"].join(" "),
    "zoho-oauthtoken SyntheticConnectionToken_123456789",
    "Zoho-oauthtoken short",
    "Zoho-oauthtoken Synthetic Token With Spaces",
    [VALID_AUTHORIZATION],
  ]) {
    const { provider } = fixture({
      headers: { Authorization: authorization },
      parameters: {},
    });
    await assert.rejects(
      provider(),
      (error) => error instanceof ConnectionAuthorizationError &&
        error.publicCode === "connection_unavailable" &&
        !error.message.includes("SyntheticConnectionToken"),
    );
  }
});

test("converts Connection SDK failures to the bounded public error", async () => {
  const { calls, provider } = fixture(new Error("synthetic private SDK failure"));

  await assert.rejects(
    provider(),
    (error) => error instanceof ConnectionAuthorizationError &&
      error.publicCode === "connection_unavailable" &&
      !error.message.includes("private SDK failure"),
  );
  assert.deepEqual(calls, [CONFIG.creatorConnectionLinkName]);
});
