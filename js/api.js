// Comunicación con la planilla: por Apps Script (modo real) o con el simulador interno (modo demo).
import { createMock, demoSeed, DEMO_TOKEN } from './mock.js';
import { store } from './store.js';

export class NetworkError extends Error {}
export class ServerError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

let demo = null;
async function demoServer() {
  if (!demo) { const saved = await store.getKV('mock:demo'); demo = createMock(saved || demoSeed()); }
  return demo;
}
export function resetDemo() { demo = null; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(body, timeoutMs = 25000, override = null) {
  const cfg = override ? { mode: 'live', ...override } : store.config;
  if (cfg.mode === 'demo') {
    const m = await demoServer();
    if (store.demoOffline) { await wait(150); throw new NetworkError('Sin conexión (simulada)'); }
    const out = m.handle(JSON.parse(JSON.stringify({ ...body, token: DEMO_TOKEN })));
    if (body.action === 'write') await store.setKV('mock:demo', m.state);
    await wait(150);
    if (out && out.ok === false) throw new ServerError(out.error || 'Error del servidor', out.code || 'server');
    return out;
  }
  if (!cfg.url) throw new ServerError('Falta la dirección de conexión', 'config');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    // text/plain evita el "preflight" CORS, que Apps Script no responde.
    res = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token: cfg.token }), redirect: 'follow', cache: 'no-store', signal: ctl.signal });
  } catch (e) {
    const err = new NetworkError(e && e.name === 'AbortError' ? 'Tardó demasiado en responder' : 'Sin conexión');
    err.timeout = !!(e && e.name === 'AbortError');
    throw err;
  } finally { clearTimeout(t); }
  if (!res.ok) throw new ServerError(`El servidor respondió ${res.status}`, 'http');
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { throw new ServerError('La respuesta no es válida: revisá la dirección de conexión (tiene que terminar en /exec y estar implementada como aplicación web).', 'parse'); }
  if (json && json.ok === false) throw new ServerError(json.error || 'Error del servidor', json.code || 'server');
  return json;
}

const wireOp = (o) => (o.t === 'add' ? { id: o.id, t: 'add', rec: o.rec } : { id: o.id, t: 'edit', key: o.key, prev: o.prev, rec: o.rec });

export const api = {
  ping: (override) => call({ action: 'ping' }, 15000, override),
  read: () => call({ action: 'read' }, 40000),
  write: (ops) => call({ action: 'write', ops: ops.map(wireOp) }, 45000),
};
