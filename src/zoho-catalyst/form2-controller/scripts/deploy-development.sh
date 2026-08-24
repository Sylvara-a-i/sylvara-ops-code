#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077

readonly NODE_VERSION="24.19.0"
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_SHA256="14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647"
# 1.26.0 is the installed reviewed CLI. Its help contract includes every
# deploy/global flag used below; keep the exact pin until a newer CLI is
# installed and independently exercised by this script's integration test.
readonly CATALYST_CLI_VERSION="1.26.0"

fail() {
  printf '%s\n' "Form 2 Development deployment stopped: $1" >&2
  exit 1
}

# Validate the deployment inputs with Bash builtins before command discovery or
# any other external process can inherit the pipeline's credential environment.
for required_variable in \
  PROJECT_ID CATALYST_ORG CATALYST_TOKEN APPROVED_SOURCE_REVISION \
  APPROVED_FORM2_DESTINATION_SHA256; do
  [[ -n "${!required_variable:-}" ]] || fail "$required_variable is required"
done

[[ "$PROJECT_ID" =~ ^[1-9][0-9]{0,29}$ ]] || fail "PROJECT_ID is invalid"
[[ "$CATALYST_ORG" =~ ^[1-9][0-9]{0,29}$ ]] || fail "CATALYST_ORG is invalid"
[[ "$APPROVED_SOURCE_REVISION" =~ ^[a-f0-9]{40}$ ]] || fail "APPROVED_SOURCE_REVISION is invalid"
[[ "$APPROVED_FORM2_DESTINATION_SHA256" =~ ^[a-f0-9]{64}$ ]] || \
  fail "APPROVED_FORM2_DESTINATION_SHA256 is invalid"
