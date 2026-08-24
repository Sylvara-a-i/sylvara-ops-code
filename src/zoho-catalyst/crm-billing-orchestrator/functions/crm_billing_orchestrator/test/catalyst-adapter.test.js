"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertCatalystRequestBinding,
  assertCatalystSdkBinding,
  createRequestListener,
} = require("../lib/catalyst-adapter");
const { loadConfig } = require("../lib/config");
const {
  DEVELOPMENT_ZAID_HMAC_SHA256,
  REVISION,
  SYNTHETIC_DEVELOPMENT_ZAID,
  baseEnvironment,
} = require("./helpers");

function responseCapture() {
  const result = { body: "", headers: {}, statusCode: null };
  return {
    result,
    response: {
      end: (body) => { result.body = body; },
      setHeader: (name, value) => { result.headers[name] = value; },
      status: (statusCode) => { result.statusCode = statusCode; },
    },
  };
}

function requestFor(environment = baseEnvironment(), overrides = {}) {
  const body = JSON.stringify({
    schemaVersion: "crm-billing-lifecycle-v1",
    action: "reconcile",
    dealId: "100000000000001",
  });
  return {
    method: "POST",
    url: environment.ALLOWED_PATH,
    headers: {
      host: environment.DEVELOPMENT_FUNCTION_HOST,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      "x-zc-project-key": SYNTHETIC_DEVELOPMENT_ZAID,
      [environment.SHARED_HEADER_NAME]: environment.SHARED_HEADER_VALUE,
    },
    body,
    ...overrides,
  };
}

function listenerOptions(environment = baseEnvironment(), overrides = {}) {
  return {
    artifactRevision: REVISION,
    artifactDevelopmentZaidHmacSha256: DEVELOPMENT_ZAID_HMAC_SHA256,
    environment,
    factories: {
      createBillingClient: () => ({}),
      createCrmClient: () => ({}),
      createLifecycleHandler: () => ({
        handle: async () => ({
          duplicate: false,
          outcome: "authoritative_readback_confirmed",
        }),
      }),
      createOperationStore: () => ({}),
    },
    logger: { error: () => {}, info: () => {} },
    now: () => 100,
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
    ...overrides,
  };
}

test("request binding requires the exact Development host and ZAID HMAC", () => {
  const environment = baseEnvironment();
  const config = loadConfig(environment, {
    artifactRevision: REVISION,
    artifactDevelopmentZaidHmacSha256: DEVELOPMENT_ZAID_HMAC_SHA256,
  });
  assert.equal(
    assertCatalystRequestBinding(requestFor(environment), config),
    SYNTHETIC_DEVELOPMENT_ZAID,
  );

  for (const headers of [
    {},
    { host: environment.DEVELOPMENT_FUNCTION_HOST },
    {
      host: "synthetic.catalystserverless.com",
      "x-zc-project-key": SYNTHETIC_DEVELOPMENT_ZAID,
    },
    {
      host: environment.DEVELOPMENT_FUNCTION_HOST,
      "x-zc-project-key": "forged-development-zaid",
    },
    {
      host: environment.DEVELOPMENT_FUNCTION_HOST,
      Host: environment.DEVELOPMENT_FUNCTION_HOST,
      "x-zc-project-key": SYNTHETIC_DEVELOPMENT_ZAID,
    },
    {
      host: environment.DEVELOPMENT_FUNCTION_HOST,
      "x-zc-project-key": SYNTHETIC_DEVELOPMENT_ZAID,
      "X-ZC-Project-Key": SYNTHETIC_DEVELOPMENT_ZAID,
    },
  ]) {
    assert.throws(
      () => assertCatalystRequestBinding({ headers }, config),
      /Catalyst runtime/,
    );
  }
});

