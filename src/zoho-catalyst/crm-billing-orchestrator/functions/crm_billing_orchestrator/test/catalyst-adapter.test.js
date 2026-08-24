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
    schemaVersion: "crm-billing-lifecycle-v2",
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

function configFor(environment = baseEnvironment()) {
  return loadConfig(environment, {
    artifactRevision: REVISION,
    artifactDevelopmentZaidHmacSha256: DEVELOPMENT_ZAID_HMAC_SHA256,
  });
}

function addRealSdkHeaders(request, overrides = {}) {
  Object.assign(request.headers, {
    "x-zc-projectid": "100000000000001",
    "x-zc-project-domain": "https://api.catalyst.zoho.com",
    "x-zc-admin-cred-type": "token",
    "x-zc-admin-cred-token": "synthetic-admin-token",
    "x-zc-user-cred-type": "token",
    "x-zc-user-cred-token": "synthetic-user-token",
    ...overrides,
  });
  return request;
}

test("request binding requires an exact raw project key matching the Development ZAID HMAC", () => {
  const environment = baseEnvironment();
  const config = configFor(environment);
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
      "x-zc-project-key": ` ${SYNTHETIC_DEVELOPMENT_ZAID} `,
    },
    {
      host: environment.DEVELOPMENT_FUNCTION_HOST,
      "x-zc-project-key": [SYNTHETIC_DEVELOPMENT_ZAID],
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

test("Development host authority accepts only the configured bare host or explicit HTTPS port", () => {
  const environment = baseEnvironment();
  const config = configFor(environment);
  const uppercaseHost = environment.DEVELOPMENT_FUNCTION_HOST.toUpperCase();
  for (const host of [
    environment.DEVELOPMENT_FUNCTION_HOST,
    uppercaseHost,
    `${environment.DEVELOPMENT_FUNCTION_HOST}:443`,
    `${uppercaseHost}:443`,
  ]) {
    const request = requestFor(environment);
    request.headers.host = host;
    assert.equal(
      assertCatalystRequestBinding(request, config),
      SYNTHETIC_DEVELOPMENT_ZAID,
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

test("SDK binding requires the artifact-bound ZAID without normalizing project keys", () => {
  const config = configFor();
  assert.doesNotThrow(() => assertCatalystSdkBinding(
    { config: { environment: "Development", projectKey: SYNTHETIC_DEVELOPMENT_ZAID } },
    SYNTHETIC_DEVELOPMENT_ZAID,
    config,
  ));
  for (const app of [
    null,
    { config: {} },
    { config: { environment: "Development", projectKey: "forged-development-zaid" } },
    { config: { environment: "Development", projectKey: [SYNTHETIC_DEVELOPMENT_ZAID] } },
    { config: { environment: "Development", projectKey: ` ${SYNTHETIC_DEVELOPMENT_ZAID} ` } },
    { config: { environment: "Production", projectKey: SYNTHETIC_DEVELOPMENT_ZAID } },
  ]) {
    assert.throws(
      () => assertCatalystSdkBinding(app, SYNTHETIC_DEVELOPMENT_ZAID, config),
      /SDK routing binding/,
    );
  }
  assert.throws(
    () => assertCatalystSdkBinding(
      { config: { environment: "Development", projectKey: SYNTHETIC_DEVELOPMENT_ZAID } },
      "different-pre-sdk-project-key",
      config,
    ),
    /SDK routing binding/,
  );
});

test("SDK binding normalizes only Development environment casing and whitespace", () => {
  const config = configFor();
  for (const environment of ["Development", "development", "DEVELOPMENT", " Development "]) {
    assert.doesNotThrow(() => assertCatalystSdkBinding(
      { config: { environment, projectKey: SYNTHETIC_DEVELOPMENT_ZAID } },
      SYNTHETIC_DEVELOPMENT_ZAID,
      config,
    ));
  }
});

test("listener accepts a real SDK initialization without x-zc-environment", async () => {
  const environment = baseEnvironment();
  const request = addRealSdkHeaders(requestFor(environment));
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

test("listener accepts lowercase and whitespace-padded real SDK Development routing", async () => {
  const environment = baseEnvironment();
  for (const sdkEnvironment of ["development", " Development "]) {
    const request = addRealSdkHeaders(requestFor(environment), {
      "x-zc-environment": sdkEnvironment,
    });
    const { response, result } = responseCapture();
    const handler = createRequestListener(listenerOptions(environment));

    await handler(request, response);

    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).ok, true);
  }
});

test("listener rejects Production or normalized project-key metadata before any factory", async () => {
  const environment = baseEnvironment();
  for (const headers of [
    { "x-zc-environment": "Production" },
    { "x-zc-project-key": ` ${SYNTHETIC_DEVELOPMENT_ZAID} ` },
  ]) {
    const request = addRealSdkHeaders(requestFor(environment), headers);
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

test("invalid Development host authorities fail before SDK initialization", async () => {
  const environment = baseEnvironment();
  for (const host of [
    `${environment.DEVELOPMENT_FUNCTION_HOST}:80`,
    `${environment.DEVELOPMENT_FUNCTION_HOST}:444`,
    `${environment.DEVELOPMENT_FUNCTION_HOST}:0443`,
    `user@${environment.DEVELOPMENT_FUNCTION_HOST}`,
    `https://${environment.DEVELOPMENT_FUNCTION_HOST}`,
    `${environment.DEVELOPMENT_FUNCTION_HOST}/path`,
    `${environment.DEVELOPMENT_FUNCTION_HOST}:443/path`,
    ` ${environment.DEVELOPMENT_FUNCTION_HOST}`,
    `${environment.DEVELOPMENT_FUNCTION_HOST} `,
  ]) {
    const request = requestFor(environment);
    request.headers.host = host;
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

test("forged project keys fail before SDK initialization", async () => {
  const environment = baseEnvironment();
  const request = requestFor(environment);
  request.headers["x-zc-project-key"] = "forged-development-zaid";
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
});

test("missing project keys fail before SDK initialization", async () => {
  const environment = baseEnvironment();
  const request = requestFor(environment);
  delete request.headers["x-zc-project-key"];
  let initialized = false;
  const { response, result } = responseCapture();
  const handler = createRequestListener(listenerOptions(environment, {
    catalystSdk: {
      initialize: () => {
        initialized = true;
        throw new Error("SDK must not initialize without the mandatory project key");
      },
    },
  }));

  await handler(request, response);

  assert.equal(initialized, false);
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body).code, "configuration_invalid");
});

test("SDK project-key HMAC mismatch fails before any factory", async () => {
  const environment = baseEnvironment();
  const request = requestFor(environment);
  let initialized = false;
  let factoryCalled = false;
  const options = listenerOptions(environment, {
    catalystSdk: {
      initialize: () => {
        initialized = true;
        return {
          config: {
            environment: "Development",
            projectKey: "forged-development-zaid",
          },
        };
      },
    },
  });
  for (const name of Object.keys(options.factories)) {
    options.factories[name] = () => {
      factoryCalled = true;
      throw new Error("factory must not run");
    };
  }
  const { response, result } = responseCapture();
  const handler = createRequestListener(options);

  await handler(request, response);

  assert.equal(initialized, true);
  assert.equal(factoryCalled, false);
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body).code, "configuration_invalid");
});

test("GET with a valid mandatory project key returns 405 without SDK initialization", async () => {
  const environment = baseEnvironment();
  const request = requestFor(environment, { method: "GET" });
  let initialized = false;
  const { response, result } = responseCapture();
  const handler = createRequestListener(listenerOptions(environment, {
    catalystSdk: {
      initialize: () => {
        initialized = true;
        throw new Error("SDK must not initialize for a rejected method");
      },
    },
  }));

  await handler(request, response);

  assert.equal(initialized, false);
  assert.equal(result.statusCode, 405);
  assert.equal(JSON.parse(result.body).code, "method_not_allowed");
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
