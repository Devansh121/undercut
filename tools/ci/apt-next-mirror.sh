#!/usr/bin/env bash
# Moves the first mirror in the runner's apt mirror list to the end, so the next apt run starts on
# another mirror. apt's mirror method only fails over on an error, not on a mirror that is slow
# (one crawled at a few kB/s for whole jobs), so a retry after a stalled attempt calls this first.
#
#   tools/ci/apt-next-mirror.sh            rotate
#   tools/ci/apt-next-mirror.sh --setup    add the fallback mirrors if missing, print the list
set -euo pipefail

list=/etc/apt/apt-mirrors.txt
fallbacks=(http://azure.archive.ubuntu.com/ubuntu/ http://archive.ubuntu.com/ubuntu/)

if [ ! -f "$list" ]; then
  echo "No $list on this runner; apt mirror order unchanged."
  exit 0
fi

tmp="${RUNNER_TEMP:-/tmp}/apt-mirrors.txt"
# Writes the mirrors (one per line, URI first) back in the given order. apt orders mirrors by their
# `priority:` tag rather than by line, so every line gets a priority matching its position.
write_in_order() {
  awk -F'\t' 'NF && $1 !~ /^[[:space:]]*$/ {
    out = $1
    for (i = 2; i <= NF; i++) if ($i !~ /^priority:/) out = out "\t" $i
    print out "\tpriority:" ++n
  }' > "$tmp"
  sudo cp "$tmp" "$list"
}

if [ "${1:-}" = "--setup" ]; then
  {
    cat "$list"
    for mirror in "${fallbacks[@]}"; do
      host=${mirror#http://}
      host=${host%%/*}
      grep -qF "://$host/" "$list" || echo "$mirror"
    done
  } | write_in_order
else
  # The current first mirror (lowest priority value) goes last.
  sorted=$(awk -F'\t' 'NF { p = 0; for (i = 2; i <= NF; i++) if ($i ~ /^priority:/) p = substr($i, 10) + 0; printf "%d\t%d\t%s\n", p, NR, $0 }' "$list" | sort -n -k1,1 -k2,2 | cut -f3-)
  first=$(head -n1 <<< "$sorted")
  { tail -n +2 <<< "$sorted"; echo "$first"; } | write_in_order
  echo "Moved ${first%%[[:space:]]*} to the end of the apt mirror list."
fi
echo "apt mirrors, in order:"
sed 's/^/  /' "$list"
