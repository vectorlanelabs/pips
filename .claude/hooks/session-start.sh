#!/bin/bash
# Installs the ai-grouch skill (https://github.com/vectorlanelabs/ai-grouch-claude) so it's
# available in every Claude Code cloud run for this repo, without any manual setup step.
#
# Only runs in remote/web sessions — a local checkout shouldn't have its user-level
# ~/.claude/skills touched by a repo hook. Best-effort: a network hiccup here must never
# fail the session, so every failure path logs a warning and exits 0.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

AI_GROUCH_REPO="https://github.com/vectorlanelabs/ai-grouch-claude"
AI_GROUCH_CLONE_DIR="$HOME/.cache/ai-grouch-claude"
SKILLS_DIR="$HOME/.claude/skills"
SKILL_LINK="$SKILLS_DIR/ai-grouch"

mkdir -p "$SKILLS_DIR"

if [ -d "$AI_GROUCH_CLONE_DIR/.git" ]; then
  # Already cloned from a prior session firing this same hook — just fast-forward it.
  if ! git -C "$AI_GROUCH_CLONE_DIR" pull --ff-only --quiet; then
    echo "session-start-hook: warning: failed to update ai-grouch clone, keeping existing copy" >&2
  fi
elif ! git clone --quiet --depth 1 "$AI_GROUCH_REPO" "$AI_GROUCH_CLONE_DIR"; then
  echo "session-start-hook: warning: failed to clone ai-grouch skill, skipping install" >&2
  exit 0
fi

if [ ! -f "$AI_GROUCH_CLONE_DIR/SKILL.md" ]; then
  echo "session-start-hook: warning: ai-grouch clone missing SKILL.md, skipping install" >&2
  exit 0
fi

ln -sfn "$AI_GROUCH_CLONE_DIR" "$SKILL_LINK"
