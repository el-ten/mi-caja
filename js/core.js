// Lógica del servidor de Mi Caja. Es la misma en tres lugares:
//  - Code.gs (Apps Script, pegado en la planilla): la arma tools/build.mjs a partir de este archivo;
//  - el simulador del modo demo (js/mock.js);
//  - las pruebas automáticas.
// Por eso no usa módulos del navegador ni de Apps Script: todo lo de afuera llega por "db".
//
// db = {
//   mov(): filas de 01_MOVIMIENTOS (A:R, sin encabezado; fechas como 'aaaa-mm-dd' o número de serie)
//   aju(): filas de 04_APP_AJUSTES (A:G, sin encabezado)
//   inicio(): fila INICIO de 05_APP_INICIO (A:G) o null
//   cuentas(), categorias(): filas de 06 y 07 (sin encabezado)
//   pagos(): lista de formas de pago (03_CONFIGURACION!E1:E7)
//   subcats(): lista de subcategorías (validación de 01_MOVIMIENTOS!F)
//   writeMov(index|null, fila), writeAju(index|null, fila): null = fila nueva al final de los datos
//   getProp(k), setProp(k, v): memoria chica del servidor (para no duplicar ajustes)
// }

const MC_TYPES = ['Gasto', 'Ingreso', 'Transferencia propia', 'Ajuste'];
const EDITABLE = MC_TYPES;
const CARD_NAME = 'Tarjeta de crédito';
const SERIE = 'PER-2609';
const SERIE_AJU = 'AJU-2609';
const UUID_RE = /^MC-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mismas fórmulas que ya tiene la planilla. Con punto y coma: es lo que pide la configuración regional de la planilla (es_ES).
const F_PERIODO = '=DATE(YEAR(INDIRECT("B"&ROW()));MONTH(INDIRECT("B"&ROW()));1)';
const F_IMPORTE = '=ROUND(IF(INDIRECT("I"&ROW())="USD";INDIRECT("J"&ROW())*INDIRECT("K"&ROW());INDIRECT("J"&ROW()));2)';

