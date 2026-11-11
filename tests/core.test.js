import test from 'node:test'; import assert from 'node:assert/strict';
import { createMock, demoSeed, DEMO_TOKEN } from '../js/mock.js';
import { convertAmount } from '../js/ledger.js';

const NOW = new Date('2026-11-11T12:00:00-03:00');
const mk = () => createMock(demoSeed(NOW), { now: () => NOW });
let n = 0;
const uuid = () => `MC-${String(++n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const gasto = (extra = {}) => ({ id: uuid(), type: 'Gasto', date: '2026-11-11', account: 'Banco', currency: 'ARS', originalCents: 150000, cents: 150000, exchangeRate: null, category: 'Supermercado', subcategory: '', description: 'Prueba', notes: '', payment: 'Débito', frequency: 'Variable', priority: 'Necesario', ...extra });
const write = (m, ops) => m.handle({ token: DEMO_TOKEN, action: 'write', ops });
const read = (m) => m.handle({ token: DEMO_TOKEN, action: 'read' });

test('clave obligatoria', () => {
  const m = mk();
  assert.equal(m.handle({ token: 'x', action: 'read' }).code, 'auth');
  assert.equal(m.handle({ action: 'ping' }).code, 'auth');
  assert.equal(m.handle({ token: DEMO_TOKEN, action: 'ping' }).ok, true);
});

test('alta con número legible correlativo y fórmulas', () => {
  const m = mk();
  const res = write(m, [{ id: 'op1', t: 'add', rec: gasto() }, { id: 'op2', t: 'add', rec: gasto() }]);
  assert.deepEqual(res.results.map((r) => r.assigned), ['PER-2609-011', 'PER-2609-012']);
  const last = m.state.mov.at(-1);
  assert.equal(last[2], '2026-11-01'); assert.equal(last[11], 1500); assert.match(last[17], /^MC-/);
});

test('reenviar lo mismo no duplica (señal cortada antes de la respuesta)', () => {
  const m = mk(); const rec = gasto();
  write(m, [{ id: 'a', t: 'add', rec }]);
  const again = write(m, [{ id: 'a', t: 'add', rec }]);
  assert.equal(again.results[0].ok, true); assert.equal(again.results[0].repeated, true);
  assert.equal(m.state.mov.filter((r) => r[17] === rec.id).length, 1);
});

test('un error no frena al resto del lote', () => {
  const m = mk();
  const res = write(m, [{ id: 'a', t: 'add', rec: gasto({ category: 'Inexistente' }) }, { id: 'b', t: 'add', rec: gasto() }]);
  assert.equal(res.results[0].ok, false); assert.match(res.results[0].error, /categoría/);
  assert.equal(res.results[1].ok, true);
});

test('tarjeta: compra no baja el disponible hasta pagar el resumen', () => {
  const m = mk(); const before = read(m).summary.cash;
  write(m, [{ id: 'a', t: 'add', rec: gasto({ account: 'Tarjeta de crédito', payment: 'Crédito' }) }]);
  assert.equal(read(m).summary.cash, before);
  assert.equal(read(m).summary.expense > 0, true);
  write(m, [{ id: 'b', t: 'add', rec: { id: uuid(), type: 'Transferencia propia', date: '2026-11-11', account: 'Banco', destination: 'Tarjeta de crédito', currency: 'ARS', originalCents: 150000, cents: 150000, description: 'Pago resumen' } }]);
  assert.equal(read(m).summary.cash, before - 150000);
  const bad = write(m, [{ id: 'c', t: 'add', rec: gasto({ account: 'Tarjeta de crédito', payment: 'Débito' }) }]);
  assert.equal(bad.results[0].ok, false);
});

test('USD: guarda original y cotización; el servidor controla la conversión', () => {
  const m = mk(); const c = convertAmount('20', 'USD', '1585');
  const ok = write(m, [{ id: 'a', t: 'add', rec: gasto({ currency: 'USD', ...c }) }]);
  assert.equal(ok.results[0].ok, true);
  const row = m.state.mov.at(-1); assert.equal(row[9], 20); assert.equal(row[10], 1585); assert.equal(row[11], 31700);
  const bad = write(m, [{ id: 'b', t: 'add', rec: gasto({ currency: 'USD', originalCents: 2000, cents: 10, exchangeRate: '1585' }) }]);
  assert.equal(bad.results[0].ok, false);
});

test('ajustes de caja: ID legible, sin duplicar, afectan el disponible', () => {
  const m = mk(); const before = read(m).summary.cash;
  const rec = { id: uuid(), type: 'Ajuste', date: '2026-11-11', account: 'Efectivo', direction: 'Faltante', currency: 'ARS', originalCents: 720000, cents: 720000, description: 'Arqueo' };
  const r1 = write(m, [{ id: 'a', t: 'add', rec }]); const r2 = write(m, [{ id: 'a', t: 'add', rec }]);
  assert.equal(r1.results[0].assigned, 'AJU-2609-001'); assert.equal(r2.results[0].repeated, true);
  assert.equal(m.state.aju.length, 1);
  const s = read(m); assert.equal(s.summary.cash, before - 720000); assert.equal(s.summary.adjustments, -720000);
  assert.equal(s.rows.find((x) => x.displayId === 'AJU-2609-001').id, rec.id);
});

test('corregir un movimiento ya enviado: cambia los campos y conserva ID y fórmulas', () => {
  const m = mk(); const rec = gasto();
  write(m, [{ id: 'a', t: 'add', rec }]);
  const cur = read(m).rows.find((r) => r.id === rec.id);
  const fixed = { ...cur, description: 'Corregido', originalCents: 200000, cents: 200000 };
  const res = write(m, [{ id: 'e', t: 'edit', key: rec.id, prev: cur, rec: fixed }]);
  assert.equal(res.results[0].ok, true, res.results[0].error);
  const row = m.state.mov.find((r) => r[17] === rec.id);
  assert.equal(row[6], 'Corregido'); assert.equal(row[11], 2000); assert.equal(row[0], cur.displayId);
  // la misma corrección repetida no rompe nada
  assert.equal(write(m, [{ id: 'e', t: 'edit', key: rec.id, prev: cur, rec: fixed }]).results[0].ok, true);
  // si en la planilla cambió entre medio, no se pisa
  const stale = write(m, [{ id: 'f', t: 'edit', key: rec.id, prev: cur, rec: { ...cur, description: 'Otra' } }]);
  assert.equal(stale.results[0].ok, false); assert.match(stale.results[0].error, /cambió en la planilla/);
});

test('corregir un movimiento histórico (sin ID interno) por su número', () => {
  const m = mk(); const cur = read(m).rows.find((r) => r.displayId === 'PER-2609-006');
  const res = write(m, [{ id: 'e', t: 'edit', key: cur.id, prev: cur, rec: { ...cur, description: 'Nafta YPF' } }]);
  assert.equal(res.results[0].ok, true, res.results[0].error);
  assert.equal(m.state.mov[5][6], 'Nafta YPF');
  const si = read(m).rows.find((r) => r.type === 'Saldo inicial');
  assert.equal(write(m, [{ id: 'x', t: 'edit', key: si.id, prev: si, rec: { ...si, description: 'x' } }]).results[0].ok, false);
});

test('una fila rota en la planilla no impide leer el resto', () => {
  const m = mk(); m.state.mov[3][11] = 'abc'; m.state.mov.push([...m.state.mov[4]]);
  const s = read(m);
  assert.equal(s.ok, true); assert.equal(s.avisos.length, 2);
  assert.equal(s.rows.length, m.state.mov.length - 2);
});

test('la numeración sigue después del último número aunque haya huecos', () => {
  const m = mk(); m.state.mov.at(-1)[0] = 'PER-2609-173';
  assert.equal(write(m, [{ id: 'a', t: 'add', rec: gasto() }]).results[0].assigned, 'PER-2609-174');
});

test('catálogos salen de la planilla (cuentas activas y categorías por tipo)', () => {
  const s = read(mk());
  assert.deepEqual(s.catalog.accounts.map((a) => a.name), ['Banco', 'Efectivo', 'Mercado Pago', 'Tarjeta de crédito', 'USD efectivo', 'Otra']);
  assert.equal(s.catalog.categories.find((c) => c.name === 'Tecnología').type, 'Ambos');
  assert.equal(s.catalog.subcats.length, 27);
});

test('un pendiente corregido antes de recibir la confirmación se actualiza, no se duplica', () => {
  const m = mk(); const rec = gasto();
  write(m, [{ id: 'a', t: 'add', rec }]);
  const r = write(m, [{ id: 'a', t: 'add', rec: { ...rec, description: 'Corregido', originalCents: 99900, cents: 99900 } }]);
  assert.equal(r.results[0].repeated, true);
  const rows = m.state.mov.filter((x) => x[17] === rec.id);
  assert.equal(rows.length, 1); assert.equal(rows[0][6], 'Corregido'); assert.equal(rows[0][11], 999);
});
