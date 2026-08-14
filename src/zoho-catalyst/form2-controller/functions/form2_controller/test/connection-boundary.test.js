"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ConnectionAuthorizationError,
  createConnectionAuthorizationProvider,
} = require("../lib/connection-boundary");

function appReturning(credentials) {
  return {
    connections() {
      return {
        async getConnectionCredentials() {
          if (credentials instanceof Error) throw credentials;
          return credentials;
        },
      };
    },
  };
}

test("returns the sole OAuth Authorization header", async () => {
  const provider = createConnectionAuthorizationProvider(appReturning({
    headers: { Authorization: `Zoho-oauthtoken ${"a".repeat(24)}` },
    parameters: {},
  }), "synthetic_link", 100);
  assert.match(await provider(), /^Zoho-oauthtoken /);
});

test("rejects parameter credentials and additional headers", async () => {
  const withParameter = createConnectionAuthorizationProvider(appReturning({
    headers: { Authorization: `Zoho-oauthtoken ${"a".repeat(24)}` },
    parameters: { token: "unsafe" },
  }), "synthetic_link", 100);
  await assert.rejects(withParameter(), ConnectionAuthorizationError);

  const withExtraHeader = createConnectionAuthorizationProvider(appReturning({
    headers: {
      Authorization: `Zoho-oauthtoken ${"a".repeat(24)}`,
      "x-extra": "unsafe",
    },
    parameters: {},
  }), "synthetic_link", 100);
  await assert.rejects(withExtraHeader(), ConnectionAuthorizationError);
});
