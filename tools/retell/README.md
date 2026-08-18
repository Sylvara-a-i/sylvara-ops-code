# Retell Draft Alignment Tool

## Purpose

`align-agent.ps1` aligns one existing Retell conversation-flow agent with a reviewed private template, creates local before-state backups, and reads the result back. The tool is intentionally narrow:

- dry run by default;
- updates only the latest Retell draft;
- never publishes an agent;
- never assigns or purchases a phone number;
- never changes a carrier or customer phone route; and
- sets an agent-level webhook only when `-SetWebhook` is explicitly supplied.

The private template is not part of this public repository. It may contain complete prompts, customer configuration, or other private operating detail and must remain in an approved private location.

## Required Environment Variables

Set these in the current PowerShell process. Never paste them into the script, a committed file, a command transcript intended for publication, an issue, or a pull request.

```powershell
$env:RETELL_API_KEY = "PUT_THE_RETELL_API_KEY_HERE"
$env:RETELL_AGENT_ID = "PUT_THE_EXACT_RETELL_AGENT_ID_HERE"
$env:RETELL_TEMPLATE_PATH = "C:\private\path\agent-template.private.json"
```

`RETELL_API_KEY` is the Retell API credential. `RETELL_AGENT_ID` is the exact existing draft agent to update. `RETELL_TEMPLATE_PATH` is the full path to the reviewed private JSON export or template.

Set the following only after the matching Catalyst Development receiver has passed valid-signature, replay, idempotency, asynchronous-processing, row-mapping, and log-safety acceptance:

```powershell
$env:CATALYST_RETELL_WEBHOOK_URL = "PUT_THE_PRIVATE_CATALYST_WEBHOOK_URL_HERE"
```

Do not place the webhook URL in this repository.

## Commands

Preview the exact target and field counts without modifying Retell:

```powershell
.\tools\retell\align-agent.ps1
```

Apply the reviewed draft alignment without setting a webhook:

```powershell
.\tools\retell\align-agent.ps1 -Apply
```

Apply the draft alignment and set the agent-level webhook only after the signed Catalyst acceptance gate passes:

```powershell
.\tools\retell\align-agent.ps1 -SetWebhook -Apply
```

An explicit path may replace `RETELL_TEMPLATE_PATH`:

```powershell
.\tools\retell\align-agent.ps1 -TemplatePath "C:\private\path\agent-template.private.json"
```

## Template Contract

The private JSON must contain:

- top-level agent settings used by the script;
- `conversationFlow` with `model_choice`, `model_temperature`, `knowledge_base_ids`, `start_speaker`, `global_prompt`, `flex_mode`, `start_node_id`, `default_dynamic_variables`, and `nodes`; and
- `post_call_analysis_data` with unique field names.

Every value under `conversationFlow.default_dynamic_variables` must be a string. The script stops before writing when a variable value is not a string, the selected agent is not a conversation-flow agent, the flow identifier is missing, or required environment variables are absent.

## Backup And Readback

Before an applied change, the tool saves the current agent and conversation-flow responses under `tools/retell/.retell-backups/`. That directory is ignored by the repository and must not be published because it can contain private prompts, identifiers, webhook settings, or other live configuration.

After both PATCH requests, the tool reads the agent and flow back and verifies:

- the expected agent name;
- every target dynamic-variable name;
- every target post-call analysis field name; and
- the webhook target when `-SetWebhook` was used.

A successful readback proves only that the draft fields matched. It does not prove publication, phone routing, signed webhook delivery, call behavior, downstream processing, legal approval, or Production readiness.

## Rollback

Use the timestamped local before-state files to prepare a separately reviewed rollback patch. Do not blindly replay the complete raw response: provider-managed, read-only, or version fields may not be valid update inputs. Verify the exact agent, draft version, current state, proposed rollback state, and readback plan before any rollback.
