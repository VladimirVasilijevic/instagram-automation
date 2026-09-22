#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: verify.sh quick|full

quick  Inspect local changes and run the smallest reliable repository checks.
full   Run the complete local validation gate used before review.
EOF
}

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

mode=$1
if [[ $mode != quick && $mode != full ]]; then
  usage >&2
  exit 2
fi

repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo 'verify.sh must run inside a Git repository.' >&2
  exit 1
}
cd "$repository_root"

run() {
  printf '\n> '
  printf '%q ' "$@"
  printf '\n'
  "$@"
}

changed_files() {
  {
    git diff --name-only --diff-filter=ACMRD HEAD --
    git ls-files --others --exclude-standard
  } | LC_ALL=C sort -u
}

check_changed_shell_scripts() {
  local file
  for file in "$@"; do
    if [[ $file == *.sh && -f $file ]]; then
      run bash -n "$file"
    fi
  done
}

run_full() {
  run pnpm check
  run pnpm test
  run pnpm typecheck
  run pnpm build
  run pnpm docs:code
  run git diff --check
}

run_related_tests() {
  local package_name=$1
  local package_path=$2
  shift 2

  local file
  local report_file
  local use_package_tests=false
  local -a related_files=()

  for file in "$@"; do
    [[ $file == "$package_path"/* ]] || continue

    if [[ ! -f $file ]]; then
      use_package_tests=true
      continue
    fi

    case "$file" in
      *.cjs | *.cts | *.js | *.jsx | *.mjs | *.mts | *.ts | *.tsx)
        related_files+=("${file#"$package_path"/}")
        ;;
      *)
        use_package_tests=true
        ;;
    esac
  done

  if [[ $use_package_tests == true || ${#related_files[@]} -eq 0 ]]; then
    echo "$package_name has changes Vitest cannot map safely; running its complete test suite."
    run pnpm --filter "$package_name" test
    return
  fi

  report_file=$(mktemp)
  if run pnpm --filter "$package_name" exec vitest related --run "${related_files[@]}" \
    --reporter=dot --reporter=json --outputFile.json="$report_file"; then
    if grep -q '"numTotalTestSuites":0' "$report_file"; then
      rm -f "$report_file"
      echo "$package_name has no discoverable related tests; running its complete test suite."
      run pnpm --filter "$package_name" test
      return
    fi

    rm -f "$report_file"
    return
  fi

  local status=$?
  rm -f "$report_file"
  return "$status"
}

if [[ $mode == full ]]; then
  mapfile -t files < <(changed_files)
  check_changed_shell_scripts "${files[@]}"
  run_full
  exit 0
fi

mapfile -t files < <(changed_files)
if [[ ${#files[@]} -eq 0 ]]; then
  echo 'No tracked or untracked changes found.'
  exit 0
fi

needs_api=false
needs_web=false
needs_full=false

for file in "${files[@]}"; do
  case "$file" in
    apps/api/* | db/* | .env.example)
      needs_api=true
      ;;
    apps/web/*)
      needs_web=true
      ;;
    .agents/skills/* | doc/* | README* | AGENTS.md | .gitignore)
      ;;
    package.json | pnpm-lock.yaml | pnpm-workspace.yaml | tsconfig.json | vercel.json | \
      eslint.config.* | lint-staged.config.* | .editorconfig | .prettierignore | \
      .prettierrc.json | .github/* | .husky/* | packages/* | tests/*)
      needs_full=true
      ;;
    *)
      needs_full=true
      ;;
  esac
done

check_changed_shell_scripts "${files[@]}"

if [[ $needs_full == true ]]; then
  echo 'Cross-cutting or unclassified changes found; running the full validation gate.'
  run_full
  exit 0
fi

run pnpm check

if [[ $needs_api == true ]]; then
  run_related_tests @instagram-automation/api apps/api "${files[@]}"
  run pnpm --filter @instagram-automation/api typecheck
fi

if [[ $needs_web == true ]]; then
  run_related_tests @instagram-automation/web apps/web "${files[@]}"
  run pnpm --filter @instagram-automation/web typecheck
fi

run git diff --check
