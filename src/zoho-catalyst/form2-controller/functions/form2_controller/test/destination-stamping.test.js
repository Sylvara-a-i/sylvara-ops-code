"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  EXPECTED,
  SENTINEL,
  stampFormDestination,
} = require("../../../tools/stamp-form-destination");

const functionRoot = path.resolve(__dirname, "..");
const checkoutDestination = path.join(functionRoot, "lib", "form-destination.js");

function createArtifact(testContext, source = EXPECTED) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sylvara-form2-stamp-"));
  testContext.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const destination = path.join(root, "functions", "form2_controller", "lib", "form-destination.js");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source, "utf8");
  return { destination, root };
}

test("stamps only the exact temporary artifact and leaves the checkout sentinel intact", (context) => {
  const digest = "a".repeat(64);
  const before = fs.readFileSync(checkoutDestination, "utf8");
  const artifact = createArtifact(context);
  stampFormDestination({ artifactRoot: artifact.root, digest });
  const stamped = fs.readFileSync(artifact.destination, "utf8");
  assert.equal(stamped.includes(SENTINEL), false);
  assert.equal(stamped.includes(digest), true);
  assert.equal(fs.readFileSync(checkoutDestination, "utf8"), before);
});

test("stamping is deterministic across independent artifacts", (context) => {
  const digest = "b".repeat(64);
  const first = createArtifact(context);
  const second = createArtifact(context);
  stampFormDestination({ artifactRoot: first.root, digest });
  stampFormDestination({ artifactRoot: second.root, digest });
  assert.equal(
    fs.readFileSync(first.destination, "utf8"),
    fs.readFileSync(second.destination, "utf8"),
  );
});

test("rejects invalid digests and any non-exact artifact template", (context) => {
  const invalidDigest = createArtifact(context);
  assert.throws(
    () => stampFormDestination({ artifactRoot: invalidDigest.root, digest: "A".repeat(64) }),
    /digest is invalid/,
  );
  const altered = createArtifact(context, EXPECTED.replace("isolated temporary", "temporary"));
  assert.throws(
    () => stampFormDestination({ artifactRoot: altered.root, digest: "c".repeat(64) }),
    /exact unstamped template/,
  );
});

test("rejects a repository checkout or a relative artifact root", () => {
  assert.throws(
    () => stampFormDestination({ artifactRoot: functionRoot, digest: "d".repeat(64) }),
    /must not be a repository checkout/,
  );
  assert.throws(
    () => stampFormDestination({ artifactRoot: "relative", digest: "d".repeat(64) }),
    /absolute temporary directory/,
  );
});
