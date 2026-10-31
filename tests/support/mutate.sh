#!/usr/bin/env bash
# Mutation check: apply one sed edit to a product file, run the given vitest files, restore the file. A test that stays green is a finding.
# usage: tests/support/mutate.sh <file> <sed-expression> <vitest paths...>
set -u
f="$1"; expr="$2"; shift 2
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain -- "$f")" ]; then echo "refusing: $f has uncommitted changes"; exit 2; fi
cp "$f" /tmp/mutate.orig
sed -i "$expr" "$f"
if cmp -s "$f" /tmp/mutate.orig; then echo "NO CHANGE: the sed expression matched nothing in $f"; exit 3; fi
npx vitest run "$@" 2>&1 | grep -E "Test Files|Tests " | tr '\n' ' '
echo
git checkout -- "$f"
