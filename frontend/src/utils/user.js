// Lightweight "is this a returning user?" check.
// We have no auth system — presence of a flag in both localStorage AND a
// cookie is treated as "onboarded." Either one surviving is enough; we write
// both on complete so one getting cleared (private mode, cookie wipe, etc.)
// doesn't force the flow again.

const KEY = 'kraken_onboarded';
const COOKIE = 'kraken_onboarded';

function readCookie(name) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name, value, days = 365) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + days * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

export function isOnboarded() {
  try {
    if (localStorage.getItem(KEY) === '1') return true;
  } catch { /* storage disabled */ }
  return readCookie(COOKIE) === '1';
}

export function markOnboarded() {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  writeCookie(COOKIE, '1');
}

export function resetOnboarded() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  writeCookie(COOKIE, '', -1);
}
