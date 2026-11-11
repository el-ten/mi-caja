// Base local (IndexedDB): configuración, última copia de la planilla y cola de cambios pendientes.
// Todo lo que se carga queda primero acá; la cola se vacía sola cuando la planilla confirma cada cambio.

let db = null;
const mem = { kv: new Map(), outbox: new Map() }; // respaldo si IndexedDB no está disponible

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('sin IndexedDB'));
    const r = indexedDB.open('mi-caja-v2', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const req = (store, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  let out; try { out = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
  t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('No se guardó'));
});
const kvGet = (k) => (db ? req('kv', 'readonly', (s) => s.get(k)) : Promise.resolve(mem.kv.get(k)));
const kvSet = (k, v) => (db ? req('kv', 'readwrite', (s) => s.put(v, k)) : Promise.resolve(void mem.kv.set(k, v)));
const outAll = () => (db ? req('outbox', 'readonly', (s) => s.getAll()) : Promise.resolve([...mem.outbox.values()]));
const outPut = (op) => (db ? req('outbox', 'readwrite', (s) => s.put(op)) : Promise.resolve(void mem.outbox.set(op.id, op)));
const outDel = (id) => (db ? req('outbox', 'readwrite', (s) => s.delete(id)) : Promise.resolve(void mem.outbox.delete(id)));

let seq = 0;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));

export const store = {
  config: { mode: null, url: '', token: '' }, // mode: null | 'demo' | 'live'
  snapshot: null,   // { at, rows, summary, catalog, avisos }
  ops: [],          // cola de cambios de la modalidad actual
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
  sync: { state: 'idle', lastSync: null, error: null, offline: false },
  persistent: false,
  listeners: new Set(),

  async init() {
    try { db = await openDB(); this.persistent = true; } catch { db = null; }
    const cfg = await kvGet('config');
    if (cfg) this.config = { ...this.config, ...cfg };
    await this.loadMode();
    // Pide al navegador que no borre los datos locales por falta de espacio.
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  },

  async loadMode() {
    const m = this.config.mode;
    this.snapshot = m ? (await kvGet(`snap:${m}`)) || null : null;
    this.ops = m ? (await outAll()).filter((o) => o.mode === m).sort((a, b) => a.seq - b.seq) : [];
    seq = this.ops.reduce((x, o) => Math.max(x, o.seq), 0);
    const meta = m ? await kvGet(`meta:${m}`) : null;
    this.sync.lastSync = meta ? meta.lastSync : null;
    this.sync.state = 'idle'; this.sync.error = null;
  },

  async setConfig(patch) {
    const changed = patch.mode !== undefined && patch.mode !== this.config.mode;
    this.config = { ...this.config, ...patch };
    await kvSet('config', this.config);
    if (changed) await this.loadMode();
    this.emit();
  },

  async saveSnapshot(snap) {
    this.snapshot = snap;
    this.sync.lastSync = new Date().toISOString();
    if (this.config.mode) { await kvSet(`snap:${this.config.mode}`, snap); await kvSet(`meta:${this.config.mode}`, { lastSync: this.sync.lastSync }); }
    this.emit();
  },
  async touchSync() {
    this.sync.lastSync = new Date().toISOString();
    if (this.config.mode) await kvSet(`meta:${this.config.mode}`, { lastSync: this.sync.lastSync });
  },

  // Agrega un cambio a la cola. op: { t: 'add', rec } | { t: 'edit', key, prev, rec }
  async enqueue(spec) {
    const op = { id: `op-${Date.now().toString(36)}-${uid().slice(0, 8)}`, seq: ++seq, mode: this.config.mode, ts: new Date().toISOString(), ...spec };
    await outPut(op);
    this.ops.push(op);
    this.emit();
    if (this.afterEnqueue) this.afterEnqueue();
    return op;
  },
  // Corrige un cambio que todavía no subió (mismo ID interno: si ya hubiera subido, no se duplica).
  async replaceOp(id, patch) {
    const op = this.ops.find((o) => o.id === id);
    if (!op) throw new Error('Ese pendiente ya se envió. Actualizá y corregilo desde Movimientos.');
    Object.assign(op, patch, { failed: false, error: '' });
    await outPut(op);
    this.emit();
    if (this.afterEnqueue) this.afterEnqueue();
  },
  async removeOps(ids) {
    const set = new Set(ids);
    for (const id of ids) await outDel(id);
    this.ops = this.ops.filter((o) => !set.has(o.id));
  },
  markSent(id, assigned) { const op = this.ops.find((o) => o.id === id); if (op) { op.sent = true; op.assigned = assigned || op.assigned; } },
  async markFailed(id, error) {
    const op = this.ops.find((o) => o.id === id);
    if (!op) return;
    op.failed = true; op.error = error;
    await outPut(op);
  },
  async retryFailed() {
    for (const op of this.ops) if (op.failed) { op.failed = false; op.error = ''; await outPut(op); }
    this.emit();
  },
  async discard(id) { await this.removeOps([id]); this.emit(); },

  pending() { return this.ops.filter((o) => !o.failed).length; },
  failed() { return this.ops.filter((o) => o.failed); },
  newUuid() { return 'MC-' + uid(); },

  getKV: kvGet, setKV: kvSet,
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } },
};
