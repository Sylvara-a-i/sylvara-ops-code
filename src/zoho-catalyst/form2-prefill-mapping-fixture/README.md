# Form 2 Prefill Mapping Fixture

Temporary, dependency-free Catalyst **Development-only** Advanced I/O function for installing Zoho Forms Prefill-Webhook mappings. Source/offline evidence does not establish deployment or live mapping acceptance. This is an installation aid, not another Journey stage or a live Form 2 controller.

The [official Prefill-Webhook wizard](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-webhook) requires a successful test response before mappings can be saved. The fixture exposes the canonical Form 2 response shape without issuing or consuming a real session, prefill handle, proof, or approval. It owns no business state; CRM remains authoritative.

## Safety and data flow

Authorized administrator-only Forms mapping test → protected temporary Development function → fixed synthetic JSON response. No SDK, Connection, datastore, CRM, mail, OTP, outbound network, or Retell capability exists in this deployable function. It neither changes the held Form 2 runtime nor bypasses its gates.

- Missing `FORM2_PREFILL_MAPPING_FIXTURE_MODE` is `disabled`, returning `503` before body access.
- Active requests require the exact configured Development project digest, immutable source revision, exact private path, `POST application/json`, and exactly one dedicated protected header.
- An absolute canonical UTC expiry must be at most four hours ahead. Expired requests return `410`, including a request whose bounded body read crosses expiry.
- Only `{"prefillHandle":"ZZZ_SYNTHETIC_MAPPING_ONLY"}` is accepted; additional or duplicate JSON keys, real handles, query strings, unsupported bodies, and ambiguous authentication fail closed.
- The fixed 35-key sample equals the actual Form 2 `buildPrefillPayload` shape plus `prefillId` and `configurationRevision`. Choice arrays and booleans retain their types; both attestations are always `false`. Reserved sample bindings have no supporting runtime state and cannot authorize submission.
- Responses are JSON and `no-store`; there are no application logs. Retries return the same static response with no side effects, but the operator's approved test allocation remains binding.
- Production is unsupported. No notification, approval, activation, or telephone behavior is verified by this installation aid.

## Verify and build

Use the repository-pinned Node 24 runtime. From `functions/form2_prefill_mapping_fixture`, run `npm ci --ignore-scripts` and `npm run ci`; then run the repository verifier. Tests include actual canonical payload parity, reserved samples, default disablement, runtime identity, expiry, request rejection, and absence of integrations/logging.

After review and commit, build to a new external directory:

```powershell
$approvedRevision = git rev-parse HEAD
$artifactParent = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("sylvara-form2-mapping-fixture-" + [guid]::NewGuid()))
$artifactRoot = Join-Path $artifactParent.FullName "form2-prefill-mapping-fixture"
node src/zoho-catalyst/form2-prefill-mapping-fixture/tools/build-release-artifact.js --approved-revision $approvedRevision --output $artifactRoot
```

This uses the existing immutable artifact builder; it does not deploy. Deploy only `functions:form2_prefill_mapping_fixture` from the reviewed artifact with the exact approved Development target. Never issue a project-wide deployment.

## Scoped installation and owner input

Requirement owner: Journey-Core operator. A valid bounded fixture deployment/mapping-test/removal approval and an owner protected-header handoff are prerequisites. Repository merge is not provider authorization. Keep real variable values, resource identities, endpoints, and readback evidence private; only names and safe classifications belong in Git.

1. Capture exact Form 2 prestate: saved fields, existing mappings or their absence, canonical prefill route/target, submission contract, and the intentional runtime hold. Record the mapping-test budget and rollback before changes.
2. Deploy only the immutable fixture in `disabled` mode. Independently verify actual artifact identity and exact Development target. Do not change the held canonical runtime.
3. Install the nonsecret identity/path/revision settings from the approved private plan. Gabriel privately supplies the separate fixture-only header secret in Catalyst and Forms. Do not retrieve, copy, log, or enter real credentials through automation. Preserve any API Gateway authentication and throttling; a gateway key and the application header are separate prerequisites.
4. Set a fixed expiry within four hours and activate last, only when owner entry and safe readback pass. Use the temporary endpoint only for the administrator mapping wizard and the exact literal probe above; never use a real handle.
5. Execute only the approved mapping-test allocation. Map exactly 35 response keys to the existing Form 2 fields; do not pre-check authorization boxes, change the submission contract, add a native CRM writer, or submit the sample as a real form.
6. Independently verify the saved key-to-field mapping and JSON types. This is mapping-installation evidence, not Form 2 E2E, identity verification, delivery, CRM persistence, or approval acceptance.

Do not modify Form 1, CRM launchers, Connections/scopes, real records, the existing runtime source-revision hold, Production, or any Retell surface. Capture ambiguous results; do not spend another test allocation or consume a real handle to investigate.

## Mandatory restoration, containment, and removal

1. Replace the wizard fixture endpoint/body/header with the exact canonical Form 2 prefill endpoint, `prefillHandle` field merge reference, and the approved protected prefill header through private owner entry. Remove the fixture-only header. Keep the canonical runtime held until its independent reopening gates pass.
2. Independently read back the saved mappings, canonical endpoint/body/header names, absence of fixture references, and unchanged submission settings without exposing credentials or invoking a real handle. If the provider requires another test merely to switch endpoints, stop; do not silently use another fixture or real-session approval.
3. Disable the fixture, then remove only its approved temporary route and function with independent readback. Never delete canonical routes, old claims, receipt/history rows, or evidence. Expiry is a safety backstop, not a substitute for removal.
4. If restoration or removal is ambiguous, keep the fixture disabled and the canonical runtime held. Do not restore exposed secrets or re-enable unsafe configuration. Any further credential change requires its scoped owner handoff.
5. Retain a concise private change record: current state, owner, immutable revision/digest, affected resources, test count/result, expiry, restoration/removal readback, zero integration side effects, and remaining acceptance gates.

Ongoing cost: no recurring service or background job; only the approved temporary Catalyst invocations. Monitoring uses existing sanitized status/readback evidence. This component creates no logging or monitoring platform. Full Journey runtime acceptance, Retell/provider work, Billing, Analytics, commercial Blueprint, and Production remain outside its scope.