[[ ${#CATALYST_TOKEN} -ge 16 && ${#CATALYST_TOKEN} -le 4096 ]] || fail "CATALYST_TOKEN is invalid"
[[ "$CATALYST_TOKEN" != *[[:space:]]* ]] || fail "CATALYST_TOKEN is invalid"

# The pipeline supplies deployment values in Bash's initial environment. Keep
# them as readonly shell variables for validation and the final CLI environment, but do
# not expose them to Git, Python, Node.js, npm, tests, or other child processes.
export -n PROJECT_ID CATALYST_ORG CATALYST_TOKEN APPROVED_SOURCE_REVISION \
  APPROVED_FORM2_DESTINATION_SHA256
readonly PROJECT_ID CATALYST_ORG CATALYST_TOKEN APPROVED_SOURCE_REVISION \
  APPROVED_FORM2_DESTINATION_SHA256
unset BASH_ENV DEPLOY_APPROVER_EMAIL ENV NODE_AUTH_TOKEN NODE_OPTIONS NODE_PATH \
  NPM_TOKEN PYTHONHOME PYTHONPATH XDG_CONFIG_HOME
while IFS= read -r inherited_variable; do
  case "$inherited_variable" in
    GIT_*|npm_config_*|NPM_CONFIG_*) unset "$inherited_variable" ;;
  esac
done < <(compgen -v)

for required_command in bash catalyst cmp curl dirname env find git mkdir mktemp python3 rm sha256sum stat tar uname wc xz; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done
catalyst_path="$(type -P catalyst)"
readonly catalyst_path
[[ -n "$catalyst_path" && -x "$catalyst_path" ]] || fail "catalyst is not an executable file"
git_path="$(type -P git)"
readonly git_path
[[ -n "$git_path" && -x "$git_path" ]] || fail "git is not an executable file"
git_directory="$(dirname -- "$git_path")"
readonly git_directory

runner_architecture="$(uname -m)"
readonly runner_architecture
[[ "$runner_architecture" == "x86_64" ]] || fail "the pinned deployment runner must be x86_64"

run_isolated_git() {
  env -i \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_NO_REPLACE_OBJECTS=1 \
    HOME=/var/empty \
    LANG=C \
    LC_ALL=C \
    PATH="$git_directory:/usr/bin:/bin" \
    "$git_path" \
    -c core.fsmonitor=false \
    -c core.untrackedCache=false \
    "$@"
}

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly script_directory
checkout_project_root="$(cd -- "$script_directory/.." && pwd -P)"
readonly checkout_project_root
repository_root="$(run_isolated_git -C "$checkout_project_root" rev-parse --show-toplevel)"
readonly repository_root
controller_subpath="src/zoho-catalyst/form2-controller"
readonly controller_subpath
[[ "$checkout_project_root" == "$repository_root/$controller_subpath" ]] || \
  fail "the Catalyst project path is unexpected"

actual_revision="$(run_isolated_git -C "$repository_root" rev-parse --verify HEAD)"
readonly actual_revision
[[ "$actual_revision" == "$APPROVED_SOURCE_REVISION" ]] || \
  fail "the checked-out revision is not the approved immutable revision"
repository_status="$(run_isolated_git -C "$repository_root" status --porcelain=v1 --untracked-files=all)"
readonly repository_status
[[ -z "$repository_status" ]] || \
  fail "the repository checkout is not clean"

temp_parent="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
readonly temp_parent
tool_root="$(mktemp -d "$temp_parent/sylvara-form2-deploy.XXXXXXXX")"
readonly tool_root
[[ -n "$tool_root" && -d "$tool_root" ]] || fail "the isolated tool directory is unavailable"
tool_leaf="${tool_root#"$temp_parent/"}"
readonly tool_leaf
[[ "$tool_leaf" != "$tool_root" && "$tool_leaf" == sylvara-form2-deploy.* && "$tool_leaf" != */* ]] || \
  fail "the isolated tool path is unexpected"
[[ "$(stat -c '%a' "$tool_root")" == "700" ]] || \
  fail "the isolated tool directory is not private"
cleanup() {
  local original_status=$?
  trap - EXIT
  if ! rm -rf -- "$tool_root"; then
    printf '%s\n' \
      "Form 2 Development deployment cleanup failed; deployment may have completed" >&2
    if [[ $original_status -eq 0 ]]; then
      original_status=1
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

export_controller() {
  local destination="$1"
  mkdir -p -- "$destination"
  run_isolated_git -C "$repository_root" archive --format=tar "$actual_revision" -- \
    "$controller_subpath" catalyst-pipelines.yaml | \
    tar --extract --file=- --directory="$destination" \
      --no-same-owner --no-same-permissions
  [[ -d "$destination/$controller_subpath" ]] || \
    fail "the approved controller export is unavailable"
  [[ -f "$destination/catalyst-pipelines.yaml" ]] || \
    fail "the approved pipeline export is unavailable"
  verify_export "$destination"
}

verify_export() {
  local destination="$1"
  python3 -I -S - \
    "$destination" "$git_path" "$git_directory" "$repository_root" \
    "$actual_revision" "$controller_subpath" <<'PY'
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys

destination = Path(sys.argv[1]).resolve(strict=True)
git_path = sys.argv[2]
git_directory = sys.argv[3]
repository_root = sys.argv[4]
revision = sys.argv[5]
controller_subpath = sys.argv[6]
git_environment = {
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "HOME": "/var/empty",
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": f"{git_directory}:/usr/bin:/bin",
}
result = subprocess.run(
    [
        git_path,
        "-c", "core.fsmonitor=false",
        "-c", "core.untrackedCache=false",
        "-C", repository_root,
        "ls-tree", "-r", "-z", revision, "--",
        controller_subpath,
        "catalyst-pipelines.yaml",
    ],
    check=True,
    stdout=subprocess.PIPE,
    env=git_environment,
)

expected_paths = set()
for raw_entry in result.stdout.split(b"\0"):
    if not raw_entry:
        continue
    header, separator, raw_path = raw_entry.partition(b"\t")
    fields = header.split(b" ")
    if separator != b"\t" or len(fields) != 3:
        raise SystemExit("approved Git tree entry is malformed")
    mode, object_type, object_id = (field.decode("ascii") for field in fields)
    if mode not in {"100644", "100755"} or object_type != "blob":
        raise SystemExit("approved Git export contains an unsupported mode or object type")
    try:
        relative = raw_path.decode("utf-8")
    except UnicodeDecodeError as error:
        raise SystemExit("approved Git export contains a non-UTF-8 path") from error
    pure_relative = PurePosixPath(relative)
    if pure_relative.is_absolute() or ".." in pure_relative.parts:
        raise SystemExit("approved Git export contains an unsafe path")
    path = destination.joinpath(*pure_relative.parts)
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise SystemExit("approved Git export path is missing or not a regular file")
    permissions = stat.S_IMODE(metadata.st_mode)
    if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        raise SystemExit("approved Git export path has special permission bits")
    if permissions & 0o022:
        raise SystemExit(
            f"approved Git export regular file is group- or world-writable: {relative}"
        )
    expected_executable = mode == "100755"
    if bool(permissions & 0o111) != expected_executable:
        raise SystemExit(
            f"approved Git export executable permissions differ from its Git mode: {relative}"
        )
    content = path.read_bytes()
    digest = hashlib.sha1(
        b"blob " + str(len(content)).encode("ascii") + b"\0" + content
    ).hexdigest()
    if digest != object_id:
        raise SystemExit("approved Git export content differs from its Git blob")
    expected_paths.add(relative)

actual_paths = set()
for directory, names, files in os.walk(destination, topdown=True, followlinks=False):
    directory_path = Path(directory)
    for name in names:
        candidate = directory_path / name
        if candidate.is_symlink():
            raise SystemExit("approved Git export contains a symbolic link")
    for name in files:
        candidate = directory_path / name
        if candidate.is_symlink() or not candidate.is_file():
            raise SystemExit("approved Git export contains a non-regular path")
        actual_paths.add(candidate.relative_to(destination).as_posix())
if actual_paths != expected_paths:
    raise SystemExit("approved Git export paths differ from the reviewed Git tree")
PY
}

stamp_revision() {
  local revision_path="$1"
  python3 -I -S - "$revision_path" "$actual_revision" <<'PY'
from pathlib import Path
import re
import sys

EXPECTED_UNSTAMPED = '''"use strict";

// The Development deploy script replaces this sentinel only after proving that
// Git HEAD equals APPROVED_SOURCE_REVISION. An unstamped or manually packaged
// function therefore fails configuration before it can access CRM or Data Store.
const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";

module.exports = { ARTIFACT_SOURCE_REVISION };
'''

path = Path(sys.argv[1])
revision = sys.argv[2]
if re.fullmatch(r"[a-f0-9]{40}", revision) is None:
    raise SystemExit("approved source revision is invalid")
text = path.read_text(encoding="utf-8")
sentinel = 'const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";'
replacement = f'const ARTIFACT_SOURCE_REVISION = "{revision}";'
if text != EXPECTED_UNSTAMPED or text.count(sentinel) != 1:
    raise SystemExit("source revision module is not the exact reviewed sentinel template")
path.write_text(text.replace(sentinel, replacement), encoding="utf-8")
PY
}

read_stamped_revision() {
  local revision_path="$1"
  python3 -I -S - "$revision_path" <<'PY'
from pathlib import Path
import re
import sys

EXPECTED_UNSTAMPED = '''"use strict";

// The Development deploy script replaces this sentinel only after proving that
// Git HEAD equals APPROVED_SOURCE_REVISION. An unstamped or manually packaged
// function therefore fails configuration before it can access CRM or Data Store.
const ARTIFACT_SOURCE_REVISION = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__";

module.exports = { ARTIFACT_SOURCE_REVISION };
'''

sentinel = "__SYLVARA_UNSTAMPED_SOURCE_REVISION__"
pattern = re.escape(EXPECTED_UNSTAMPED).replace(
    re.escape(sentinel),
    r"([a-f0-9]{40})",
)
match = re.fullmatch(pattern, Path(sys.argv[1]).read_text(encoding="utf-8"))
if match is None:
    raise SystemExit("stamped source revision module is invalid")
sys.stdout.write(match.group(1))
PY
}

read_approved_form_destination() {
  local destination_path="$1"
  python3 -I -S - "$destination_path" <<'PY'
from pathlib import Path
import re
import sys

EXPECTED_SOURCE = '''"use strict";

// The reviewed Development deploy script replaces this sentinel only in its
// isolated temporary artifact. A checkout or manually packaged function stays
// unstamped and therefore fails closed before reaching CRM or Data Store.
const ARTIFACT_FORM_DESTINATION_SHA256 =
  "__SYLVARA_UNSTAMPED_FORM_DESTINATION_SHA256__";

module.exports = { ARTIFACT_FORM_DESTINATION_SHA256 };
'''

sentinel = "__SYLVARA_UNSTAMPED_FORM_DESTINATION_SHA256__"
pattern = re.escape(EXPECTED_SOURCE).replace(
    re.escape(sentinel),
    r"([a-f0-9]{64})",
)
match = re.fullmatch(pattern, Path(sys.argv[1]).read_text(encoding="utf-8"))
if match is None:
    raise SystemExit("reviewed source form destination is not approved")
sys.stdout.write(match.group(1))
PY
}

manifest_tree() {
  local tree_root="$1"
  local manifest_path="$2"
  local excluded_subtree="${3:-}"
  python3 -I -S - "$tree_root" "$manifest_path" "$excluded_subtree" <<'PY'
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys

root = Path(sys.argv[1]).resolve(strict=True)
manifest = Path(sys.argv[2])
excluded_subtree = sys.argv[3]
entries = []

if excluded_subtree:
    excluded_path = PurePosixPath(excluded_subtree)
    if excluded_path.is_absolute() or ".." in excluded_path.parts:
        raise SystemExit("artifact manifest exclusion is unsafe")
else:
    excluded_path = None

def validate_path(relative):
    if any(ord(character) < 32 or ord(character) == 127 for character in relative):
        raise SystemExit("artifact path contains a control character")

def add_path(path):
    relative = path.relative_to(root).as_posix()
    validate_path(relative)
    metadata = path.lstat()
    permissions = stat.S_IMODE(metadata.st_mode)
    mode = format(permissions, "04o")
    if metadata.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        raise SystemExit("artifact path has special permission bits")
    if stat.S_ISREG(metadata.st_mode):
        if permissions & 0o022:
            raise SystemExit("artifact regular file is group- or world-writable")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        entries.append((relative, f"F\t{mode}\t{metadata.st_size}\t{digest.hexdigest()}"))
        return
    if stat.S_ISLNK(metadata.st_mode):
        target = os.readlink(path)
        resolved = os.path.realpath(path)
        if os.path.commonpath([str(root), resolved]) != str(root):
            raise SystemExit("artifact symlink escapes its tree")
        entries.append((relative, f"L\t{mode}\t{json.dumps(target, ensure_ascii=True)}"))
        return
    raise SystemExit("artifact contains an unsupported file type")

for directory, names, files in os.walk(root, topdown=True, followlinks=False):
    directory_path = Path(directory)
    directory_metadata = directory_path.lstat()
    if not stat.S_ISDIR(directory_metadata.st_mode):
        raise SystemExit("artifact contains a non-directory traversal path")
    if directory_metadata.st_mode & (stat.S_ISUID | stat.S_ISGID | stat.S_ISVTX):
        raise SystemExit("artifact directory has special permission bits")
    for name in list(names):
        candidate = directory_path / name
        relative = candidate.relative_to(root).as_posix()
        if excluded_path is not None and PurePosixPath(relative) == excluded_path:
            if candidate.is_symlink() or not candidate.is_dir():
                raise SystemExit("artifact manifest exclusion is not a directory")
            names.remove(name)
            continue
        if candidate.is_symlink():
            names.remove(name)
            add_path(candidate)
    for name in files:
        add_path(directory_path / name)

with manifest.open("x", encoding="utf-8", newline="\n") as stream:
    for relative, details in sorted(entries):
        stream.write(f"{json.dumps(relative, ensure_ascii=True)}\t{details}\n")
PY
}

run_isolated_npm() {
  local user_config="$1"
  local cache_root="$2"
  local global_config="${user_config}.global"
  local isolated_home="$cache_root/home"
  local isolated_temp="$cache_root/tmp"
  shift 2
  mkdir -p -- "$isolated_home" "$isolated_temp"
  : > "$global_config"
  env -i \
    CI=1 \
    HOME="$isolated_home" \
    LANG=C \
    LC_ALL=C \
    PATH="$node_root/bin:/usr/bin:/bin" \
    TMPDIR="$isolated_temp" \
    npm_config_cache="$cache_root" \
    npm_config_globalconfig="$global_config" \
    npm_config_userconfig="$user_config" \
    "$node_root/bin/npm" "$@"
}

readonly node_archive_path="$tool_root/$NODE_ARCHIVE"
curl --disable --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --fail --silent --show-error --location \
  --output "$node_archive_path" \
  "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
printf '%s  %s\n' "$NODE_SHA256" "$node_archive_path" | sha256sum --check --status || \
  fail "the pinned Node.js archive checksum did not match"
tar --extract --xz --file "$node_archive_path" --directory "$tool_root"

readonly node_root="$tool_root/node-v${NODE_VERSION}-linux-x64"
export PATH="$node_root/bin:$PATH"
node_version="$(env -i PATH="$node_root/bin:/usr/bin:/bin" "$node_root/bin/node" --version)"
readonly node_version
[[ "$node_version" == "v${NODE_VERSION}" ]] || fail "the pinned Node.js runtime is unavailable"

catalyst_version_home="$tool_root/catalyst-version-home"
readonly catalyst_version_home
mkdir -p -- "$catalyst_version_home"
catalyst_version="$(env -i \
  CI=1 \
  HOME="$catalyst_version_home" \
  PATH="$node_root/bin:$(dirname -- "$catalyst_path"):/usr/bin:/bin" \
  "$catalyst_path" -v)"
readonly catalyst_version
if [[ "$catalyst_version" =~ ^(Catalyst[[:space:]]CLI[[:space:]])?([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  detected_catalyst_version="${BASH_REMATCH[2]}"
else
  detected_catalyst_version=""
fi
readonly detected_catalyst_version
[[ "$detected_catalyst_version" == "$CATALYST_CLI_VERSION" ]] || \
  fail "the pinned Catalyst CLI ${CATALYST_CLI_VERSION} is unavailable"

python3 -I -S "$repository_root/tools/safety/pre-commit-safety-check.py"

test_export_root="$tool_root/test-export"
readonly test_export_root
export_controller "$test_export_root"
test_project_root="$test_export_root/$controller_subpath"
readonly test_project_root
test_npm_config="$tool_root/test.npmrc"
test_npm_cache="$tool_root/test-npm-cache"
test_dependency_manifest="$tool_root/test-node-modules.manifest"
readonly test_npm_config test_npm_cache test_dependency_manifest
: > "$test_npm_config"
mkdir -p -- "$test_npm_cache"
run_isolated_npm "$test_npm_config" "$test_npm_cache" \
  --prefix "$test_project_root/functions/form2_controller" \
  ci --omit=dev --ignore-scripts --no-audit --no-fund
manifest_tree \
  "$test_project_root/functions/form2_controller/node_modules" \
  "$test_dependency_manifest"
run_isolated_npm "$test_npm_config" "$test_npm_cache" \
  --prefix "$test_project_root/functions/form2_controller" \
  --ignore-scripts run ci
rm -rf -- "$test_export_root" "$test_npm_cache"

deploy_export_root="$tool_root/deploy-export"
reference_export_root="$tool_root/reference-export"
readonly deploy_export_root reference_export_root
export_controller "$deploy_export_root"
export_controller "$reference_export_root"
deploy_project_root="$deploy_export_root/$controller_subpath"
reference_project_root="$reference_export_root/$controller_subpath"
readonly deploy_project_root reference_project_root
deploy_npm_config="$tool_root/deploy.npmrc"
deploy_npm_cache="$tool_root/deploy-npm-cache"
deploy_dependency_manifest="$tool_root/deploy-node-modules.manifest"
readonly deploy_npm_config deploy_npm_cache deploy_dependency_manifest
: > "$deploy_npm_config"
mkdir -p -- "$deploy_npm_cache"
run_isolated_npm "$deploy_npm_config" "$deploy_npm_cache" \
  --prefix "$deploy_project_root/functions/form2_controller" \
  ci --omit=dev --ignore-scripts --no-audit --no-fund
run_isolated_npm "$deploy_npm_config" "$deploy_npm_cache" \
  --prefix "$deploy_project_root/functions/form2_controller" ls --all >/dev/null
manifest_tree \
  "$deploy_project_root/functions/form2_controller/node_modules" \
  "$deploy_dependency_manifest"
cmp --silent "$test_dependency_manifest" "$deploy_dependency_manifest" || \
  fail "the tested and deployable dependency trees differ"

deploy_function_node_modules="$deploy_project_root/functions/form2_controller/node_modules"
readonly deploy_function_node_modules
[[ -d "$deploy_function_node_modules" && ! -L "$deploy_function_node_modules" ]] || \
  fail "the deployable dependency root is not a directory"

source_revision_path="$deploy_project_root/functions/form2_controller/lib/source-revision.js"
reference_revision_path="$reference_project_root/functions/form2_controller/lib/source-revision.js"
form_destination_path="$deploy_project_root/functions/form2_controller/lib/form-destination.js"
readonly source_revision_path reference_revision_path form_destination_path
stamp_revision "$source_revision_path"
stamp_revision "$reference_revision_path"
env -i \
  PATH="$node_root/bin:/usr/bin:/bin" \
  TMPDIR="$temp_parent" \
  APPROVED_FORM2_DESTINATION_SHA256="$APPROVED_FORM2_DESTINATION_SHA256" \
  "$node_root/bin/node" \
  "$deploy_project_root/tools/stamp-form-destination.js" \
  "$deploy_project_root"
env -i \
  PATH="$node_root/bin:/usr/bin:/bin" \
  TMPDIR="$temp_parent" \
  APPROVED_FORM2_DESTINATION_SHA256="$APPROVED_FORM2_DESTINATION_SHA256" \
  "$node_root/bin/node" \
  "$reference_project_root/tools/stamp-form-destination.js" \
  "$reference_project_root"

# The deploy tree starts from Git's immutable object database, not the runner's
# working tree. Apart from the separately integrity-checked top-level function
# dependency subtree, its file manifest must still match a second export of the
# approved commit after stamping. Nested node_modules paths remain in scope.
reference_source_manifest="$tool_root/reference-source.manifest"
deploy_source_manifest="$tool_root/deploy-source.manifest"
readonly reference_source_manifest deploy_source_manifest
function_dependency_subtree="functions/form2_controller/node_modules"
readonly function_dependency_subtree
manifest_tree \
  "$reference_project_root" "$reference_source_manifest" "$function_dependency_subtree"
manifest_tree \
  "$deploy_project_root" "$deploy_source_manifest" "$function_dependency_subtree"
cmp --silent "$reference_source_manifest" "$deploy_source_manifest" || \
  fail "the deployable controller differs from the approved Git export"

artifact_revision="$(read_stamped_revision "$source_revision_path")"
readonly artifact_revision
[[ "$artifact_revision" == "$actual_revision" ]] || \
  fail "the deployable function source revision was not stamped exactly"
artifact_form_destination="$(read_approved_form_destination "$form_destination_path")"
readonly artifact_form_destination
[[ "$artifact_form_destination" == "$APPROVED_FORM2_DESTINATION_SHA256" ]] || \
  fail "the approved Form 2 destination does not match the reviewed source"
env -i PATH="$node_root/bin:/usr/bin:/bin" \
  "$node_root/bin/node" --check "$source_revision_path"
env -i PATH="$node_root/bin:/usr/bin:/bin" \
  "$node_root/bin/node" --check "$form_destination_path"

deploy_function_root="$deploy_project_root/functions/form2_controller"
readonly deploy_function_root
[[ ! -e "$deploy_project_root/.catalystrc" ]] || \
  fail "an unreviewed Catalyst project-state file entered the export"
rm -rf -- "$deploy_function_root/test"
rm -f -- "$deploy_function_root/.env.example"
[[ ! -e "$deploy_function_root/test" ]] || fail "tests remain in the deployable function"
[[ -z "$(find "$deploy_function_root" -name '.env*' -print -quit)" ]] || \
  fail "an environment file remains in the deployable function"

payload_manifest="$tool_root/deploy-payload.manifest"
readonly payload_manifest
manifest_tree "$deploy_function_root" "$payload_manifest"
payload_manifest_hash="$(sha256sum "$payload_manifest")"
payload_manifest_hash="${payload_manifest_hash%% *}"
payload_manifest_entries="$(wc -l < "$payload_manifest")"
readonly payload_manifest_hash payload_manifest_entries
printf '%s\n' \
  "Prepared reviewed Form 2 artifact manifest ${payload_manifest_hash} (${payload_manifest_entries} entries)."

catalyst_home="$tool_root/catalyst-home"
readonly catalyst_home
mkdir -p -- "$catalyst_home"
cd -- "$deploy_project_root"
deployment_ambiguity_warning() {
  printf '%s\n' \
    "Form 2 Development deployment may have completed; independently read back the Development function and deployment before any retry." >&2
}
deployment_interrupted() {
  trap - HUP INT TERM
  deployment_ambiguity_warning
  exit 1
}
trap deployment_interrupted HUP INT TERM
if ! (
  # The official CLI accepts CATALYST_TOKEN from its environment. Remove every
  # inherited export, then expose only the reviewed execution boundary so the
  # credential never enters process argv or process-creation telemetry.
  while IFS= read -r exported_variable; do
    export -n "$exported_variable" 2>/dev/null || true
  done < <(compgen -e)
  export CI=1
  export HOME="$catalyst_home"
  export PATH="$node_root/bin:$(dirname -- "$catalyst_path"):/usr/bin:/bin"
  export CATALYST_TOKEN
  "$catalyst_path" deploy \
    --only functions:form2_controller \
    --ignore-scripts \
    --project "$PROJECT_ID" \
    --org "$CATALYST_ORG" \
    --dc us
); then
  trap - HUP INT TERM
  deployment_ambiguity_warning
  exit 1
fi
trap - HUP INT TERM
