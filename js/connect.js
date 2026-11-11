// Código de conexión: "MC1." + base64url({u: dirección de Apps Script, t: clave}).
// Sirve para conectar otro celular (por ejemplo el de tu mamá) sin escribir la dirección y la clave a mano.
const b64u = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)))),
};
export function makeCode(url, token) { return 'MC1.' + b64u.enc(JSON.stringify({ u: url, t: token })); }
export function parseCode(text) {
  const s = String(text || '').trim().replace(/\s+/g, '');
  if (!s.startsWith('MC1.')) return null;
  try { const o = JSON.parse(b64u.dec(s.slice(4))); if (o && validUrl(o.u) && typeof o.t === 'string' && o.t) return { url: o.u, token: o.t }; } catch {}
  return null;
}
export function validUrl(u) { return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '').trim()) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(String(u || '')); }
