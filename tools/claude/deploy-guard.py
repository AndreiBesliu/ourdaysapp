#!/usr/bin/env python
"""Ask before a Firebase deploy.

Andrei's rule (2026-08-15): the free, no-confirmation sync belongs to a TEST instance;
a deploy to a LIVE instance is confirmed first. Until a test project exists, every deploy
is live, so every deploy is confirmed.

Why a hook and not a permission rule: a rule matches a command PREFIX, and the deploys
this project actually runs are compound —

    cd "C:/.../OurDaysApp" && git commit -q -m x && npx firebase deploy --only hosting

which starts with `cd` and would sail past `Bash(npx firebase deploy *)` untouched. A rule
here would look like protection and be none. This reads the whole command string.

Erring toward asking is deliberate: a false positive costs one keypress, a false negative
publishes to a live site.
"""
import io
import json
import os
import re
import sys

# `firebase deploy` / `firebase-tools deploy`, with or without npx, anywhere in a compound
# command; plus the npm scripts that wrap it (DataRead and PrestoConstruct both have
# `deploy` and `deploy:functions`).
DEPLOY = re.compile(
    r"(?:^|[\s;&|(])(?:npx\s+)?(?:firebase|firebase-tools)\s+deploy\b"
    r"|(?:^|[\s;&|(])npm\s+run\s+deploy\b",
    re.IGNORECASE,
)

# The other half of Andrei's rule: a deploy that NAMES a test target goes through
# unattended. Written now so that standing up a test instance is one `.firebaserc` line
# plus one alias here — not a hunt through this file under time pressure.
#
# Only an EXPLICIT `--project <alias>` counts. A bare `firebase deploy` resolves its target
# silently from `.firebaserc`, and a guard that guessed from the default would wave through
# exactly the deploy nobody looked at.
TEST_TARGET = re.compile(r"--project[\s=]+(test|staging|dev)\b", re.IGNORECASE)

REASON = (
    "This publishes to a LIVE Firebase project. There is no test instance yet, so every "
    "deploy is a live deploy — confirm the target before it ships. (Once one exists, a "
    "deploy naming it with --project test goes through unattended.)"
)



def _really_a_test_project(alias: str) -> bool:
    """Does this alias resolve to a project that is NOT a live one, anywhere in the tree?

    The hole this closes: the alias is just a name. Someone adds `"test": "prestoconshop"`
    to a `.firebaserc` — pointing the test alias at the live project, by typo or by
    copy-paste — and a guard that trusted the WORD would wave a live deploy straight
    through, silently, which is the exact failure it exists to prevent.

    So the word is not enough: the id behind it must not be an id that any `live` alias in
    the tree also names. Unknown alias, unreadable file, no match — all fall through to
    asking, because the safe direction here is one extra keypress.
    """
    import glob
    live_ids, alias_ids = set(), set()
    for path in glob.glob(os.path.join(os.path.dirname(__file__), '..', '..', '*', '.firebaserc')):
        try:
            projects = (json.load(io.open(path, encoding='utf-8')) or {}).get('projects') or {}
        except Exception:
            continue
        for k, v in projects.items():
            if not isinstance(v, str):
                continue
            if k in ('live', 'default', 'prod', 'production'):
                live_ids.add(v)
            if k.lower() == alias.lower():
                alias_ids.add(v)
    return bool(alias_ids) and not (alias_ids & live_ids)

def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        # A hook that cannot read its input must not silently wave the command through,
        # but it also must not block every unrelated Bash call. Stay quiet and let the
        # normal permission rules decide.
        return 0

    command = (payload.get("tool_input") or {}).get("command") or ""
    if not DEPLOY.search(command):
        return 0

    named = TEST_TARGET.search(command)
    if named and _really_a_test_project(named.group(1)):
        return 0

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": REASON,
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
