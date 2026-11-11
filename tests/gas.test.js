// Prueba el adaptador de Apps Script (gas/Code.gs) con una planilla falsa que imita a la real:
// fechas como Date, filas de abajo con formato pero vacías, fórmulas guardadas como texto "=…".
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import vm from 'node:vm';

const AR = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 3)); // medianoche en Argentina
function fakeSheet(rows, maxRows = 1000) {
  const data = rows.map((r) => r.slice());
  const lastRow = () => { for (let i = data.length - 1; i >= 0; i--) if ((data[i] || []).some((v) => v !== '' && v != null)) return i + 1; return 0; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (data[r - 1 + i] || [])[c - 1 + j]; return v == null ? '' : v; })),
    setValues: (vals) => vals.forEach((row, i) => row.forEach((v, j) => { data[r - 1 + i] = data[r - 1 + i] || []; data[r - 1 + i][c - 1 + j] = v; })),
    setNumberFormat: () => {},
    getDataValidation: () => ({ getCriteriaValues: () => [['Panaderia', 'Spotify']] }),
  });
  return {
    data, getLastRow: lastRow, getMaxRows: () => maxRows, insertRowsAfter: (_, n) => { maxRows += n; },
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') { const m = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(a); const col = m[1].charCodeAt(0) - 64; const r1 = +m[2]; const r2 = m[4] ? +m[4] : r1; return range(r1, col, r2 - r1 + 1, 1); }
      return range(a, b, c, d);
    },
  };
}
function load(sheets) {
  const props = {};
  const ctx = {
    console: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/Argentina/Buenos_Aires', getSheetByName: (n) => sheets[n] || null }), flush: () => {} },
    Utilities: { formatDate: (d) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10), getUuid: () => '0123456789abcdef0123456789abcdef' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8'), ctx);
  ctx.configurar();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token: props.MC_TOKEN, ...body }) } }).s);
  return { ctx, props, post };
}
const H = ['h'];
function book() {
  const mov = fakeSheet([
    H,
    ['PER-2609-001', AR(2026, 9, 1), AR(2026, 9, 1), 'Saldo inicial', 'Saldo inicial', 'Banco', 'Saldo', 'Banco', 'ARS', 130780.28, '', 130780.28, '', 'No aplica', 'Otro', '', '', ''],
    ['PER-2609-173', AR(2026, 11, 11), AR(2026, 11, 1), 'Transferencia propia', '', '', 'Pago de resumen', 'Banco', 'ARS', 275647.09, '', 275647.09, '', 'No aplica', 'Transferencia', '', 'Tarjeta de crédito', 'MC-616b219d-7f55-4a79-b624-096263458f83'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  return {
    '01_MOVIMIENTOS': mov,
    '03_CONFIGURACION': fakeSheet([['Tipo', 'Cat', 'x', 'Efectivo', 'Débito'], ['', '', '', '', 'Crédito'], ['', '', '', '', 'Transferencia'], ['', '', '', '', 'Efectivo'], ['', '', '', '', 'QR'], ['', '', '', '', 'Débito automático'], ['', '', '', '', 'Otro']]),
    '04_APP_AJUSTES': fakeSheet([['ID ajuste', 'Fecha', 'Cuenta', 'Sentido', 'Importe', 'Desc', 'Obs']]),
    '05_APP_INICIO': fakeSheet([['ID'], ['INICIO', AR(2026, 11, 1), 512922.49, 1060000, 705288.25, 0, 354711.75]]),
    '06_APP_CUENTAS': fakeSheet([['Cuenta'], ['Banco', 'Dinero disponible', true, 1], ['Efectivo', 'Dinero disponible', true, 2], ['Tarjeta de crédito', 'Crédito', true, 4], ['Vieja', 'x', false, 9]]),
    '07_APP_CATEGORIAS': fakeSheet([['Cat'], ['Trabajo', 'Ingreso', false, 'No aplica', 1, true], ['Supermercado', 'Gasto', true, 'Necesario', 3, true]]),
  };
}

test('Apps Script: lee la planilla real (fechas Date, filas vacías al final)', () => {
  const sheets = book(); const { post } = load(sheets);
  const r = post({ action: 'read' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[1].date, '2026-11-11'); assert.equal(r.rows[1].id, 'MC-616b219d-7f55-4a79-b624-096263458f83'); assert.equal(r.rows[1].displayId, 'PER-2609-173');
  assert.equal(r.rows[0].cents, 13078028);
  assert.deepEqual(r.summary, { month: '2026-11', cash: 51292249, income: 106000000, expense: 70528825, adjustments: 0, result: 35471175 });
  assert.deepEqual(r.catalog.accounts.map((a) => a.name), ['Banco', 'Efectivo', 'Tarjeta de crédito']);
  assert.deepEqual(r.catalog.payments, ['Débito', 'Crédito', 'Transferencia', 'Efectivo', 'QR', 'Débito automático', 'Otro']);
});

test('Apps Script: escribe en la primera fila libre con fórmulas en inglés y fecha como número', () => {
  const sheets = book(); const { post } = load(sheets);
  const rec = { id: 'MC-11111111-2222-4333-8444-555555555555', type: 'Gasto', date: '2026-11-11', account: 'Banco', currency: 'ARS', originalCents: 150050, cents: 150050, category: 'Supermercado', payment: 'Débito', frequency: 'Variable', priority: 'Necesario', description: 'Súper' };
  const w = post({ action: 'write', ops: [{ id: 'o1', t: 'add', rec }] });
  assert.equal(w.results[0].ok, true, w.results[0].error); assert.equal(w.results[0].assigned, 'PER-2609-174');
  const row = sheets['01_MOVIMIENTOS'].data[3];
  assert.equal(row[0], 'PER-2609-174'); assert.equal(row[1], 46337); assert.equal(row[9], 1500.5); assert.equal(row[17], rec.id);
  assert.equal(row[2], '=DATE(YEAR(INDIRECT("B"&ROW()));MONTH(INDIRECT("B"&ROW()));1)'); // idéntica a la de la planilla
  assert.equal(row[11], '=ROUND(IF(INDIRECT("I"&ROW())="USD";INDIRECT("J"&ROW())*INDIRECT("K"&ROW());INDIRECT("J"&ROW()));2)');
  // reenvío: no duplica
  const again = post({ action: 'write', ops: [{ id: 'o1', t: 'add', rec }] });
  assert.equal(again.results[0].repeated, true); assert.equal(sheets['01_MOVIMIENTOS'].getLastRow(), 4);
  // un ajuste
  const a = post({ action: 'write', ops: [{ id: 'o2', t: 'add', rec: { id: 'MC-11111111-2222-4333-8444-666666666666', type: 'Ajuste', date: '2026-11-11', account: 'Efectivo', direction: 'Faltante', currency: 'ARS', originalCents: 720000, cents: 720000 } }] });
  assert.equal(a.results[0].assigned, 'AJU-2609-001'); assert.equal(sheets['04_APP_AJUSTES'].data[1][4], 7200);
});

test('Apps Script: clave incorrecta y sin configurar', () => {
  const { ctx, props } = load(book());
  assert.equal(JSON.parse(ctx.doPost({ postData: { contents: '{"action":"read","token":"x"}' } }).s).code, 'auth');
  delete props.MC_TOKEN;
  assert.equal(JSON.parse(ctx.doPost({ postData: { contents: '{"action":"read"}' } }).s).code, 'config');
});
