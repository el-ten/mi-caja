// Código de conexión: "MC1." + base64url({u: dirección de Apps Script, t: clave}).
// Sirve para conectar otro celular (por ejemplo el de tu mamá) sin escribir la dirección y la clave a mano.
const b64u = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)))),
};
export function makeCode(url, token, sheet) { return 'MC1.' + b64u.enc(JSON.stringify(sheet ? { u: url, t: token, s: sheet } : { u: url, t: token })); }
// ID de la planilla a partir de su link (o el ID solo). '' si no se reconoce.
export function sheetId(v) { const s = String(v || '').trim(); const m = /\/spreadsheets\/d\/([\w-]{20,})/.exec(s); return m ? m[1] : /^[\w-]{20,}$/.test(s) ? s : ''; }
export function parseCode(text) {
  const s = String(text || '').trim().replace(/\s+/g, '');
  if (!s.startsWith('MC1.')) return null;
  try { const o = JSON.parse(b64u.dec(s.slice(4))); if (o && validUrl(o.u) && typeof o.t === 'string' && o.t) return { url: o.u, token: o.t, sheet: typeof o.s === 'string' ? o.s : '' }; } catch {}
  return null;
}
export function validUrl(u) { return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(u || '').trim()) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(String(u || '')); }
