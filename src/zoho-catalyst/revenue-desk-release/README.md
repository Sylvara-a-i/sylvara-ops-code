# Revenue Desk Release Boundary

This package creates and verifies one immutable release manifest for the six canonical Catalyst functions. It binds every function artifact, its tracked source tree, the thirteen canonical tables, both Function Job pools, and the governing contracts to one Git commit and one environment mode. The builder does not trust the caller's `function=path` label: it inspects the artifact's Catalyst target, package and lock identity, and immutable source-revision stamp, then produces a provenance digest that also binds the artifact hash to the exact Git-derived source-tree digest.

The manifest is evidence, not a deployer. It contains no project, organization, route, Connection, credential, or production record identifier. Build the six function artifacts with their owning package builders, then run:

```text
node scripts/build-release-manifest.js --source-revision <exact-head-sha> --environment Development --artifact revenue_leak_test_request_form=<path> --artifact revenue_leak_test_setup_form=<path> --artifact revenue_desk_call_gateway=<path> --artifact revenue_desk_call_worker=<path> --artifact crm_billing_orchestrator=<path> --artifact analytics_sync=<path> --output <outside-repository-path>
```

Each artifact path must be its Catalyst project root and contain `catalyst.json` plus `functions/<canonical-name>/package.json` and its lockfile. The checkout must be clean and the output must be outside Git. After deployment, create an allowlisted sanitized readback containing only the fields accepted by `verify-release-readback.js`. Exact function, source, artifact, table, Job-pool, contract, and environment parity is mandatory. Production additionally fails unless traffic, routes, and schedules are all dark.

Never use a passing manifest check as proof of provider behavior, credentials, live call routing, Forms/CRM/Billing behavior, or Retell voice quality. Those require their separate synthetic readback gates.
