# Form 1 Prefill Mapping Fixture

This is a temporary, dependency-free Zoho Catalyst **Development-only** Advanced I/O function. Its sole purpose is to expose the exact fixed Form 1 prefill response keys to Zoho Forms' Dynamic Prefill mapping editor while the real one-time prefill handle remains non-replayable.

It is not a Journey runtime, public endpoint, CRM writer, or replacement for `revenue_leak_test_request_form`. It initializes no Catalyst SDK, reads and writes no Data Store row, opens no Connection, performs no CRM operation, sends no email or SMS, generates no OTP, makes no outbound request, and has no Retell capability.

## Safety contract

- Missing `FORM1_PREFILL_MAPPING_FIXTURE_MODE` means `disabled`; disabled requests return `503` before request-body access.
- Active mode accepts only Development requests from the configured Catalyst project digest.
- One private exact path, `POST application/json`, and one independently generated protected header are required.
- `FIXTURE_EXPIRES_AT` is absolute, must use canonical UTC, and cannot be more than four hours ahead of the invocation. An expired fixture returns `410` before body access.
- The body must be exactly `{"prefillHandle":"ZZZ_SYNTHETIC_MAPPING_ONLY"}`.
- Success returns one fixed flat 23-key `ZZZ SYNTHETIC` sample. It omits consent. Its synthetic `prefillId` and revision have no server-side session and therefore cannot authorize a real submission.
- Every response is JSON with `no-store`; the function emits no application logs.
- Production is unsupported and fails closed.

## Verify and build

Run the focused checks from the function directory:

```powershell
npm ci --ignore-scripts
npm run ci
```

After review and commit, build an immutable artifact into a new external directory:

```powershell
$approvedRevision = git rev-parse HEAD
$artifactParent = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("sylvara-form1-mapping-fixture-" + [guid]::NewGuid()))
$artifactRoot = Join-Path $artifactParent.FullName "form1-prefill-mapping-fixture"
node src/zoho-catalyst/form1-prefill-mapping-fixture/tools/build-release-artifact.js --approved-revision $approvedRevision --output $artifactRoot
```

The build command does not deploy. Deploy only `functions:form1_prefill_mapping_fixture` from the reviewed artifact. Never deploy the containing Catalyst project without `--only`.

## Temporary Development installation

Before any write, independently capture the current Development Form 1 prefill route's exact function target and the assisted Form's current Dynamic Prefill endpoint, body, protected-header names, mapping, and enabled state. Keep all private values outside Git and logs.

1. Deploy only the immutable `form1_prefill_mapping_fixture` function with mode still `disabled`.
2. Configure the exact Development project digest, immutable source revision, one private exact path, one newly generated header name and secret used only by this fixture, and an expiration no more than four hours in the future.
3. Read back every variable by name and classification without displaying private values, then set mode to `active` last.
4. Point only the bounded Development mapping probe to the fixture. Do not alter the submission route, CRM launcher, public Form 1, Form 2, Production, or any Retell surface.
5. In Zoho Forms, send exactly the synthetic probe body, inspect the 23 response keys, map them, and save. Never use a real handle or real record data against this fixture.
6. Independently read back the saved mapping before restoration.

## Mandatory restore and removal

Restoration is part of the same bounded operation, not optional cleanup:

1. Restore the Form 1 prefill route to its exact captured canonical function target and read it back.
2. Restore the assisted Form's exact canonical endpoint, `prefillHandle` merge reference, and original protected prefill header; remove the fixture-only header. Read back the saved configuration without invoking another real handle.
3. Set `FORM1_PREFILL_MAPPING_FIXTURE_MODE=disabled` and verify a sanitized `503 service_unavailable` response only if a bounded readback request is still required.
4. Disable or remove the fixture route, then delete the temporary function through the approved Development change surface. Confirm the canonical prefill route remains intact.
5. Rotate the fixture-only secret if it cannot be deleted immediately. Never rotate or expose the canonical Form 1 prefill secret as part of this fixture cleanup.
6. Retain only sanitized evidence: reviewed source revision, artifact digest, activation/expiry times, exact affected resource categories, canonical route restoration, disabled/removal readback, and zero integration side effects.

If any route or Forms readback is ambiguous, stop with the fixture disabled. Do not consume another real prefill handle, relax the production controller's one-use rule, or leave this fixture active.