test("request binding rejects physical duplicate host and project-key headers", () => {
  const environment = baseEnvironment();
  const config = loadConfig(environment, {
    artifactRevision: REVISION,
    artifactDevelopmentZaidHmacSha256: DEVELOPMENT_ZAID_HMAC_SHA256,
  });
  const baseline = requestFor(environment);

  for (const request of [
    {
      ...baseline,
      headersDistinct: {
        host: [environment.DEVELOPMENT_FUNCTION_HOST],
        "x-zc-project-key": [SYNTHETIC_DEVELOPMENT_ZAID, SYNTHETIC_DEVELOPMENT_ZAID],
      },
    },
    {
      ...baseline,
      rawHeaders: [
        "Host", environment.DEVELOPMENT_FUNCTION_HOST,
        "host", environment.DEVELOPMENT_FUNCTION_HOST,
        "x-zc-project-key", SYNTHETIC_DEVELOPMENT_ZAID,
      ],
    },
    {
      ...baseline,
      rawHeaders: [
        "Host", environment.DEVELOPMENT_FUNCTION_HOST,
        "x-zc-project-key", SYNTHETIC_DEVELOPMENT_ZAID,
        "X-ZC-Project-Key", SYNTHETIC_DEVELOPMENT_ZAID,
      ],
    },
  ]) {
    assert.throws(
      () => assertCatalystRequestBinding(request, config),
      /Catalyst runtime binding/,
    );
  }
});

test("unstamped or incorrect Development binding is rejected", () => {
  const environment = baseEnvironment();
  for (const artifactDevelopmentZaidHmacSha256 of [
    "__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__",
    "0".repeat(64),
    "not-a-digest",
  ]) {
    const config = loadConfig(environment, {
      artifactRevision: REVISION,
      artifactDevelopmentZaidHmacSha256,
    });
    assert.throws(
      () => assertCatalystRequestBinding(requestFor(environment), config),
      /approved Development project/,
    );
  }
});

test("SDK binding requires the same injected Development ZAID and Development routing", () => {
  assert.doesNotThrow(() => assertCatalystSdkBinding(
    { config: { environment: "Development", projectKey: SYNTHETIC_DEVELOPMENT_ZAID } },
    SYNTHETIC_DEVELOPMENT_ZAID,
  ));
  for (const app of [
    null,
    { config: {} },
    { config: { environment: "Development", projectKey: "forged-development-zaid" } },
    { config: { environment: "Production", projectKey: SYNTHETIC_DEVELOPMENT_ZAID } },
  ]) {
    assert.throws(
      () => assertCatalystSdkBinding(app, SYNTHETIC_DEVELOPMENT_ZAID),
      /SDK routing binding/,
    );
  }
});

test("listener accepts a real SDK initialization without x-zc-environment", async () => {
  const environment = baseEnvironment();
  const request = requestFor(environment);
  request.headers["x-zc-projectid"] = "100000000000001";
  request.headers["x-zc-project-domain"] = "https://api.catalyst.zoho.com";
  request.headers["x-zc-admin-cred-type"] = "token";
  request.headers["x-zc-admin-cred-token"] = "synthetic-admin-token";
  request.headers["x-zc-user-cred-type"] = "token";
  request.headers["x-zc-user-cred-token"] = "synthetic-user-token";
  const { response, result } = responseCapture();
  const handler = createRequestListener(listenerOptions(environment));

  await handler(request, response);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    ok: true,
    action: "reconcile",
    outcome: "authoritative_readback_confirmed",
    duplicate: false,
    request_id: "00000000-0000-4000-8000-000000000000",
  });
});

test("listener rejects noncanonical real SDK routing metadata before any factory", async () => {
  const environment = baseEnvironment();
  for (const headers of [
    { "x-zc-environment": "Production" },
    { "x-zc-environment": "development" },
    { "x-zc-environment": " Development " },
    { "x-zc-project-key": ` ${SYNTHETIC_DEVELOPMENT_ZAID} ` },
  ]) {
    const request = requestFor(environment);
    Object.assign(request.headers, headers, {
      "x-zc-projectid": "100000000000001",
      "x-zc-project-domain": "https://api.catalyst.zoho.com",
      "x-zc-admin-cred-type": "token",
      "x-zc-admin-cred-token": "synthetic-admin-token",
      "x-zc-user-cred-type": "token",
      "x-zc-user-cred-token": "synthetic-user-token",
    });
    let factoryCalled = false;
    const { response, result } = responseCapture();
    const options = listenerOptions(environment);
    for (const name of Object.keys(options.factories)) {
      options.factories[name] = () => {
        factoryCalled = true;
        throw new Error("factory must not run");
      };
    }
    const handler = createRequestListener(options);

    await handler(request, response);

    assert.equal(factoryCalled, false);
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).code, "configuration_invalid");
  }
});

