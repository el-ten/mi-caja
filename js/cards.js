// Tarjetas de crédito: resúmenes, gastos fijos y pago del resumen.
// Criterio de caja: cada consumo con tarjeta va con la fecha en que se paga el resumen (así cuenta en ese mes).
// La fecha de compra y si la cotización del dólar es estimada quedan en Observaciones:
//   "Compra 07/11/2026 · cotización estimada · (lo que haya escrito la persona)"
// No depende del navegador: se usa en la app y en las pruebas.
import { isCredit } from './book.js';

const pad = (n) => String(n).padStart(2, '0');
const fdate = (s) => (s ? s.split('-').reverse().join('/') : '');
export const DEFAULT_CLOSE = 27, DEFAULT_DUE = 10;

export function parseCardNote(notes) {
  let purchase = null, estimated = false;
  const rest = [];
  for (const raw of String(notes || '').split(' · ')) {
    const p = raw.trim(); let m;
    if ((m = /^compra (\d{1,2})\/(\d{1,2})\/(\d{4})$/i.exec(p))) purchase = `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    else if (/^cotizaci[oó]n estimada$/i.test(p)) estimated = true;
    else if (p) rest.push(p);
  }
  return { purchase, estimated, rest: rest.join(' · ') };
}
export function cardNote({ purchase, estimated, rest }) {
  return [purchase ? `Compra ${fdate(purchase)}` : '', estimated ? 'cotización estimada' : '', (rest || '').trim()].filter(Boolean).join(' · ');
}

export function monthAdd(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export function cardConfig(catalog, account) {
  const a = (catalog.accounts || []).find((x) => x.name === account) || {};
  return { close: a.closeDay || DEFAULT_CLOSE, due: a.dueDay || DEFAULT_DUE };
}
// Mes en que se paga una compra: cierra este mes si se compró hasta el día de cierre; se paga en el vencimiento siguiente.
export function payMonthFor(purchaseIso, cfg) {
  const [y, m, d] = purchaseIso.split('-').map(Number);
  const closing = monthAdd(`${y}-${pad(m)}`, d <= cfg.close ? 0 : 1);
  return cfg.due > cfg.close ? closing : monthAdd(closing, 1);
}
export function dueDate(ym, cfg) { return `${ym}-${pad(Math.min(cfg.due, lastDay(ym)))}`; }

export function creditAccounts(catalog) { return (catalog.accounts || []).map((a) => a.name).filter((n) => isCredit(catalog, n)); }

// Resúmenes de cada tarjeta activa: los consumos agrupados por mes de pago.
// Un resumen está pagado si hay una transferencia hacia esa tarjeta en ese mismo mes.
export function statements(rows, catalog) {
  const out = [];
  for (const account of creditAccounts(catalog)) {
    const byMonth = new Map();
    for (const r of rows) if (r.type === 'Gasto' && r.account === account && r.date) {
      const k = r.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(r);
    }
    for (const [month, items] of byMonth) {
      const payments = rows.filter((t) => t.type === 'Transferencia propia' && t.destination === account && (t.date || '').startsWith(month));
      const ars = items.filter((r) => r.currency !== 'USD').reduce((t, r) => t + r.cents, 0);
      const usdItems = items.filter((r) => r.currency === 'USD');
      out.push({
        account, month, items, payments, paid: payments.length > 0,
        ars, usd: usdItems.reduce((t, r) => t + r.originalCents, 0), usdArs: usdItems.reduce((t, r) => t + r.cents, 0),
        total: items.reduce((t, r) => t + r.cents, 0), estimated: usdItems.some((r) => parseCardNote(r.notes).estimated),
        due: items.map((r) => r.date).sort()[0],
      });
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || a.account.localeCompare(b.account));
}
// Los que faltan pagar (de los últimos meses, para no arrastrar historia vieja).
export function openStatements(rows, catalog, todayIso) {
  const from = monthAdd(todayIso.slice(0, 7), -3);
  return statements(rows, catalog).filter((s) => !s.paid && s.month >= from);
}

// Última cotización real (de un consumo ya pagado o cargado a mano sin la marca de estimada).
export function lastRealRate(rows) {
  const r = rows.filter((x) => x.currency === 'USD' && x.exchangeRate && !parseCardNote(x.notes).estimated).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return r ? String(r.exchangeRate) : '';
}

const CUOTA_DESC = /(cuota\s*)(\d+)(\s*\/\s*)(\d+)/i, CUOTA_NOTE = /(cuota\s+)(\d+)(\s+de\s+)(\d+)/i;
const base = (s) => String(s || '').toLowerCase().replace(CUOTA_DESC, 'cuota').replace(/\s+/g, ' ').trim();
// Siguiente cuota: "Cuota 3/12 PS5" → "Cuota 4/12 PS5". null si ya era la última.
export function nextCuota(text) {
  const m = CUOTA_DESC.exec(text || '');
  if (!m) return text;
  const n = Number(m[2]) + 1, total = Number(m[4]);
  return n > total ? null : text.replace(CUOTA_DESC, `$1${n}$3${total}`);
}
function nextCuotaNote(text) { return String(text || '').replace(CUOTA_NOTE, (all, a, n, b, t) => (Number(n) + 1 > Number(t) ? all : `${a}${Number(n) + 1}${b}${t}`)); }
function shiftMonth(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number), ym = monthAdd(`${y}-${pad(m)}`, n);
  return `${ym}-${pad(Math.min(d, lastDay(ym)))}`;
}

// Gastos fijos del resumen anterior de esa tarjeta que todavía no están en el resumen elegido.
export function fixedSuggestions(rows, catalog, account, month) {
  const all = statements(rows, catalog).filter((s) => s.account === account);
  const prev = all.filter((s) => s.month < month).pop();
  if (!prev) return [];
  const cur = all.find((s) => s.month === month);
  const have = new Set((cur ? cur.items : []).map((r) => base(r.description)));
  const out = [];
  for (const r of prev.items) {
    if (r.frequency !== 'Fijo') continue;
    const description = nextCuota(r.description);
    if (description === null || have.has(base(description))) continue;
    const note = parseCardNote(r.notes);
    out.push({
      from: r.id, type: 'Gasto', account, category: r.category, subcategory: r.subcategory, description,
      currency: r.currency, originalCents: r.originalCents, cents: r.cents, exchangeRate: r.exchangeRate,
      frequency: 'Fijo', priority: r.priority, payment: 'Crédito',
      purchase: shiftMonth(note.purchase, 1), rest: description !== r.description ? nextCuotaNote(note.rest) : note.rest,
    });
  }
  return out;
}

// Cuánto se paga con la cotización real: los consumos en pesos + los dólares a esa cotización.
// Lo que falte hasta lo que realmente se pagó son impuestos, percepciones o cargos del resumen.
export function paymentPlan(st, rateCentsFn, paidCents) {
  const items = st.items.map((r) => ({ r, cents: r.currency === 'USD' ? rateCentsFn(r.originalCents) : r.cents }));
  const itemsTotal = items.reduce((t, x) => t + x.cents, 0);
  return { items, itemsTotal, extra: paidCents - itemsTotal };
}
