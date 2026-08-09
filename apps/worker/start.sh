#!/bin/sh
set -e
cd "$(dirname "$0")"
bun install
exec bun ./src/index.ts