test("runtime binding failures happen before SDK initialization", async () => {
  const environment = baseEnvironment();
  for (const request of [
    requestFor(environment, { headers: { host: environment.DEVELOPMENT_FUNCTION_HOST } }),
    requestFor(environment, {
      headers: {
        host: environment.DEVELOPMENT_FUNCTION_HOST,
        "x-zc-project-key": "forged-development-zaid",
      },
    }),
  ]) {
    let initialized = false;
    const { response, result } = responseCapture();
    const handler = createRequestListener(listenerOptions(environment, {
      catalystSdk: {
        initialize: () => {
          initialized = true;
          return {
            config: {
              environment: "Development",
              projectKey: SYNTHETIC_DEVELOPMENT_ZAID,
            },
          };
        },
      },
    }));

    await handler(request, response);

    assert.equal(initialized, false);
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).code, "configuration_invalid");
  }
});

test("copied Development configuration rejects Production host and ZAID metadata", async () => {
  const environment = baseEnvironment();
  for (const headers of [
    {
      host: "synthetic.catalystserverless.com",
      "x-zc-project-key": SYNTHETIC_DEVELOPMENT_ZAID,
    },
    {
      host: environment.DEVELOPMENT_FUNCTION_HOST,
      "x-zc-project-key": "synthetic-production-zaid",
    },
    {
      host: "synthetic.catalystserverless.com",
      "x-zc-project-key": "synthetic-production-zaid",
    },
  ]) {
    let initialized = false;
    const { response, result } = responseCapture();
    const handler = createRequestListener(listenerOptions(environment, {
      catalystSdk: {
        initialize: () => {
          initialized = true;
          return {
            config: {
              environment: "Development",
              projectKey: SYNTHETIC_DEVELOPMENT_ZAID,
            },
          };
        },
      },
    }));

    await handler(requestFor(environment, { headers }), response);

    assert.equal(initialized, false);
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).code, "configuration_invalid");
  }
});

test("request authentication fails before SDK initialization", async () => {
  const environment = baseEnvironment();
  const request = requestFor(environment);
  delete request.headers[environment.SHARED_HEADER_NAME];
  let initialized = false;
  const { response, result } = responseCapture();
  const handler = createRequestListener(listenerOptions(environment, {
    catalystSdk: {
      initialize: () => {
        initialized = true;
        return {
          config: {
            environment: "Development",
            projectKey: SYNTHETIC_DEVELOPMENT_ZAID,
          },
        };
      },
    },
  }));

  await handler(request, response);

  assert.equal(initialized, false);
  assert.equal(result.statusCode, 401);
  assert.equal(JSON.parse(result.body).code, "authentication_failed");
});

test("Production configuration and missing proof fail before SDK initialization", async () => {
  for (const overrides of [
    { DEPLOYMENT_ENVIRONMENT: "production" },
    { DEVELOPMENT_RUNTIME_PROOF: "" },
    { DEVELOPMENT_RUNTIME_PROOF: "short" },
    { DEVELOPMENT_FUNCTION_HOST: "synthetic.catalystserverless.com" },
  ]) {
    const environment = baseEnvironment(overrides);
    let initialized = false;
    const { response, result } = responseCapture();
    const handler = createRequestListener(listenerOptions(environment, {
      catalystSdk: {
        initialize: () => {
          initialized = true;
          return {
            config: {
              environment: "Development",
              projectKey: SYNTHETIC_DEVELOPMENT_ZAID,
            },
          };
        },
      },
    }));

    await handler(requestFor(environment), response);

    assert.equal(initialized, false);
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).code, "configuration_invalid");
  }
});
