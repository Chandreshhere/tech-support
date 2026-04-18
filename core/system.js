import os from 'os';
import { execSync } from 'child_process';

// Detect bash availability once at module load. Prefer bash on Unix so callers
// can use bash-isms ([[ ]], arrays, <<<, etc.) without opting in.
let DEFAULT_UNIX_SHELL = '/bin/sh';
if (process.platform !== 'win32') {
  try {
    const found = execSync('command -v bash', { encoding: 'utf8' }).trim();
    if (found) DEFAULT_UNIX_SHELL = found;
  } catch {
    // bash not found — keep /bin/sh
  }
}
const DEFAULT_WIN_SHELL = process.env.ComSpec || 'cmd.exe';

export function getDefaultShell() {
  return process.platform === 'win32' ? DEFAULT_WIN_SHELL : DEFAULT_UNIX_SHELL;
}

export function getPlatformInfo() {
  const platform = os.platform();
  return {
    platform,
    isWindows: platform === 'win32',
    isMac: platform === 'darwin',
    isLinux: platform === 'linux',
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
    shell: getDefaultShell(),
    nodeVersion: process.version,
  };
}