function coreText(v) { return v == null ? '' : String(v).trim(); }
function coreBool(v) { return v === true || /^(true|verdadero|sí|si|1)$/i.test(coreText(v)); }
function coreNum(v) {
  if (typeof v === 'number') return v;
  let s = coreText(v).replace(/[$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
function coreCents(v) { const n = coreNum(v); return Number.isFinite(n) ? Math.round(n * 100) : NaN; }

// Fechas: la planilla guarda números de serie (días desde 30/12/1899).
function coreSerial(iso) { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); }
function coreIso(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = coreText(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
function coreValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
  const d = new Date(iso + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === iso;
}

// ---------- catálogos ----------
function coreCatalog(db) {
  const accounts = db.cuentas().filter((r) => coreText(r[0]) && (r[2] === '' || r[2] == null || coreBool(r[2])))
    .map((r, i) => ({ name: coreText(r[0]), kind: coreText(r[1]), order: coreNum(r[3]) || 100 + i }))
    .sort((a, b) => a.order - b.order);
  const categories = db.categorias().filter((r) => coreText(r[0]) && (r[5] === '' || r[5] == null || coreBool(r[5])))
    .map((r, i) => ({ name: coreText(r[0]), type: coreText(r[1]) || 'Gasto', frequent: coreBool(r[2]), priority: coreText(r[3]), order: coreNum(r[4]) || 100 + i }))
    .sort((a, b) => a.order - b.order);
  const payments = db.pagos().map(coreText).filter(Boolean);
  const subcats = db.subcats().map(coreText).filter(Boolean);
  return { accounts, categories, payments, subcats };
}

// ---------- lectura ----------
function coreMovRecord(r, i) {
  const date = coreIso(r[1]);
  return {
    id: coreText(r[17]) || coreText(r[0]), displayId: coreText(r[0]), row: i + 2, sheet: 'mov',
    date, type: coreText(r[3]), category: coreText(r[4]), subcategory: coreText(r[5]), description: coreText(r[6]),
    account: coreText(r[7]), currency: coreText(r[8]) || 'ARS', originalCents: coreCents(r[9]),
    exchangeRate: coreText(r[10]) ? String(coreNum(r[10])) : null, cents: coreCents(r[11]),
    frequency: coreText(r[12]), priority: coreText(r[13]), payment: coreText(r[14]), notes: coreText(r[15]), destination: coreText(r[16]),
  };
}
function coreAjuRecord(r, i, uuids) {
  const id = coreText(r[0]);
  return {
    id: uuids[id] || id, displayId: id, row: i + 2, sheet: 'aju', date: coreIso(r[1]), type: 'Ajuste', account: coreText(r[2]), direction: coreText(r[3]),
    cents: coreCents(r[4]), originalCents: coreCents(r[4]), currency: 'ARS', exchangeRate: null, description: coreText(r[5]), notes: coreText(r[6]),
    category: '', subcategory: '', payment: '', frequency: '', priority: '', destination: '',
  };
}
function coreAjuUuids(db) { try { return JSON.parse(db.getProp('aju_uuids') || '{}'); } catch (e) { return {}; } }

function coreRead(db) {
  const avisos = [];
  const seen = new Set();
  const rows = [];
  db.mov().forEach((r, i) => {
    if (!coreText(r[0])) return;
    const rec = coreMovRecord(r, i);
    if (!rec.date || !Number.isFinite(rec.cents)) { avisos.push(`Fila ${i + 2} de 01_MOVIMIENTOS (${rec.displayId}): fecha o importe ilegible; no se muestra.`); return; }
    if (seen.has(rec.id)) { avisos.push(`El ID ${rec.id} está repetido en 01_MOVIMIENTOS (fila ${i + 2}); se muestra solo la primera.`); return; }
    seen.add(rec.id); rows.push(rec);
  });
  const ajuUuids = coreAjuUuidsById(db);
  db.aju().forEach((r, i) => {
    if (!coreText(r[0])) return;
    const rec = coreAjuRecord(r, i, ajuUuids);
    if (!rec.date || !Number.isFinite(rec.cents)) { avisos.push(`Fila ${i + 2} de 04_APP_AJUSTES: fecha o importe ilegible; no se muestra.`); return; }
    if (seen.has(rec.id)) { avisos.push(`El ID ${rec.id} está repetido en 04_APP_AJUSTES; se muestra solo la primera.`); return; }
    seen.add(rec.id); rows.push(rec);
  });
  const ini = db.inicio();
  let summary = null;
  if (ini && [ini[2], ini[3], ini[4]].every((v) => Number.isFinite(coreNum(v)))) {
    summary = { month: coreIso(ini[1]).slice(0, 7), cash: coreCents(ini[2]), income: coreCents(ini[3]), expense: coreCents(ini[4]), adjustments: coreCents(ini[5]) || 0, result: coreCents(ini[6]) || 0 };
  } else avisos.push('No se pudo leer el resumen de 05_APP_INICIO (fila INICIO).');
  return { ok: true, rows, summary, catalog: coreCatalog(db), avisos, serverTime: new Date().toISOString() };
}
// uuid -> id visible guardado por el servidor, invertido (id visible -> uuid)
function coreAjuUuidsById(db) { const m = coreAjuUuids(db), out = {}; for (const k in m) out[m[k]] = k; return out; }

// ---------- validación ----------
function coreNormalize(rec, cat, opts) {
  const isEdit = !!(opts && opts.edit);
  const fail = (m) => { throw new Error(m); };
  if (!rec || typeof rec !== 'object') fail('Registro vacío.');
  if (!MC_TYPES.includes(rec.type)) fail('Tipo de movimiento no admitido.');
  if (!isEdit && !UUID_RE.test(rec.id || '')) fail('ID interno inválido.');
  const accNames = cat.accounts.map((a) => a.name);
  const credit = cat.accounts.filter((a) => /cr[eé]dito/i.test(a.kind) || a.name === CARD_NAME).map((a) => a.name);
  const account = coreText(rec.account);
  if (!accNames.includes(account) && !(isEdit && account === coreText(opts.prev && opts.prev.account))) fail(`La cuenta "${account}" no está activa en 06_APP_CUENTAS.`);
  if (!coreValidDate(rec.date)) fail('Fecha inválida.');
  const currency = rec.type === 'Gasto' || rec.type === 'Ingreso' ? (rec.currency || 'ARS') : 'ARS';
  if (!['ARS', 'USD'].includes(currency)) fail('Moneda no admitida.');
  const originalCents = rec.originalCents;
  if (!Number.isSafeInteger(originalCents) || originalCents <= 0 || originalCents > 100000000000) fail('Importe inválido.');
  let cents = originalCents, exchangeRate = '';
  if (currency === 'USD') {
    const rate = Number(rec.exchangeRate);
    if (!(rate > 0) || !/^\d+(\.\d{1,6})?$/.test(String(rec.exchangeRate))) fail('Tipo de cambio inválido.');
    cents = Math.round(originalCents * rate);
    if (Math.abs(cents - rec.cents) > 1) fail('El importe convertido no coincide con el tipo de cambio.');
    exchangeRate = String(rate);
  }
  const s = (k, max) => { const v = coreText(rec[k]); if (v.length > (max || 240)) fail(`Texto demasiado largo en ${k}.`); return v; };
  const out = {
    id: rec.id, type: rec.type, date: rec.date, account, currency, originalCents, cents, exchangeRate,
    category: s('category'), subcategory: s('subcategory'), description: s('description'), notes: s('notes', 1000),
    payment: s('payment'), frequency: s('frequency'), priority: s('priority'), destination: s('destination'), direction: s('direction'),
  };
  if (out.type === 'Gasto' || out.type === 'Ingreso') {
    const cats = cat.categories.filter((c) => c.type === out.type || c.type === 'Ambos').map((c) => c.name);
    if (!cats.includes(out.category) && !(isEdit && out.category === coreText(opts.prev && opts.prev.category))) fail(`La categoría "${out.category}" no corresponde a ${out.type}.`);
    if (cat.payments.length && !cat.payments.includes(out.payment)) fail('Forma de pago inválida.');
    if (out.type === 'Gasto') {
      if (credit.includes(account) !== (out.payment === 'Crédito')) fail('Para una compra con tarjeta elegí la cuenta de la tarjeta y forma de pago Crédito.');
      if (!['Fijo', 'Variable'].includes(out.frequency)) fail('Elegí fijo o variable.');
    } else { out.frequency = ''; if (credit.includes(account)) fail('Un ingreso no puede entrar a la tarjeta de crédito.'); }
    if (out.priority && !['Necesario', 'Discrecional', 'No aplica'].includes(out.priority)) fail('Prioridad inválida.');
    out.destination = ''; out.direction = '';
  } else if (out.type === 'Transferencia propia') {
    if (credit.includes(account)) fail('La cuenta de origen no puede ser la tarjeta.');
    if (!accNames.includes(out.destination) || out.destination === account) fail('Elegí una cuenta destino distinta.');
    out.category = ''; out.subcategory = ''; out.frequency = ''; out.priority = 'No aplica'; out.payment = 'Transferencia'; out.direction = '';
  } else {
    if (!['Faltante', 'Sobrante'].includes(out.direction)) fail('Elegí faltante o sobrante.');
    out.category = ''; out.subcategory = ''; out.frequency = ''; out.priority = ''; out.payment = ''; out.destination = '';
  }
  return out;
}

function coreMovRow(m, displayId, uuid) {
  return [displayId, coreSerial(m.date), F_PERIODO, m.type, m.category, m.subcategory, m.description, m.account, m.currency,
    m.originalCents / 100, m.currency === 'USD' ? Number(m.exchangeRate) : '', F_IMPORTE, m.frequency, m.priority, m.payment, m.notes, m.destination, uuid];
}
function coreAjuRow(m, displayId) { return [displayId, coreSerial(m.date), m.account, m.direction, m.cents / 100, m.description, m.notes]; }

// Huella para comparar un registro de la planilla con lo que el celular cree que había (al corregir).
const FP_KEYS = ['type', 'date', 'account', 'currency', 'originalCents', 'exchangeRate', 'category', 'subcategory', 'description', 'notes', 'payment', 'frequency', 'priority', 'destination', 'direction'];
function coreFingerprint(r) { return JSON.stringify(FP_KEYS.map((k) => (k === 'originalCents' ? Number(r[k]) || 0 : coreText(r[k])))); }

function coreNextId(list, serie) {
  const re = new RegExp('^' + serie + '-(\\d+)$');
  let max = 0;
  for (const r of list) { const m = re.exec(coreText(r[0])); if (m) max = Math.max(max, Number(m[1])); }
  return serie + '-' + String(max + 1).padStart(3, '0');
}

// ---------- escritura ----------
// ops: [{ id, t: 'add', rec } | { id, t: 'edit', key, prev, rec }]
// Cada op tiene su propio resultado: un error en una no frena a las demás.
function coreWrite(db, ops) {
  const cat = coreCatalog(db);
  const results = [];
  for (const op of ops || []) {
    try {
      if (op.t === 'add') results.push(coreAdd(db, cat, op));
      else if (op.t === 'edit') results.push(coreEdit(db, cat, op));
      else throw new Error('Operación desconocida.');
    } catch (e) { results.push({ id: op.id, ok: false, error: String((e && e.message) || e) }); }
  }
  return { ok: true, results };
}

function coreAdd(db, cat, op) {
  const m = coreNormalize(op.rec, cat);
  if (m.type === 'Ajuste') {
    const map = coreAjuUuids(db);
    const aju = db.aju();
    const known = map[m.id] || (aju.some((r) => coreText(r[0]) === m.id) ? m.id : '');
    if (known) {
      // Ya estaba: si el celular lo corrigió antes de recibir la confirmación, se aplica la corrección.
      const i = aju.findIndex((r) => coreText(r[0]) === known);
      if (i >= 0 && coreFingerprint(coreAjuRecord(aju[i], i, {})) !== coreFingerprint(m)) db.writeAju(i, coreAjuRow(m, known));
      return { id: op.id, ok: true, assigned: known, repeated: true };
    }
    const displayId = coreNextId(aju, SERIE_AJU);
    db.writeAju(null, coreAjuRow(m, displayId));
    map[m.id] = displayId; db.setProp('aju_uuids', JSON.stringify(map));
    return { id: op.id, ok: true, assigned: displayId };
  }
  const mov = db.mov();
  // Sin duplicados: si el celular reenvía algo que ya entró (por ejemplo, se cortó la señal antes de la respuesta), no se carga de nuevo.
  const pi = mov.findIndex((r) => coreText(r[17]) === m.id || coreText(r[0]) === m.id);
  if (pi >= 0) {
    // Ya estaba: si el celular lo corrigió antes de recibir la confirmación, se aplica la corrección (mismo número).
    if (coreFingerprint(coreMovRecord(mov[pi], pi)) !== coreFingerprint(m)) db.writeMov(pi, coreMovRow(m, coreText(mov[pi][0]), m.id));
    return { id: op.id, ok: true, assigned: coreText(mov[pi][0]), repeated: true };
  }
  const displayId = coreNextId(mov, SERIE);
  db.writeMov(null, coreMovRow(m, displayId, m.id));
  return { id: op.id, ok: true, assigned: displayId };
}

function coreEdit(db, cat, op) {
  const key = coreText(op.key);
  if (!key) throw new Error('Falta el registro a corregir.');
  if (op.rec && op.rec.type === 'Ajuste') {
    const aju = db.aju(), ids = coreAjuUuids(db);
    const displayId = ids[key] || key;
    const i = aju.findIndex((r) => coreText(r[0]) === displayId);
    if (i < 0) throw new Error('Ese ajuste ya no está en la planilla.');
    const current = coreAjuRecord(aju[i], i, {});
    const m = coreNormalize({ ...op.rec, id: key }, cat, { edit: true, prev: current });
    if (coreFingerprint(current) === coreFingerprint(m)) return { id: op.id, ok: true, assigned: displayId, repeated: true };
    if (op.prev && coreFingerprint(current) !== coreFingerprint(op.prev)) throw new Error('Ese ajuste cambió en la planilla después de que lo abriste. Actualizá y corregilo de nuevo.');
    db.writeAju(i, coreAjuRow(m, displayId));
    return { id: op.id, ok: true, assigned: displayId };
  }
  const mov = db.mov();
  const i = mov.findIndex((r) => coreText(r[17]) === key || (!coreText(r[17]) && coreText(r[0]) === key) || coreText(r[0]) === key);
  if (i < 0) throw new Error('Ese movimiento ya no está en la planilla.');
  const current = coreMovRecord(mov[i], i);
  if (!EDITABLE.includes(current.type)) throw new Error(`Los movimientos de tipo ${current.type} se corrigen desde la planilla.`);
  if (op.rec.type !== current.type) throw new Error('No se puede cambiar el tipo de un movimiento ya cargado.');
  const m = coreNormalize({ ...op.rec, id: key }, cat, { edit: true, prev: current });
  if (coreFingerprint(current) === coreFingerprint(m)) return { id: op.id, ok: true, assigned: current.displayId, repeated: true };
  if (op.prev && coreFingerprint(current) !== coreFingerprint(op.prev)) throw new Error('Ese movimiento cambió en la planilla después de que lo abriste. Actualizá y corregilo de nuevo.');
  db.writeMov(i, coreMovRow(m, current.displayId, coreText(mov[i][17])));
  return { id: op.id, ok: true, assigned: current.displayId };
}

// ---------- entrada ----------
function coreHandle(db, body, token) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Pedido inválido.', code: 'bad' };
  if (!token || body.token !== token) return { ok: false, error: 'Clave incorrecta.', code: 'auth' };
  if (body.action === 'ping') return { ok: true, app: 'mi-caja', serverTime: new Date().toISOString() };
  if (body.action === 'read') return coreRead(db);
  if (body.action === 'write') { if (!Array.isArray(body.ops) || body.ops.length > 100) return { ok: false, error: 'Lote inválido.', code: 'bad' }; return coreWrite(db, body.ops); }
  return { ok: false, error: 'Acción desconocida.', code: 'bad' };
}

/* EXPORTS:BEGIN */
export { coreHandle, coreRead, coreWrite, coreNormalize, coreCatalog, coreFingerprint, coreSerial, coreIso, coreMovRow, coreNextId, F_PERIODO, F_IMPORTE, SERIE, SERIE_AJU, CARD_NAME };
/* EXPORTS:END */
