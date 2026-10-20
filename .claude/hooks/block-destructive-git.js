#!/usr/bin/env node
/**
 * PreToolUse(Bash) guardrail: hard-deny destructive / history-rewriting git & gh
 * commands. Reads the hook payload (JSON) on stdin, inspects tool_input.command,
 * and on a match prints a PreToolUse "deny" decision so the command never runs.
 *
 * Shell-independent (invoked via `node`), so it behaves the same under PowerShell
 * and Git Bash. Wired up in .claude/settings.json -> hooks.PreToolUse.
 *
 * To add/remove a blocked pattern, edit RULES below. A non-match exits 0 silently
 * (the command proceeds to the normal permission flow).
 */

// Each rule: { test: RegExp, label: string }. The regex is matched against the
// whole command string, so chained commands (a && git reset --hard) are caught too.
const RULES = [
  { label: "git reset --hard", test: /\bgit\s+reset\s+(?:[^;&|]*\s)?--hard\b/ },
  { label: "git push --force / -f / --force-with-lease", test: /\bgit\s+push\b[^;&|]*(?:--force(?:-with-lease)?\b|\s-f\b)/ },
  { label: "git push --delete / -d (remote branch/tag deletion)", test: /\bgit\s+push\b[^;&|]*(?:--delete\b|\s-d\b)/ },
  { label: "git rebase (history rewrite)", test: /\bgit\s+rebase\b(?![^;&|]*--(?:abort|continue|skip|quit|edit-todo))/ },
  { label: "git clean (deletes untracked files)", test: /\bgit\s+clean\b(?![^;&|]*(?:--dry-run|\s-n\b))/ },
  { label: "git branch -D / -d / --delete", test: /\bgit\s+branch\b[^;&|]*(?:-D\b|\s-d\b|--delete\b)/ },
  { label: "git tag -d / --delete", test: /\bgit\s+tag\b[^;&|]*(?:\s-d\b|--delete\b)/ },
  { label: "git stash drop / clear", test: /\bgit\s+stash\s+(?:drop|clear)\b/ },
  { label: "git checkout -- <file> / . (discards changes)", test: /\bgit\s+checkout\s+(?:--($|\s)|\.(?:\s|$))/ },
  { label: "git restore (discards working-tree changes)", test: /\bgit\s+restore\b(?![^;&|]*--staged\b(?![^;&|]*--worktree))/ },
  { label: "git reflog delete / expire", test: /\bgit\s+reflog\s+(?:delete|expire)\b/ },
  { label: "git update-ref -d (ref deletion)", test: /\bgit\s+update-ref\b[^;&|]*\s-d\b/ },
  { label: "git filter-branch / filter-repo (history rewrite)", test: /\bgit\s+filter-(?:branch|repo)\b/ },
  { label: "gh pr close", test: /\bgh\s+pr\s+close\b/ },
  { label: "gh repo delete", test: /\bgh\s+repo\s+delete\b/ },
  { label: "gh api ... -X DELETE / --method DELETE", test: /\bgh\s+api\b[^;&|]*(?:-X\s+DELETE|--method\s+DELETE)/i },
];

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = String(JSON.parse(raw)?.tool_input?.command ?? "");
  } catch {
    process.exit(0); // can't parse payload -> don't block
  }
  if (!cmd) process.exit(0);

  for (const rule of RULES) {
    if (rule.test.test(cmd)) {
      deny(
        `BLOCKED by project guardrail (.claude/hooks/block-destructive-git.js): this is a destructive / history-rewriting command (${rule.label}). ` +
          `Per CLAUDE.md, the agent must NEVER run this — even on explicit request. ` +
          `Do not retry or work around it. Instead give the user the exact command to run by hand, explain what it does and the risk, and let them execute it themselves.`
      );
    }
  }
  process.exit(0);
});
