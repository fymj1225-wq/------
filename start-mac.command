#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js が入っていません。"
  echo "  https://nodejs.org/ja から LTS 版を入れてから、もう一度開いてください。"
  echo ""
  read -n 1 -s
  exit 1
fi
( sleep 1; open "http://localhost:8787/" ) &
node server.js
