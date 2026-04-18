import { readFile, stat } from 'fs/promises';
import {
  FileNotFoundError,
  PermissionDeniedError,
  InvalidPathError,
  ValidationError,
  FileTooLargeError,
} from './errors.js';

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Read a file from disk. Throws typed errors for common failure cases.
 *
 * @param {string} filePath - Absolute or relative path. Relative paths resolve
 *   against the current process working directory, not the caller's cwd.
 * @param {'utf8'|'base64'} [encoding='utf8'] - Output encoding.
 * @param {object} [opts]
 * @param {number} [opts.maxSize=10485760] - Maximum file size in bytes. Files
 *   larger than this throw FileTooLargeError. Set to 0 or Infinity to disable.
 */
export async function readFileSafe(filePath, encoding = 'utf8', opts = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new ValidationError('path (string) is required');
  }
  if (encoding !== 'utf8' && encoding !== 'base64') {
    throw new ValidationError(`encoding must be utf8 or base64, got: ${encoding}`);
  }

  const maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
  if (maxSize !== 0 && maxSize !== Infinity && (!Number.isFinite(maxSize) || maxSize < 0)) {
    throw new ValidationError('maxSize must be a non-negative finite number, 0, or Infinity');
  }

  let info;
  try {
    info = await stat(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') throw new FileNotFoundError(filePath);
    if (err.code === 'EACCES') throw new PermissionDeniedError(filePath);
    if (err.code === 'ENOTDIR') throw new InvalidPathError(filePath, 'parent is not a directory');
    if (err.code === 'ELOOP') throw new InvalidPathError(filePath, 'symlink loop');
    if (err.code === 'ENAMETOOLONG') throw new InvalidPathError(filePath, 'name too long');
    throw err;
  }

  if (!info.isFile()) {
    throw new InvalidPathError(filePath, info.isDirectory() ? 'path is a directory' : 'path is not a regular file');
  }

  if (maxSize && maxSize !== Infinity && info.size > maxSize) {
    throw new FileTooLargeError(filePath, info.size, maxSize);
  }

  try {
    if (encoding === 'base64') {
      const buf = await readFile(filePath);
      return {
        path: filePath,
        size: info.size,
        encoding: 'base64',
        content: buf.toString('base64'),
      };
    }
    const content = await readFile(filePath, 'utf8');
    return {
      path: filePath,
      size: info.size,
      encoding: 'utf8',
      content,
    };
  } catch (err) {
    if (err.code === 'EACCES') throw new PermissionDeniedError(filePath);
    if (err.code === 'EISDIR') throw new InvalidPathError(filePath, 'path is a directory');
    throw err;
  }
}
