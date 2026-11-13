// Cuentas de Mi Caja: importes en centavos enteros, conversión USD y totales.
// Se usa en el celular y en las pruebas; no depende del navegador.

// Saca espacios que mete el teclado de Android después de la coma o el punto.
export function normalizeDecimalInput(raw) { return String(raw ?? '').replace(/([,.])\s+/g, '$1'); }

// Da formato mientras se escribe: 1000 → 1.000 · 1250,5 → 1.250,5. Los puntos son solo de miles
// (se agregan solos); los decimales van con coma. maxDec: cuántos decimales se aceptan.
export function formatAmountInput(raw, maxDec = 2) {
  const s = String(raw ?? '').replace(/\s/g, '');
  if (!s) return '';
  const i = s.indexOf(',');
  let int = (i < 0 ? s : s.slice(0, i)).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const dec = i < 0 ? null : s.slice(i + 1).replace(/\D/g, '').slice(0, maxDec);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === null ? grouped : `${grouped || '0'},${dec}`;
}
// Posición del cursor después de dar formato: misma cantidad de cifras/comas antes del cursor.
export function caretAfterFormat(formatted, significantBefore) {
  if (significantBefore <= 0) return 0;
  let n = 0;
  for (let k = 0; k < formatted.length; k++) { if (formatted[k] !== '.') n++; if (n >= significantBefore) return k + 1; }
  return formatted.length;
}

// Acepta la forma argentina: 15000 · 15.000 · 1.250,50 · 1250,50 · 0.01
// El punto con grupos de 3 cifras es separador de miles; la coma siempre es decimal.
export function toPlainDecimal(raw) {
  let s = normalizeDecimalInput(raw).trim().replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    if (!/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) return null;
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    if (!/^\d+,\d{1,2}$/.test(s)) return null;
    s = s.replace(',', '.');
  } else if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else if (!/^\d+\.\d{1,2}$/.test(s)) return null;
  } else if (!/^\d+$/.test(s)) return null;
  return s;
}

export function parseAmount(raw) {
  const s = toPlainDecimal(raw);
  if (s == null) throw Error('Revisá el importe. Ejemplos válidos: 15000 · 15.000 · 1250,50');
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000) throw Error('Revisá el importe ingresado.');
  return cents;
}

export function convertAmount(raw, currency = 'ARS', rateRaw = '') {
  const originalCents = parseAmount(raw);
  if (currency === 'ARS') return { originalCents, cents: originalCents, exchangeRate: null };
  if (currency !== 'USD') throw Error('Moneda no admitida.');
  let rate = normalizeDecimalInput(rateRaw).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(rate)) rate = rate.replace(/\./g, '');
  rate = rate.replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(rate) || Number(rate) <= 0) throw Error('Ingresá un tipo de cambio positivo, con hasta 6 decimales.');
  const [whole, fraction = ''] = rate.split('.'), scale = 10n ** BigInt(fraction.length), scaled = BigInt(whole) * scale + BigInt(fraction || '0');
  const cents = Number((BigInt(originalCents) * scaled + scale / 2n) / scale);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000000000) throw Error('El equivalente en pesos queda fuera del rango admitido.');
  return { originalCents, cents, exchangeRate: String(Number(rate)) };
}

// Mismo criterio que las fórmulas de 05_APP_INICIO:
// - una compra con tarjeta de crédito es gasto, pero no baja el dinero disponible hasta pagar la tarjeta;
// - una transferencia propia hacia la tarjeta (el pago del resumen) baja el disponible sin sumar gasto.
export const CARD = 'Tarjeta de crédito';
export function totals(rows, month) {
  return rows.reduce((t, r) => {
    const inMonth = String(r.date || '').startsWith(month);
    if (r.type === 'Gasto') {
      if (inMonth) t.expense += r.cents;
      if (r.payment === 'Crédito' || r.account === CARD) t.credit += r.cents; else t.cash -= r.cents;
    } else if (r.type === 'Ingreso') {
      if (inMonth) t.income += r.cents; t.cash += r.cents;
    } else if (r.type === 'Saldo inicial') {
      t.cash += r.cents;
    } else if (r.type === 'Ahorro / inversión') {
      t.cash -= r.cents;
    } else if (r.type === 'Ajuste') {
      const n = r.direction === 'Faltante' ? -r.cents : r.cents; t.cash += n; if (inMonth) t.adjustments += n;
    } else if (r.type === 'Transferencia propia' && r.destination === CARD) {
      t.cash -= r.cents; t.credit -= r.cents;
    }
    return t;
  }, { income: 0, expense: 0, adjustments: 0, cash: 0, credit: 0 });
}

// Cuenta usos, no plata gastada. Los gastos recientes pesan más.
export function suggestedCategories(rows, allowed, today, limit = 4, defaults = ['Supermercado', 'Alimentación', 'Combustible', 'Salidas / ocio']) {
  const scores = new Map(), now = Date.parse(today + 'T12:00:00Z');
  for (const r of rows) {
    if (r.type !== 'Gasto' || !allowed.includes(r.category)) continue;
    const date = Date.parse(r.date + 'T12:00:00Z'); if (!Number.isFinite(date) || date > now) continue;
    const days = (now - date) / 86400000, weight = days <= 30 ? 4 : days <= 90 ? 2 : 1;
    const prev = scores.get(r.category) || { score: 0, latest: 0 };
    scores.set(r.category, { score: prev.score + weight, latest: Math.max(prev.latest, date) });
  }
  const ranked = [...scores.keys()].sort((a, b) => scores.get(b).score - scores.get(a).score || scores.get(b).latest - scores.get(a).latest || allowed.indexOf(a) - allowed.indexOf(b));
  return [...new Set([...ranked, ...defaults, ...allowed])].filter((c) => allowed.includes(c)).slice(0, limit);
}

// Subcategorías: primero las que ya usaste con esa categoría (más usadas arriba), después el resto de la lista.
export function subcategoriesFor(rows, category, all) {
  const n = new Map();
  for (const r of rows) if (r.category === category && r.subcategory) n.set(r.subcategory, (n.get(r.subcategory) || 0) + 1);
  const used = [...n.keys()].sort((a, b) => n.get(b) - n.get(a));
  return { used, rest: all.filter((s) => !n.has(s)) };
}

export function money(cents) { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100); }
export function centsToInput(cents) { return (cents / 100).toFixed(2).replace('.', ','); }
