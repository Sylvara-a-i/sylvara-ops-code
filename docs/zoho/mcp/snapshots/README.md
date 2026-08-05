# Zoho MCP Snapshots

## Purpose

`snapshots/` preserves dated, sanitized MCP observations without treating them as current access, authorization, configuration, or deployment evidence. The parent [MCP knowledge base](../README.md) defines the evidence layers; [evidence and publication rules](../../governance/evidence-and-publication.md) govern what may be stored publicly.

## Directory Convention

```text
snapshots/
  <evidence-class>/
    YYYY-MM-DD/
```

| Evidence class | Meaning |
|---|---|
| [`configured/`](configured/README.md) | Sanitized observations from an inspected configured session |

## Placement Rules

- Store each observation under the evidence class that produced it and the date it was observed.
- Add a new dated directory for a later inspection; do not overwrite an older snapshot to represent newer evidence.
- Keep raw exports, runtime server names, endpoints, authentication details, connection aliases, target identifiers, returned records, and private payloads outside GitHub.
- Treat every snapshot as bounded historical evidence whose exact scope and limitations are documented in its dated artifacts.
