import test from 'node:test'; import assert from 'node:assert/strict';
import { parseCardNote, cardNote, payMonthFor, dueDate, statements, openStatements, lastRealRate, fixedSuggestions, nextCuota, paymentPlan } from '../js/cards.js';
import { totals } from '../js/ledger.js';
import { convertAmount, centsToInput } from '../js/ledger.js';

const catalog = { accounts: [{ name: 'Banco', kind: 'Dinero disponible' }, { name: 'Naranja X', kind: 'Crédito', closeDay: 27, dueDay: 10 }, { name: 'Mercado Pago crédito', kind: 'Crédito' }] };
const cfg = { close: 27, due: 10 };
let n = 0;
const g = (x) => ({ id: 'id' + ++n, type: 'Gasto', account: 'Naranja X', currency: 'ARS', payment: 'Crédito', frequency: 'Variable', notes: '', ...x });
const usd = (oc, rate, x) => g({ currency: 'USD', originalCents: oc, exchangeRate: String(rate), cents: Math.round(oc * rate), ...x });

test('nota de la tarjeta: fecha de compra y cotización estimada, sin perder lo escrito', () => {
  const s = cardNote({ purchase: '2026-11-07', estimated: true, rest: 'regalo' });
  assert.equal(s, 'Compra 07/11/2026 · cotización estimada · regalo');
  assert.deepEqual(parseCardNote(s), { purchase: '2026-11-07', estimated: true, rest: 'regalo' });
  assert.deepEqual(parseCardNote('Compra 04/09/2026 · cuota 3 de 12'), { purchase: '2026-09-04', estimated: false, rest: 'cuota 3 de 12' });
  assert.deepEqual(parseCardNote(''), { purchase: null, estimated: false, rest: '' });
});

test('en qué resumen entra una compra (cierre 27, vence 10)', () => {
  assert.equal(payMonthFor('2026-11-07', cfg), '2026-12');
  assert.equal(payMonthFor('2026-11-27', cfg), '2026-12');
  assert.equal(payMonthFor('2026-11-28', cfg), '2027-01');
  assert.equal(payMonthFor('2026-12-30', cfg), '2027-02');
  assert.equal(payMonthFor('2026-11-10', { close: 5, due: 20 }), '2026-12'); // cierra el 5/12 y vence el 20/12
  assert.equal(dueDate('2026-12', cfg), '2026-12-10');
  assert.equal(dueDate('2027-02', { close: 27, due: 31 }), '2027-02-28');
});

test('resúmenes: agrupa por mes de pago y sabe cuáles están pagados', () => {
  const rows = [
    g({ date: '2026-11-11', cents: 1000, originalCents: 1000 }), usd(2000, 1585, { date: '2026-11-11', notes: 'Compra 21/10/2026' }),
    { type: 'Transferencia propia', account: 'Banco', destination: 'Naranja X', date: '2026-11-11', cents: 32700 },
    g({ date: '2026-12-10', cents: 500, originalCents: 500 }), usd(1000, 1585, { date: '2026-12-10', notes: 'Compra 07/11/2026 · cotización estimada' }),
    g({ account: 'Mercado Pago crédito', date: '2026-12-10', cents: 1710000, originalCents: 1710000 }),
  ];
  const all = statements(rows, catalog);
  assert.deepEqual(all.map((s) => [s.account, s.month, s.paid]), [['Naranja X', '2026-11', true], ['Mercado Pago crédito', '2026-12', false], ['Naranja X', '2026-12', false]]);
  const dic = all.find((s) => s.account === 'Naranja X' && s.month === '2026-12');
  assert.deepEqual([dic.ars, dic.usd, dic.usdArs, dic.total, dic.estimated, dic.due], [500, 1000, 1585000, 1585500, true, '2026-12-10']);
  assert.equal(openStatements(rows, catalog, '2026-11-25').length, 2);
  assert.equal(lastRealRate(rows), '1585');
});

test('gastos fijos: repite los del resumen anterior y avanza las cuotas', () => {
  assert.equal(nextCuota('Cuota 3/12 PS5'), 'Cuota 4/12 PS5');
  assert.equal(nextCuota('Cuota 12/12 PS5'), null);
  assert.equal(nextCuota('Spotify'), 'Spotify');
  const rows = [
    usd(494, 1585, { date: '2026-12-10', description: 'Spotify', frequency: 'Fijo', notes: 'Compra 28/10/2026 · cotización estimada' }),
    g({ date: '2026-12-10', description: 'Cuota 3/12 PS5', frequency: 'Fijo', cents: 14249992, originalCents: 14249992, notes: 'Compra 04/09/2026 · cuota 3 de 12' }),
    g({ date: '2026-12-10', description: 'Cuota 12/12 Heladera', frequency: 'Fijo', cents: 100, originalCents: 100 }),
    g({ date: '2026-12-10', description: 'Steam', frequency: 'Variable', cents: 100, originalCents: 100 }),
    usd(2000, 1585, { date: '2027-01-10', description: 'Spotify', frequency: 'Fijo' }), // ya cargado en enero
  ];
  const s = fixedSuggestions(rows, catalog, 'Naranja X', '2027-01');
  assert.deepEqual(s.map((x) => x.description), ['Cuota 4/12 PS5']);
  assert.equal(s[0].rest, 'cuota 4 de 12'); assert.equal(s[0].purchase, '2026-10-04');
  assert.equal(fixedSuggestions(rows.slice(0, 4), catalog, 'Naranja X', '2027-01').length, 2);
});

test('pagar el resumen de noviembre de Naranja X: cotización real y diferencia', () => {
  const st = { items: [g({ cents: 18215164, originalCents: 18215164 }), usd(5249, 1585, {})] };
  const rate = (oc) => convertAmount(centsToInput(oc), 'USD', '1450').cents;
  const p = paymentPlan(st, rate, 18215164 + 7611050 + 50000);
  assert.equal(p.items[1].cents, 7611050); // 52,49 × 1450
  assert.equal(p.itemsTotal, 25826214); assert.equal(p.extra, 50000);
});

test('caja: un pago a cualquier tarjeta baja el disponible, una compra con tarjeta no', () => {
  const t = totals([g({ date: '2026-12-10', cents: 1000 }), { type: 'Transferencia propia', destination: 'Naranja X', cents: 1000, date: '2026-12-10' }], '2026-12', ['Naranja X']);
  assert.deepEqual([t.expense, t.cash], [1000, -1000]);
});
