# Sylvara GitHub Setup Checklist

This checklist is tailored to the repository that already exists:

```text
Personal account: Sylvara-ai
Organization: Sylvara-a-i
Repository: Sylvara-a-i/sylvara-ops-code
Visibility: Public
Default branch: main
Current content: README.md only
```

Do not create another organization or repository. Do not click **Move work to an organization**; the repository is already owned by the organization.

## 1. Import This Baseline Without Rewriting History

Clone the existing repository, create a branch, and copy this package into the clone. Do not run `git init`, do not force-push, and do not upload a second README through the browser.

```powershell
cd "$HOME\Downloads"

git clone https://github.com/Sylvara-a-i/sylvara-ops-code.git
cd .\sylvara-ops-code
git switch -c setup/repository-baseline

Get-ChildItem "$HOME\Downloads\sylvara-ops-code-bootstrap" -Force |
  Copy-Item -Destination . -Recurse -Force

py .\scripts\check_repo_safety.py
git status
git add .
git commit -m "Initialize Sylvara repository controls and operating baseline"
git push -u origin setup/repository-baseline
```

Open a pull request from `setup/repository-baseline` into `main`. Wait for the `repository-safety` check, review the diff, and squash merge it. Delete the source branch.

## 2. Repository General Settings

Open:

```text
Sylvara-a-i/sylvara-ops-code → Settings → General
```

Set:

- Description: `Public, sanitized code and operating documentation for Sylvara's managed after-hours call recovery service.`
- Website: `https://www.sylvara.ai`
- Topics: `ai-voice`, `call-automation`, `plumbing`, `retell-ai`, `make-com`
- Issues: Off
- Projects: Off
- Wiki: Off
- Discussions: Off
- Pull requests: Collaborators only
- Allow merge commits: Off
- Allow squash merging: On
- Allow rebase merging: Off
- Allow auto-merge: Off initially
- Automatically delete head branches: On
- GitHub Pages: Disabled

Do not add an open-source license. Public visibility permits reading and forking; it does not require granting an open-source license.

## 3. Organization Controls

Open:

```text
Sylvara-a-i → Settings
```

### Authentication security

- Require two-factor authentication: On
- Only allow secure two-factor methods: On

### Member privileges

- Base permissions: None
- Member repository creation: Off
- GitHub App repository creation: Off
- Repository deletion and transfer: Owners only
- Repository visibility changes: Owners only
- Allow repository admins to install GitHub Apps: Off

### Programmatic access

- OAuth app access restrictions: On
- Personal access tokens classic: Restricted
- Fine-grained personal access tokens: Require owner approval
- Maximum fine-grained token lifetime: 90 days

## 4. GitHub Actions Controls

Open:

```text
Sylvara-a-i → Settings → Actions → General
```

Set:

- GitHub Actions: Allow for all repositories
- Allowed actions: Allow Sylvara-a-i actions and specified non-Sylvara-a-i actions
- Require actions to be pinned to a full-length commit SHA: On
- Allow GitHub-owned actions broadly: Off
- Allow Marketplace actions by verified creators broadly: Off
- Specifically allow the exact pinned action references used in `.github/workflows/ci.yml`
- Fork pull-request workflows: Require approval for all external contributors
- Workflow permissions: Read repository contents and packages
- Allow GitHub Actions to create and approve pull requests: Off

## 5. Protect `main`

After the first CI run succeeds, open:

```text
Repository → Settings → Rules → Rulesets → New branch ruleset
```

Create:

```text
Name: Protect Main
Status: Active
Target: Default branch
```

Bypass:

- Repository administrators: Pull requests only
- No connector, app, team, or writer bypass

Rules:

- Restrict deletions: On
- Block force pushes: On
- Require a pull request before merging: On
- Required approvals: 1
- Dismiss stale approvals on new commits: On
- Require review from Code Owners: On
- Require approval of the most recent reviewable push: On
- Require conversation resolution: On
- Require status checks: On
- Required check: `repository-safety`
- Require branches to be up to date: On
- Require linear history: On
- Require signed commits: Off initially

`@Sylvara-ai` is the current Code Owner. Connector-authored pull requests require approval from that account. For a pull request authored directly by `@Sylvara-ai`, use the repository-administrator pull-request-only bypass after reviewing the diff and passing checks.

## 6. Security And Analysis

Open:

```text
Repository → Settings → Advanced Security
```

Enable or verify:

- Dependency graph
- Dependabot alerts
- Dependabot security updates
- Grouped security updates, when shown
- Secret scanning
- Push protection
- CodeQL default setup once supported source code exists
- Private vulnerability reporting

CodeQL may have nothing useful to scan while the repository contains only Markdown, JSON, YAML, and a small Python safety script. Enable it when GitHub offers a supported-language configuration; do not block setup on that.

## 7. Public Interaction Controls

Open:

```text
Repository → Settings → Moderation options
```

Set:

- Code review limits: Limit to users explicitly granted read access or higher
- Interaction limits: Limit to repository collaborators for the maximum available duration

Renew temporary interaction limits before they expire.

## 8. Connector Access

The currently connected OpenAI GitHub identity is `GHRealEstate`, while the Sylvara organization is owned by `Sylvara-ai`. To preserve access to both businesses without granting organization administration:

1. Add `GHRealEstate` to `sylvara-ops-code` with **Write** access only.
2. Keep `Sylvara-ai` as the sole organization owner and Code Owner.
3. Install or approve the OpenAI/Codex GitHub App on `Sylvara-a-i` with **Only select repositories** and select only `sylvara-ops-code`.
4. Never grant the connector repository Admin or organization Owner.

The normal ChatGPT GitHub app is read-only. Codex or another approved write-capable GitHub App is required for branch and pull-request writes.

For every write-capable app:

- Install on `Sylvara-a-i`
- Choose **Only select repositories**
- Select only `sylvara-ops-code`
- Grant only the permissions required to create branches, commits, and pull requests
- Do not grant repository administration, organization administration, secrets, environments, deployments, or branch-protection bypass
- Do not allow direct writes to `main`

Required operating path:

```text
Read main → create branch → make focused change → open PR → pass checks → Gabriel reviews → squash merge → delete branch
```

## 9. Smoke Test

After all settings are active:

```powershell
git switch main
git pull
git switch -c chore/protection-smoke-test
Add-Content .\README.md "`n<!-- branch-protection smoke test -->"
py .\scripts\check_repo_safety.py
git add README.md
git commit -m "Test protected pull request workflow"
git push -u origin chore/protection-smoke-test
```

Open the PR and confirm:

- Direct push to `main` is not part of the workflow
- `repository-safety` runs
- Code Owner review is requested
- A connector cannot bypass or self-approve
- Squash merge is the only normal merge method
- The branch is deleted after merge

Remove the temporary smoke-test comment in a second PR or close the PR without merging after confirming the controls.
