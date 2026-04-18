// Typed errors thrown by core modules. The HTTP and MCP layers translate these
// into status codes / tool errors via the `code` field.

export class CoreError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.assign(this, extra);
  }
}

export class SafetyError extends CoreError {
  constructor(rule, reason) {
    super(`blocked by safety guardrails: ${reason}`, 'SAFETY_BLOCKED', { rule, reason });
  }
}

export class TimeoutError extends CoreError {
  constructor(signal) {
    super('command timed out or was killed', 'TIMEOUT', { signal });
  }
}

export class ShellNotFoundError extends CoreError {
  constructor(shell) {
    super(`shell not found: ${shell}`, 'SHELL_NOT_FOUND', { shell });
  }
}

export class FileNotFoundError extends CoreError {
  constructor(path) {
    super(`file not found: ${path}`, 'FILE_NOT_FOUND', { path });
  }
}

export class PermissionDeniedError extends CoreError {
  constructor(path) {
    super(`permission denied: ${path}`, 'PERMISSION_DENIED', { path });
  }
}

export class InvalidPathError extends CoreError {
  constructor(path, reason) {
    super(`invalid path (${reason}): ${path}`, 'INVALID_PATH', { path, reason });
  }
}

export class ValidationError extends CoreError {
  constructor(message) {
    super(message, 'VALIDATION');
  }
}

export class CaptureUnavailableError extends CoreError {
  constructor(reason) {
    super(`capture unavailable: ${reason}`, 'CAPTURE_UNAVAILABLE', { reason });
  }
}

export class InputUnavailableError extends CoreError {
  constructor(reason) {
    super(`input synthesis unavailable: ${reason}`, 'INPUT_UNAVAILABLE', { reason });
  }
}

export class ScreenshotUnavailableError extends CoreError {
  constructor(reason) {
    super(`screenshot unavailable: ${reason}`, 'SCREENSHOT_UNAVAILABLE', { reason });
  }
}

export class BufferOverflowError extends CoreError {
  constructor(limit) {
    super(`output exceeded the ${limit}-byte buffer limit`, 'BUFFER_OVERFLOW', { limit });
  }
}

export class FileTooLargeError extends CoreError {
  constructor(path, size, limit) {
    super(
      `file is ${size} bytes, exceeds the ${limit}-byte limit`,
      'FILE_TOO_LARGE',
      { path, size, limit }
    );
  }
}
