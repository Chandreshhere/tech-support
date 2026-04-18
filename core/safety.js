// Best-effort guardrails for shell commands and scripts.
// A determined caller can bypass these with encoding, env-var indirection,
// base64, or by writing a script file via /file then running it. Treat this
// as a footgun shield, not a security boundary.

const DANGEROUS_PATTERNS = [
  // ---------- Unix / Linux / macOS ----------
  {
    name: 'rm-rf-root-or-home',
    pattern: /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*[fF]?|-[a-zA-Z]*[fF][a-zA-Z]*[rR])\s+(?:\/|\/\*|~|~\/\*|\$HOME|\$\{HOME\})(?:\s|$|;|&|\|)/,
    reason: 'recursive delete targeting filesystem root or home directory',
  },
  {
    name: 'rm-no-preserve-root',
    pattern: /--no-preserve-root/,
    reason: 'disables rm safety net for /',
  },
  {
    name: 'mkfs',
    pattern: /\bmkfs(?:\.\w+)?\b/,
    reason: 'filesystem format',
  },
  {
    name: 'dd-to-block-device',
    pattern: /\bdd\b[^|;&]*\bof=\/dev\/(?:sd|nvme|hd|xvd|disk|mmcblk)/i,
    reason: 'dd writing to a block device',
  },
  {
    name: 'fork-bomb',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'classic shell fork bomb',
  },
  {
    name: 'power-state',
    pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
    reason: 'system power state change',
  },
  {
    name: 'init-runlevel',
    pattern: /\binit\s+[06]\b/,
    reason: 'init 0/6 (shutdown/reboot)',
  },
  {
    name: 'chmod-recursive-root',
    pattern: /\bchmod\s+-R\s+\S+\s+\/(?:\s|$)/,
    reason: 'recursive chmod starting at /',
  },
  {
    name: 'chown-recursive-root',
    pattern: /\bchown\s+-R\s+\S+\s+\/(?:\s|$)/,
    reason: 'recursive chown starting at /',
  },
  {
    name: 'pipe-remote-to-shell',
    pattern: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^|;]*\|\s*(?:sh|bash|zsh|ksh|fish|cmd|cmd\.exe|powershell|pwsh)\b/i,
    reason: 'piping remote content directly into a shell interpreter',
  },
  {
    name: 'redirect-to-block-device',
    pattern: />\s*\/dev\/(?:sd|nvme|hd|xvd|disk|mmcblk)/i,
    reason: 'redirecting output to a block device',
  },

  // ---------- Windows ----------
  {
    name: 'format-drive',
    pattern: /\bformat\s+[a-zA-Z]:/i,
    reason: 'Windows drive format',
  },
  {
    name: 'diskpart',
    pattern: /\bdiskpart\b/i,
    reason: 'Windows disk partitioning utility',
  },
  {
    name: 'del-drive-root',
    pattern: /\bdel\b[^|;&]*\/[sS][^|;&]*[a-zA-Z]:\\?\*?/i,
    reason: 'Windows recursive delete from drive root',
  },
  {
    name: 'rmdir-drive-root',
    pattern: /\b(?:rd|rmdir)\b[^|;&]*\/[sS][^|;&]*[a-zA-Z]:\\?\*?/i,
    reason: 'Windows recursive directory removal from drive root',
  },
  {
    name: 'windows-shutdown',
    pattern: /\bshutdown\b\s+\/[a-zA-Z]/i,
    reason: 'Windows shutdown command',
  },
  {
    name: 'cipher-wipe',
    pattern: /\bcipher\s+\/w:/i,
    reason: 'Windows cipher /w secure wipe',
  },
];

export function checkCommandSafety(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return { safe: false, rule: 'empty', reason: 'empty command' };
  }
  for (const rule of DANGEROUS_PATTERNS) {
    if (rule.pattern.test(command)) {
      return { safe: false, rule: rule.name, reason: rule.reason };
    }
  }
  return { safe: true };
}

export function listSafetyRules() {
  return DANGEROUS_PATTERNS.map(({ name, reason }) => ({ name, reason }));
}
