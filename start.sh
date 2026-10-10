#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

if [ ! -f .env ]; then
  printf '%s\n' 'Missing .env. Create it from .env.example and add OPENROUTER_API_KEY.' >&2
  exit 1
fi

printf '%s\n' 'AgentRunner will print an OPEN THIS URL line. If no browser opens, copy that exact URL into your browser.'
npm run build
exec npm run start
