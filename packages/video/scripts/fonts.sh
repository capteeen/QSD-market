#!/bin/sh
# Fetches the two variable fonts the video page uses (not committed).
set -e
d="$(dirname "$0")/../public/fonts"
mkdir -p "$d"
css=$(curl -sS -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap")
mono=$(printf '%s' "$css" | grep -B4 'U+0000-00FF' | grep -o 'https://[^)]*jetbrainsmono[^)]*woff2' | head -1)
grot=$(printf '%s' "$css" | grep -B4 'U+0000-00FF' | grep -o 'https://[^)]*spacegrotesk[^)]*woff2' | head -1)
curl -sS -o "$d/jetbrains-mono.woff2" "$mono"
curl -sS -o "$d/space-grotesk.woff2" "$grot"
ls -la "$d"
