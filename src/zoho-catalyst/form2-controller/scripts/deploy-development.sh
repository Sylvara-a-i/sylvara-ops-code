#!/usr/bin/env bash
set -euo pipefail

readonly NODE_VERSION="24.18.0"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742"
readonly CATALYST_CLI_VERSION="1.26.1"

fail() {
  printf '%s\n' "Form 2 Development deployment stopped: $1" >&2
  exit 1
}

for required_command in bash catalyst curl git python3 sha256sum tar uname xz; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done

runner_architecture="$(uname -m)"
readonly runner_architecture
[[ "$runner_architecture" == "x86_64" ]] || fail "the pinned deployment runner must be x86_64"

for required_variable in PROJECT_ID CATALYST_ORG CATALYST_TOKEN APPROVED_SOURCE_REVISION; do
  [[ -n "${!required_variable:-}" ]] || fail "$required_variable is required"
done

[[ "$PROJECT_ID" =~ ^[1-9][0-9]{0,29}$ ]] || fail "PROJECT_ID is invalid"
[[ "$CATALYST_ORG" =~ ^[1-9][0-9]{0,29}$ ]] || fail "CATALYST_ORG is invalid"
[[ "$APPROVED_SOURCE_REVISION" =~ ^[a-f0-9]{40}$ ]] || fail "APPROVED_SOURCE_REVISION is invalid"
[[ ${#CATALYST_TOKEN} -ge 16 && ${#CATALYST_TOKEN} -le 4096 ]] || fail "CATALYST_TOKEN is invalid"
[[ "$CATALYST_TOKEN" != *[[:space:]]* ]] || fail "CATALYST_TOKEN is invalid"

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly script_directory
project_root="$(cd -- "$script_directory/.." && pwd -P)"
readonly project_root
repository_root="$(git -C "$project_root" rev-parse --show-toplevel)"
readonly repository_root
[[ "$project_root" == "$repository_root/src/zoho-catalyst/form2-controller" ]] || \
  fail "the Catalyst project path is unexpected"

actual_revision="$(git -C "$repository_root" rev-parse --verify HEAD)"
readonly actual_revision
[[ "$actual_revision" == "$APPROVED_SOURCE_REVISION" ]] || \
  fail "the checked-out revision is not the approved immutable revision"
repository_status="$(git -C "$repository_root" status --porcelain=v1 --untracked-files=all)"
readonly repository_status
[[ -z "$repository_status" ]] || \
  fail "the repository checkout is not clean"

tool_root="$(mktemp -d "${TMPDIR:-/tmp}/sylvara-form2-deploy.XXXXXXXX")"
readonly tool_root
[[ -n "$tool_root" && -d "$tool_root" ]] || fail "the isolated tool directory is unavailable"
cleanup() {
  rm -rf -- "$tool_root"
}
trap cleanup EXIT

readonly node_archive_path="$tool_root/$NODE_ARCHIVE"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$node_archive_path" \
  "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
printf '%s  %s\n' "$NODE_SHA256" "$node_archive_path" | sha256sum --check --status || \
  fail "the pinned Node.js archive checksum did not match"
tar --extract --xz --file "$node_archive_path" --directory "$tool_root"

readonly node_root="$tool_root/node-v${NODE_VERSION}-linux-x64"
export PATH="$node_root/bin:$PATH"
node_version="$(node --version)"
readonly node_version
[[ "$node_version" == "v${NODE_VERSION}" ]] || fail "the pinned Node.js runtime is unavailable"

catalyst_version="$(catalyst -v)"
readonly catalyst_version
[[ "$catalyst_version" =~ (^|[^0-9])1\.26\.1([^0-9]|$) ]] || \
  fail "the pinned Catalyst CLI ${CATALYST_CLI_VERSION} is unavailable"

python3 "$repository_root/tools/safety/pre-commit-safety-check.py"
npm ci --ignore-scripts --no-audit --no-fund \
  --prefix "$project_root/functions/form2_controller"
npm run ci --prefix "$project_root/functions/form2_controller"

cd -- "$project_root"
catalyst deploy \
  --only functions:form2_controller \
  --ignore-scripts \
  --project "$PROJECT_ID" \
  --org "$CATALYST_ORG" \
  --token "$CATALYST_TOKEN" \
  --dc us
