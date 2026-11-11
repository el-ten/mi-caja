// Sincronización (mismo motor que Don Enrique): sube la cola de cambios y baja la última copia de la planilla.
// Se dispara sola: al guardar, al volver la señal, al volver a la app y cada 20 s mientras haya pendientes.
import { store } from './store.js';
import { api, NetworkError, ServerError } from './api.js';

let running = null;
let timer = null;

const firma = (s) => (s ? JSON.stringify([s.rows, s.summary, s.catalog, s.avisos]) : '');
export function isSyncing() { return !!running; }

// En el iPhone el primer pedido al abrir la app a veces falla porque la conexión todavía no despertó.
// Si falla enseguida (no por demora) y el teléfono no dice que está sin red, se reintenta solo un par de veces.
export const reintentos = { esperas: [1500, 4000] };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function conReintentos(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const sinRed = typeof navigator !== 'undefined' && navigator.onLine === false;
      const ocupado = e instanceof ServerError && e.code === 'busy';
      if (!((e instanceof NetworkError && !e.timeout && !sinRed) || ocupado) || i >= reintentos.esperas.length) throw e;
      await dormir(reintentos.esperas[i]);
    }
  }
}

// quiet: de fondo; si no hay nada que subir y la planilla no cambió, no redibuja la pantalla.
// minAge: no repetir si se sincronizó hace menos de estos milisegundos y no hay pendientes.
export function sync({ quiet = false, minAge = 0 } = {}) {
  if (!store.config.mode) return Promise.resolve({ ok: false, skipped: 'sin configurar' });
  if (running) return running;
  if (minAge && !store.pending() && store.sync.state === 'idle' && store.sync.lastSync && Date.now() - new Date(store.sync.lastSync).getTime() < minAge) return Promise.resolve({ ok: true, skipped: 'reciente' });
  running = (async () => {
    const silent = quiet && !store.pending() && store.sync.state === 'idle' && store.online;
    if (!silent) { store.sync.state = 'syncing'; store.sync.error = null; store.emit(); }
    try {
      await conReintentos(async () => {
        // 1) subir cambios, en el orden en que se cargaron (de a 25 por pedido)
        // Lo confirmado se saca de la cola recién cuando la copia nueva de la planilla ya lo trae: así nunca
        // "desaparece" de la pantalla si se corta la señal entre el envío y la lectura (y reenviarlo no duplica).
        const ops = store.ops.filter((o) => !o.failed);
        const okIds = [];
        for (let i = 0; i < ops.length; i += 25) {
          const res = await api.write(ops.slice(i, i + 25));
          for (const r of res.results || []) {
            if (r.ok) { okIds.push(r.id); store.markSent(r.id, r.assigned); }
            else await store.markFailed(r.id, r.error || 'Error');
          }
        }
        // 2) bajar la planilla
        const raw = await api.read();
        const snap = { at: new Date().toISOString(), rows: raw.rows || [], summary: raw.summary, catalog: raw.catalog, avisos: raw.avisos || [] };
        await store.removeOps(okIds);
        if (silent && !okIds.length && firma(store.snapshot) === firma(snap)) await store.touchSync();
        else await store.saveSnapshot(snap);
      });
      store.sync.state = 'idle'; store.sync.offline = false; store.online = true;
      if (!silent) store.emit();
      return { ok: true };
    } catch (e) {
      if (silent && !(e instanceof NetworkError)) return { ok: false, error: String(e.message || e), silent: true };
      store.sync.state = 'error';
      store.sync.error = e instanceof NetworkError ? 'Sin conexión: lo cargado queda guardado en el celular y se envía solo.' : String(e.message || e);
      store.sync.offline = e instanceof NetworkError;
      if (e instanceof NetworkError) store.online = false;
      store.emit();
      return { ok: false, error: store.sync.error, offline: e instanceof NetworkError };
    } finally { running = null; }
  })();
  return running;
}

// Junta varios cambios seguidos en un solo envío.
// No se confía en navigator.onLine (en el iPhone a veces miente): se intenta y, si falla, queda "Sin señal".
export function syncSoon(ms = 600) { clearTimeout(timer); timer = setTimeout(() => { sync(); }, ms); }

export function startAutoSync() {
  store.afterEnqueue = () => syncSoon();
  window.addEventListener('online', () => { store.online = true; store.emit(); sync(); });
  window.addEventListener('offline', () => { store.online = false; store.emit(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync({ quiet: true, minAge: 60000 }); });
  window.addEventListener('pageshow', () => { sync({ quiet: true, minAge: 60000 }); });
  let last = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible' || running) return;
    const wait = store.pending() > 0 ? 20000 : 300000;
    if (Date.now() - last >= wait - 500) { last = Date.now(); sync({ quiet: true }); }
  }, 5000);
}
