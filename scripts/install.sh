#!/usr/bin/env bash
set -euo pipefail
cd /workspace/ambiente
export npm_config_cache=/workspace/.npm-cache
node -e 'if(Number(process.versions.node.split(".")[0])<24) throw new Error("Node.js 24 ou superior é necessário")'
command -v ffprobe >/dev/null || { echo 'Instale ffmpeg/ffprobe para validar os vídeos.' >&2; exit 1; }
npm ci --no-audit --no-fund
npm run build
