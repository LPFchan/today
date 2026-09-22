#!/bin/sh
# Commit staged changes with a repo-compliant LOG message.
#   sh scripts/commit.sh "subject" "change; change" "rationale; rationale" "check; check" [artifacts]
set -eu
subject=$1 changes=$2 rationale=$3 checks=$4 artifacts=${5:-}
msg=$(mktemp -u /tmp/today-commit-XXXXXXXX.txt)
sh scripts/new-commit-message.sh --subject "$subject" --agent claude-opus-5-5 --role orchestrator ${artifacts:+--artifacts "$artifacts"} --output "$msg" >/dev/null
python3 - "$msg" "$changes" "$rationale" "$checks" <<'PY'
import sys, re
path, *sections = sys.argv[1:]
text = open(path).read()
for key, value in zip(["changes", "rationale", "checks"], sections):
    lines = "\n".join(f"- {item.strip()}" for item in value.split(";") if item.strip())
    text = re.sub(rf"^{key}:\n(?:- TODO.*\n)+", f"{key}:\n{lines}\n", text, count=1, flags=re.M)
open(path, "w").write(text)
PY
sh scripts/check-commit-standards.sh "$msg"
git commit -q -F "$msg"
rm -f "$msg"
git log --oneline -1
