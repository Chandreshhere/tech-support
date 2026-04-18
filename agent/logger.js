// Minimal structured logger that writes to stderr. Avoids stdout because
// the agent might later be wrapped in a protocol transport (like MCP stdio).

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function write(level, component, message, data) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [agent:${component}] ${level}:`;
  const line = data !== undefined
    ? `${prefix} ${message} ${JSON.stringify(data)}`
    : `${prefix} ${message}`;
  process.stderr.write(line + '\n');
}

export const debug = (c, m, d) => write('debug', c, m, d);
export const info  = (c, m, d) => write('info',  c, m, d);
export const warn  = (c, m, d) => write('warn',  c, m, d);
export const error = (c, m, d) => write('error', c, m, d);
