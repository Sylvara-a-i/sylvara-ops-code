# Retell Source-Control Workspace

This directory is the public, sanitized historical record for Sylvara's managed Retell agents. Retell remains runtime authority. These files are not deployable configuration and do not prove that an agent, assignment, phone route, or customer workflow is live.

Managed agents:

- `7-Day Free Test`
- `Revenue Desk — Master Template`

Their manifests, public summaries, lifecycle observations, and offline tests stay in separate subtrees. Similar public structure must never be interpreted as shared runtime behavior.

## Change Control

For every future Retell update:

1. Read the complete current agent and every referenced resource using an approved read-only Retell connection.
2. Save the complete draft and published-state evidence in the repository's ignored local audit area.
3. Reconstruct a public derivative using the exact schemas and file inventory in this workspace. Never copy and mask a raw payload.
4. Run the focused Retell workspace test and the repository verifier before any Retell simulation.
5. Report the exact private before-and-after proposal and obtain explicit approval before invoking a Retell write.
6. Modify a draft only. Publishing, deploying, binding a phone number, placing a call, changing routing, running a Retell simulation, or deleting a resource requires separate explicit approval.

Complete raw responses, connector labels, runtime-derived variable names, prompts, routing conditions and destinations, security-control structure, runtime defaults, production identifiers, private endpoints, precise platform timestamps, calls, transcripts, and secrets never enter Git.

The approved provider-neutral coverage-mode enum, exact CRM-label mapping, and per-call trigger compatibility rules live in the Catalyst-owned [`coverage-mode-contract.json`](../zoho-catalyst/retell-inbound-resolver/contracts/coverage-mode-contract.json). This public contract does not expose a live deployment mapping, runtime value, or private resolver configuration.

## Current Observation

The 2026-08-20 read-only audit resolved one current draft for each managed agent. A published configuration did not resolve through the audited read path, so a draft-versus-published comparison was unavailable. Each agent referenced a distinct private conversation-flow resource.

This is historical observation only. Assignment references are not treated as publication, deployment, phone binding, or production-routing proof. Runtime-derived names, counts, topology, voice details, connector labels, and control settings remain in the ignored private audit store only.

## Provider-Neutral Acceptance Contract

The `7-Day Free Test` subtree includes a public acceptance contract for urgency, callback, and bounded nonurgent classification. It records synthetic state semantics and deterministic precedence only. It is not runtime mapping, a Retell prompt or flow export, Manual Chat evidence, deployable configuration, or proof that the runtime passed those checks.

## Local Validation

```powershell
python -m unittest discover -s tools\safety\tests -p "test_retell_workspace.py" -v
.\tools\verify.cmd
```

No Retell API call is required by either command.
