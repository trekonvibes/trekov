#!/usr/bin/env bash
# Build and publish to the gh-pages branch.
#
# GitHub Actions would be tidier, but pushing a workflow file needs the
# `workflow` token scope. This needs nothing beyond `repo`, which `gh auth`
# already has. To switch to Actions later:
#   gh auth refresh -s workflow   # then restore .github/workflows/deploy.yml
set -euo pipefail

# Derived from the git remote, so moving the repo to another account needs no
# edit here — just `git remote set-url origin`.
REPO="$(git -C "$(cd "$(dirname "$0")" && pwd)" remote get-url origin \
        | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
BRANCH="gh-pages"
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building"
# build:native also writes dist/updates/ — the live update the Android and
# iOS apps pick up (scripts/build-update.mjs).
npm run build:native --prefix "$ROOT"

echo "==> Publishing dist/ to $BRANCH"
cd "$ROOT/dist"
rm -rf .git
git init -q
git checkout -qb "$BRANCH"
git add -A
git -c user.email="trekonvibes@gmail.com" -c user.name="Punit" commit -qm "Deploy $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -qf "https://x-access-token:$(gh auth token)@github.com/$REPO.git" "$BRANCH"
rm -rf .git

echo "==> Done — https://trekov.com"
