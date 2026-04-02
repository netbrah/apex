#!/usr/bin/env bash
# qwen-audit.sh — find all "qwen" references and categorize by file type
# Usage: bash scripts/qwen-audit.sh
# macOS bash 3.x compatible (no mapfile, no associative arrays)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

EXCL="--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
      --exclude-dir=coverage --exclude-dir=packages/sdk-java"

# ── collect files by category ────────────────────────────────────────────────

ts_files=$(grep -ril "qwen" $EXCL \
  --include="*.ts" --include="*.tsx" "$ROOT" 2>/dev/null | sort)

js_files=$(grep -ril "qwen" $EXCL \
  --include="*.js" --include="*.mjs" "$ROOT" 2>/dev/null | sort)

json_files=$(grep -ril "qwen" $EXCL \
  --include="*.json" "$ROOT" 2>/dev/null | sort)

md_files=$(grep -ril "qwen" $EXCL \
  --include="*.md" "$ROOT" 2>/dev/null | sort)

sh_files=$(grep -ril "qwen" $EXCL \
  --include="*.sh" --include="*.bash" "$ROOT" 2>/dev/null | sort)

docker_files=$(grep -ril "qwen" $EXCL \
  --include="Dockerfile" --include="Dockerfile.*" "$ROOT" 2>/dev/null | sort)

other_files=$(grep -ril "qwen" $EXCL \
  --include="*.yaml" --include="*.yml" \
  --include="*.toml" --include="*.env" "$ROOT" 2>/dev/null | sort)

count_lines() { echo "$1" | grep -c . 2>/dev/null || echo 0; }

ts_count=$(count_lines "$ts_files")
js_count=$(count_lines "$js_files")
json_count=$(count_lines "$json_files")
md_count=$(count_lines "$md_files")
sh_count=$(count_lines "$sh_files")
docker_count=$(count_lines "$docker_files")
other_count=$(count_lines "$other_files")
total=$(( ts_count + js_count + json_count + md_count + sh_count + docker_count + other_count ))

# ── summary ──────────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════╗"
echo "║          QWEN reference audit                    ║"
echo "╚══════════════════════════════════════════════════╝"
printf "  %-22s %d\n" "Total files:" "$total"
echo ""
printf "  %-22s %d\n" "TypeScript / TSX:"  "$ts_count"
printf "  %-22s %d\n" "JavaScript:"        "$js_count"
printf "  %-22s %d\n" "JSON:"              "$json_count"
printf "  %-22s %d\n" "Markdown:"          "$md_count"
printf "  %-22s %d\n" "Shell:"             "$sh_count"
printf "  %-22s %d\n" "Dockerfiles:"       "$docker_count"
printf "  %-22s %d\n" "Other:"             "$other_count"

# ── pattern breakdown (what kind of qwen refs remain) ───────────────────────

echo ""
echo "── Pattern breakdown (top 20) ────────────────────"
grep -rih "qwen" $EXCL \
  --include="*.ts" --include="*.tsx" --include="*.js" \
  --include="*.json" --include="*.md" --include="*.sh" \
  "$ROOT" 2>/dev/null \
| grep -oiE "[a-zA-Z@._/-]*qwen[a-zA-Z0-9._/-]*" \
| sort | uniq -c | sort -rn | head -20

# ── per-file detail ──────────────────────────────────────────────────────────

print_section() {
  local label="$1"
  local files="$2"
  local count="$3"
  [ "$count" -eq 0 ] && return
  echo ""
  echo "════════════════════════════════════════════════════"
  printf "  %s (%d files)\n" "$label" "$count"
  echo "════════════════════════════════════════════════════"
  echo "$files" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    rel="${f#$ROOT/}"
    echo ""
    echo "  ── $rel"
    grep -in "qwen" "$f" | sed 's/^/    /'
  done
}

print_section "TypeScript / TSX" "$ts_files"   "$ts_count"
print_section "JavaScript"       "$js_files"   "$js_count"
print_section "JSON"             "$json_files" "$json_count"
print_section "Markdown"         "$md_files"   "$md_count"
print_section "Shell"            "$sh_files"   "$sh_count"
print_section "Dockerfiles"      "$docker_files" "$docker_count"
print_section "Other"            "$other_files" "$other_count"

echo ""
echo "── done ──"
