# Creator Development source baseline

These are byte-for-byte source snapshots of six Zoho Creator pages saved in
Development on 2026-10-08: Dashboard, Settings, Support, Client_360, Billing, and
Operations_Dashboard. They provide a versioned baseline for future source review.

Each page has its saved HTML source and corresponding page script. The six
`.deluge` files contain the original comment-only script template; page logic
may also be embedded in the HTML. Preserve all twelve files exactly, including
their final-newline differences. `manifest.json` records their byte sizes and
SHA-256 hashes. Explanatory context stays here so the snapshots remain unchanged.

## Scope and ownership

Zoho Creator owns this UI source. The adjacent Billing and company-settings
contract modules remain separate. This directory is not a standalone web app
and adds no runtime wiring, connection binding, schema migration, or deployment.

Operations_Dashboard contains app-local schema queries and HTML construction,
not exported record values. Running it inside Creator would read application
records. Roles, page access, record visibility, and permissions are not exported
or verified by these files; these must be reviewed separately before any live use.

Billing retains the existing public portal destination
`https://billing.sylvara.ai/portal/sylvaraai` unchanged. Versioning that link does
not configure a Billing connection or authorize a financial action.

## Validation and use

The baseline contains only the twelve approved source files, this README, and
the hash manifest. Private evidence, screenshots, metrics, receipts, preimages,
record data, credentials, and environment bindings are excluded.

From this directory, validate the exact source bytes without executing them:

```python
import hashlib
import json
from pathlib import Path

manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
for entry in manifest["files"]:
    data = Path(entry["path"]).read_bytes()
    assert len(data) == entry["bytes"], entry["path"]
    assert hashlib.sha256(data).hexdigest() == entry["sha256"], entry["path"]
print("All twelve source snapshots match.")
```

Run the repository's canonical `.\tools\verify.cmd` from the repository root.
Before publication, also verify staged Git blobs against the manifest, because
Git text normalization must not change the approved bytes.

This baseline does not claim a new Creator save, render test, permission test,
Stage promotion, or Production deployment. Future use requires exact target and
schema verification, access-control review, native syntax and synthetic testing,
and separately authorized setup, deployment, readback, and rollback. No native
Creator action or imported-source execution is part of source versioning.

Reverting this directory's commit removes the repository baseline; it does not
alter or roll back any Creator environment.
