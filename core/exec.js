import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import { checkCommandSafety } from './safety.js';
import { getDefaultShell } from './system.js';
import {
  SafetyError,
  TimeoutError,
  ShellNotFoundError,
  ValidationError,
  BufferOverflowError,
} from './errors.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;

// How to invoke a saved script file with each shell. Key is the shell basename
// (lowercased, .exe stripped). Unknown shells fall back to bash-style.
const SCRIPT_RUNNERS = {
  bash:       { ext: '.sh',   args: (f) => [f] },
  sh:         { ext: '.sh',   args: (f) => [f] },
  zsh:        { ext: '.sh',   args: (f) => [f] },
  dash:       { ext: '.sh',   args: (f) => [f] },
  ksh:        { ext: '.sh',   args: (f) => [f] },
  fish:       { ext: '.fish', args: (f) => [f] },
  pwsh:       { ext: '.ps1',  args: (f) => ['-NoProfile', '-File', f] },
  powershell: { ext: '.ps1',  args: (f) => ['-NoProfile', '-File', f] },
  cmd:        { ext: '.bat',  args: (f) => ['/c', f] },
};

function getRunner(shellPath) {
  const key = path.basename(shellPath).toLowerCase().replace(/\.exe$/, '');
  return SCRIPT_RUNNERS[key] || SCRIPT_RUNNERS.bash;
}

function translateExecError(err, chosenShell) {
  if (!err) return null;
  // Timeout/kill: child_process sets killed=true and a signal name when the
  // timeout fires (or the parent kills the child for any reason).
  if (err.killed || err.signal) {
    return new TimeoutError(err.signal ?? 'SIGTERM');
  }
  // Shell binary missing or not executable. ENOENT happens when the file
  // doesn't exist; EACCES when it exists but isn't executable.
  if (err.code === 'ENOENT' || err.code === 'EACCES') {
    return new ShellNotFoundError(err.path || chosenShell || 'unknown');
  }
  // Output exceeded the maxBuffer ceiling. Node uses a string code for this.
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new BufferOverflowError(MAX_BUFFER);
  }
  return null;
}

function validateExecOptions({ shell, cwd, timeout }) {
  if (shell !== undefined && (typeof shell !== 'string' || !shell)) {
    throw new ValidationError('shell must be a non-empty string when provided');
  }
  if (cwd !== undefined && (typeof cwd !== 'string' || !cwd)) {
    throw new ValidationError('cwd must be a non-empty string when provided');
  }
  if (timeout !== undefined) {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new ValidationError('timeout must be a positive finite number (ms)');
    }
  }
}

/**
 * Run a single inline command via the chosen shell.
 * Non-zero exit codes resolve normally with `exitCode` set.
 * Throws SafetyError / TimeoutError / ShellNotFoundError for terminal failures.
 */
export async function runCommand({ command, shell, cwd, timeout = DEFAULT_TIMEOUT } = {}) {
  if (!command || typeof command !== 'string') {
    throw new ValidationError('command (string) is required');
  }
  validateExecOptions({ shell, cwd, timeout });

  const safety = checkCommandSafety(command);
  if (!safety.safe) {
    throw new SafetyError(safety.rule, safety.reason);
  }

  const chosenShell = shell || getDefaultShell();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout,
      maxBuffer: MAX_BUFFER,
      shell: chosenShell,
    });
    return {
      mode: 'command',
      shell: chosenShell,
      cwd: cwd || process.cwd(),
      platform: process.platform,
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (err) {
    const translated = translateExecError(err, chosenShell);
    if (translated) throw translated;
    if (typeof err.code === 'number') {
      return {
        mode: 'command',
        shell: chosenShell,
        cwd: cwd || process.cwd(),
        platform: process.platform,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.code,
      };
    }
    throw err;
  }
}

/**
 * Run a multi-line script by writing it to a temp file and invoking it with
 * the chosen shell. Quoting/escaping inside the script body is preserved
 * exactly because the body is never parsed by an outer shell.
 */
export async function runScript({ script, shell, cwd, timeout = DEFAULT_TIMEOUT } = {}) {
  if (!script || typeof script !== 'string') {
    throw new ValidationError('script (string) is required');
  }
  validateExecOptions({ shell, cwd, timeout });

  const safety = checkCommandSafety(script);
  if (!safety.safe) {
    throw new SafetyError(safety.rule, safety.reason);
  }

  const chosenShell = shell || getDefaultShell();
  const runner = getRunner(chosenShell);
  const tempFilePath = path.join(tmpdir(), `kraken-script-${randomUUID()}${runner.ext}`);

  try {
    await writeFile(tempFilePath, script, { mode: 0o600 });

    try {
      const { stdout, stderr } = await execFileAsync(chosenShell, runner.args(tempFilePath), {
        cwd,
        timeout,
        maxBuffer: MAX_BUFFER,
      });
      return {
        mode: 'script',
        shell: chosenShell,
        cwd: cwd || process.cwd(),
        platform: process.platform,
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (err) {
      const translated = translateExecError(err, chosenShell);
      if (translated) throw translated;
      if (typeof err.code === 'number') {
        return {
          mode: 'script',
          shell: chosenShell,
          cwd: cwd || process.cwd(),
          platform: process.platform,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? '',
          exitCode: err.code,
        };
      }
      throw err;
    }
  } finally {
    try { await unlink(tempFilePath); } catch {}
  }
}
