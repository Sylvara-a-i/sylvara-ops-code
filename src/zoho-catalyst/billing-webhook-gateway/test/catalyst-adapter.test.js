"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { createRequestListener } = require("../lib/catalyst-adapter");
const {
  CREATOR_DESTINATION_SHA256,
  TEST_EVENT_TIME,
  TEST_NOW_MS,
  TEST_SOURCE_REVISION,
  baseEnvironment,
} = require("./helpers");

test("entrypoint exports the native server required by blank Advanced I/O", () => {
  const server = require("../index");
  assert.ok(server instanceof http.Server);
  assert.equal(server.listenerCount("request"), 1);
  assert.equal(server.listening, false);
});

test("Catalyst adapter initializes the SDK and completes a signed request", async () => {
  const environment = baseEnvironment();
  const rawBody = Buffer.from(JSON.stringify({
    event_id: "event_sample_001",
    event_type: "subscription_created",
    event_time: TEST_EVENT_TIME,
  }), "utf8");
  const signature = crypto
    .createHmac("sha256", environment.BILLING_WEBHOOK_SECRET)
    .update(rawBody)
    .digest(environment.BILLING_SIGNATURE_ENCODING);
  const request = {
    method: "POST",
    url: environment.ALLOWED_PATH,
    rawBody,
    headers: {
      "content-type": environment.BILLING_CONTENT_TYPE,
      "content-length": String(rawBody.length),
      "x-zoho-webhook-signature": signature,
      "x-zc-environment": "Development",
    },
  };
  const calls = { initializedWith: null, inserted: [], updated: [] };
  const catalystSdk = {
    initialize(received) {
      calls.initializedWith = received;
      return {
        config: { environment: "Development" },
        datastore() {
          return {
            table() {
              return {
                async insertRow(row) {
                  calls.inserted.push(row);
                  return { ...row, ROWID: "1000000000001" };
                },
                async updateRow(row) {
                  calls.updated.push(row);
                  return row;
                },
              };
            },
          };
        },
        zcql() {
          return {
            async executeZCQLQuery() {
              return [{
                Billing_Webhook_Inbox: {
                  ROWID: "1000000000001",
                  STATUS: "completed",
                  LAST_OUTCOME: "registered_only",
                },
              }];
            },
          };
        },
      };
    },
  };
  const logLines = [];
  const logger = {
    info(line) { logLines.push(line); },
    error(line) { logLines.push(line); },
  };
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
  const listener = createRequestListener({
    catalystSdk,
    environment,
    logger,
    randomUUID: () => "request_sample_001",
    now: () => TEST_NOW_MS,
    artifactCreatorDestinationSha256: CREATOR_DESTINATION_SHA256,
    artifactSourceRevision: TEST_SOURCE_REVISION,
  });
  await listener(request, response);

  assert.equal(calls.initializedWith, request);
  assert.equal(calls.inserted.length, 1);
  assert.deepEqual(calls.updated, [{
    ROWID: "1000000000001",
    STATUS: "completed",
    LAST_OUTCOME: "registered_only",
  }]);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).request_id, "request_sample_001");
  assert.equal(JSON.parse(logLines[0]).outcome, "completed");
});

test("Catalyst adapter rejects absent, invalid, or mismatched platform environments", async () => {
  const cases = [
    { headerEnvironment: undefined, sdkEnvironment: "Development" },
    { headerEnvironment: "unexpected", sdkEnvironment: "Development" },
    { headerEnvironment: "Production", sdkEnvironment: "Production" },
    { headerEnvironment: "Development", sdkEnvironment: undefined },
    { headerEnvironment: "Development", sdkEnvironment: "Production" },
  ];
  for (const { headerEnvironment, sdkEnvironment } of cases) {
    let datastoreAccessed = false;
    const app = {
      config: sdkEnvironment === undefined ? {} : { environment: sdkEnvironment },
      datastore() {
        datastoreAccessed = true;
        throw new Error("must not access Data Store after an environment mismatch");
      },
    };
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { this.body = body; },
    };
    const listener = createRequestListener({
      catalystSdk: { initialize: () => app },
      environment: baseEnvironment(),
      logger: { info() {}, error() {} },
      randomUUID: () => "request_environment_check",
      now: () => TEST_NOW_MS,
      artifactCreatorDestinationSha256: CREATOR_DESTINATION_SHA256,
      artifactSourceRevision: TEST_SOURCE_REVISION,
    });

    const request = { method: "POST", headers: {} };
    if (headerEnvironment !== undefined) {
      request.headers["x-zc-environment"] = headerEnvironment;
    }
    await listener(request, response);

    assert.equal(datastoreAccessed, false);
    assert.equal(response.statusCode, 503);
    assert.equal(JSON.parse(response.body).code, "configuration_invalid");
  }
});
