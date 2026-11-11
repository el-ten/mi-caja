// Arma lo que se ve en pantalla: la última copia de la planilla + los cambios que todavía no subieron.
import { totals } from './ledger.js';

export const DEFAULT_CATALOG = {
  accounts: [{ name: 'Banco', kind: 'Dinero disponible' }, { name: 'Efectivo', kind: 'Dinero disponible' }, { name: 'Mercado Pago', kind: 'Dinero disponible' }, { name: 'Tarjeta de crédito', kind: 'Crédito' }, { name: 'Otra', kind: 'Sin especificar' }],
  categories: [{ name: 'Supermercado', type: 'Gasto', priority: 'Necesario' }, { name: 'Alimentación', type: 'Gasto', priority: 'Necesario' }, { name: 'Otros gastos', type: 'Gasto', priority: 'No aplica' }, { name: 'Trabajo', type: 'Ingreso', priority: 'No aplica' }, { name: 'Otros ingresos', type: 'Ingreso', priority: 'No aplica' }],
  payments: ['Débito', 'Crédito', 'Transferencia', 'Efectivo', 'QR', 'Débito automático', 'Otro'],
  subcats: [],
};

export const EDITABLE_TYPES = ['Gasto', 'Ingreso', 'Transferencia propia', 'Ajuste'];

export function buildBook(snapshot, ops) {
  const synced = (snapshot && snapshot.rows) || [];
  const byId = new Map(synced.map((r) => [r.id, { ...r, status: 'synced' }]));
  const added = [], edits = [];
  for (const op of ops) {
    const status = op.failed ? 'failed' : 'pending';
    if (op.t === 'add') {
      if (byId.has(op.rec.id)) { byId.set(op.rec.id, { ...byId.get(op.rec.id), ...op.rec, status, opId: op.id, error: op.error }); continue; }
      added.push({ ...op.rec, displayId: op.assigned || '', status, opId: op.id, error: op.error });
    } else if (op.t === 'edit') {
      const orig = byId.get(op.key);
      const rec = { ...(orig || {}), ...op.rec, id: op.key, displayId: orig ? orig.displayId : op.key, status, opId: op.id, error: op.error, editOf: orig || op.prev };
      byId.set(op.key, rec);
      if (!op.failed) edits.push({ before: orig || op.prev, after: rec });
    }
  }
  const rows = [...byId.values(), ...added].sort((a, b) => (b.date || '').localeCompare(a.date || '') || order(b) - order(a));
  const catalog = (snapshot && snapshot.catalog && snapshot.catalog.accounts && snapshot.catalog.accounts.length) ? snapshot.catalog : DEFAULT_CATALOG;
  return { rows, catalog, summary: snapshot ? snapshot.summary : null, pendingAdds: added.filter((r) => r.status === 'pending'), edits };
}
// Dentro del mismo día: los pendientes arriba, después por número de fila de la planilla.
function order(r) { return r.status !== 'synced' && !r.row ? 1e9 : r.row || 0; }

// Resumen del mes: el de la planilla (05_APP_INICIO) más lo que todavía no subió.
export function monthSummary(book, month) {
  const s = book.summary;
  const extra = totals(book.pendingAdds, month);
  const after = totals(book.edits.map((e) => e.after), month), before = totals(book.edits.map((e) => e.before).filter(Boolean), month);
  const delta = (k) => extra[k] + after[k] - before[k];
  const local = s && s.month === month ? null : totals(book.rows.filter((r) => r.status === 'synced'), month);
  const base = (k) => (local ? local[k] : s ? s[k] : 0);
  const income = base('income') + delta('income'), expense = base('expense') + delta('expense'), adjustments = base('adjustments') + delta('adjustments');
  return {
    known: !!s, estimated: book.pendingAdds.length > 0 || book.edits.length > 0,
    cash: s ? s.cash + delta('cash') : null,
    income, expense, adjustments, result: income - expense + adjustments,
  };
}

export function isCredit(catalog, account) {
  const a = catalog.accounts.find((x) => x.name === account);
  return account === 'Tarjeta de crédito' || !!(a && /cr[eé]dito/i.test(a.kind || ''));
}
