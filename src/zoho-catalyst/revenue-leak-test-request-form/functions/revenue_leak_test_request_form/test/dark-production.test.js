"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { createRequestListener } = require("../lib/catalyst-adapter");
const { REVISION } = require("./helpers");

test("dark Production rejects before SDK load, route, store, CRM, or secret access", async () => {
  let sdkLoaded = false;
  let handled = false;
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.payload = value; },
  };
  const originalLoad = Module._load;
  Module._load = function guardedLoad(request, parent, isMain) {
    if (request === "zcatalyst-sdk-node") {
      sdkLoaded = true;
      throw new Error("must not load SDK");
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const listener = createRequestListener({
      environment: {
        DEPLOYMENT_ENVIRONMENT: "production",
        DEPLOYMENT_MODE: "dark",
        SOURCE_REVISION: REVISION,
      },
      artifactSourceRevision: REVISION,
      logger: { info() {}, error() {} },
      now: () => 100,
      randomUUID: () => "10000000-0000-4000-8000-000000000001",
      requestHandler: async () => {
        handled = true;
        throw new Error("must not handle");
      },
    });
    await listener({ headers: {} }, response);
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(sdkLoaded, false);
  assert.equal(handled, false);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.payload), {
    ok: false,
    code: "service_unavailable",
    requestId: "10000000-0000-4000-8000-000000000001",
  });
});
