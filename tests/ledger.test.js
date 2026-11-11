import test from 'node:test'; import assert from 'node:assert/strict';
import { parseAmount, totals, convertAmount, suggestedCategories, subcategoriesFor } from '../js/ledger.js';
const r = (type, cents, extra = {}) => ({ type, cents, date: '2026-10-20', account: 'Banco', ...extra });

test('importes en centavos con escritura argentina', () => {
  assert.equal(parseAmount('1250,50'), 125050);
  assert.equal(parseAmount('0.01'), 1);
  assert.equal(parseAmount('15.000'), 1500000);
  assert.equal(parseAmount('1.000,50'), 100050);
  assert.equal(parseAmount('1.234.567,8'), 123456780);
  assert.equal(parseAmount('1, 5'), 150);
  for (const v of ['0', '-1', '1e5', 'NaN', '1,234', '1.23.4', '12.3456', '', '1.000.5']) assert.throws(() => parseAmount(v), v);
});
test('compra con tarjeta y pago del resumen no duplican gasto', () => {
  const t = totals([r('Gasto', 10000, { account: 'Tarjeta de crédito', payment: 'Crédito' }), r('Transferencia propia', 10000, { destination: 'Tarjeta de crédito' })], '2026-10');
  assert.equal(t.expense, 10000); assert.equal(t.cash, -10000); assert.equal(t.credit, 0);
});
test('ajustes y transferencias no son consumo', () => {
  const t = totals([r('Ajuste', 720000, { direction: 'Faltante' }), r('Transferencia propia', 50000, { destination: 'Efectivo' })], '2026-10');
  assert.equal(t.cash, -720000); assert.equal(t.expense, 0); assert.equal(t.income, 0);
});
test('totales del mes excluyen otros meses', () => {
  const t = totals([r('Gasto', 500, { date: '2026-09-30' }), r('Ingreso', 1000)], '2026-10');
  assert.equal(t.expense, 0); assert.equal(t.income, 1000); assert.equal(t.cash, 500);
});
test('USD conserva el original y convierte sin error binario', () => {
  assert.deepEqual(convertAmount('6,63', 'USD', '1563'), { originalCents: 663, cents: 1036269, exchangeRate: '1563' });
  assert.equal(convertAmount('0.01', 'USD', '1.5').cents, 2);
  assert.equal(convertAmount('20', 'USD', '1500,50').cents, 3001000);
  assert.equal(convertAmount('20', 'USD', '1.585').cents, 3170000);
  for (const v of ['', 0, -1, 'NaN', '1e3', '1.2.3']) assert.throws(() => convertAmount('10', 'USD', v));
  assert.equal(convertAmount('5', 'ARS', '').cents, 500);
});
test('sugerencias por uso reciente, no por importe', () => {
  const allowed = ['Supermercado', 'Alimentación', 'Combustible', 'Salidas / ocio', 'Salud', 'Ropa'];
  const rows = [r('Gasto', 1, { category: 'Salud' }), r('Gasto', 9999999, { category: 'Ropa', date: '2026-01-01' }), ...Array.from({ length: 5 }, () => r('Ingreso', 200, { category: 'Ropa' }))];
  assert.deepEqual(suggestedCategories(rows, allowed, '2026-10-20'), ['Salud', 'Ropa', 'Supermercado', 'Alimentación']);
});
test('subcategorías usadas con la categoría van primero', () => {
  const rows = [r('Gasto', 1, { category: 'Alimentación', subcategory: 'Panaderia' }), r('Gasto', 1, { category: 'Alimentación', subcategory: 'Carniceria' }), r('Gasto', 1, { category: 'Alimentación', subcategory: 'Carniceria' }), r('Gasto', 1, { category: 'Suscripciones', subcategory: 'Spotify' })];
  const s = subcategoriesFor(rows, 'Alimentación', ['Spotify', 'Panaderia', 'Carniceria', 'Bar']);
  assert.deepEqual(s.used, ['Carniceria', 'Panaderia']); assert.deepEqual(s.rest, ['Spotify', 'Bar']);
});
