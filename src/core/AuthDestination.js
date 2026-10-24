// Resolve after parsing: browsers normalize backslashes/control characters in
// URLs, so a string-prefix check alone does not keep a login redirect on-site.
export function authDestination(search = location.search, base = location.href) {
  const next = new URLSearchParams(search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(next)) return '/';
  try {
    const current = new URL(base), target = new URL(next, current);
    return target.origin === current.origin ? target.pathname + target.search + target.hash : '/';
  } catch { return '/'; }
}
