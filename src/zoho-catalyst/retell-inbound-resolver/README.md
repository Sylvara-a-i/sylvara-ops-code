# Retell Inbound Resolver Contract Slice

This package is the sanitized, source-controlled contract used to normalize an approved CRM route label into Sylvara's canonical `coverage_mode` and to validate its compatibility with a per-call `CoverageTrigger`.

The single machine-readable authority is [`contracts/coverage-mode-contract.json`](contracts/coverage-mode-contract.json). [`lib/coverage-mode.js`](lib/coverage-mode.js) derives its enums and maps from that file; it does not maintain a second literal table.

The module fails closed on missing, blank, whitespace-padded, wrong-case, malformed, or unsupported inputs. `CoverageTrigger` remains separate from `coverage_mode` and is never accepted as a coverage mode.

This is a bounded resolver/deployment-configuration source slice, not a deployed Catalyst function. It contains no endpoint, identifier, customer data, phone number, secret, or live configuration. Repository approval and local tests do not authorize a Catalyst deployment, Retell route, phone binding, or customer workflow.

Run the focused tests without network access:

```powershell
npm run ci --prefix src\zoho-catalyst\retell-inbound-resolver
```
