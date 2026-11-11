// Simulador de la planilla para el modo demo y las pruebas. Usa la MISMA lógica del servidor real (core.js)
// e imita las fórmulas de la planilla (período, importe ARS y el resumen de 05_APP_INICIO).
import { coreHandle, coreIso, F_PERIODO, F_IMPORTE } from './core.js';

export const DEMO_TOKEN = 'demo';

const CUENTAS = [['Banco', 'Dinero disponible', true, 1], ['Efectivo', 'Dinero disponible', true, 2], ['Mercado Pago', 'Dinero disponible', true, 3], ['Tarjeta de crédito', 'Crédito', true, 4], ['USD efectivo', 'Moneda extranjera', true, 5], ['Otra', 'Sin especificar', true, 6]];
const CATS = [['Trabajo', 'Ingreso', false, 'No aplica'], ['Alimentación', 'Gasto', true, 'Necesario'], ['Supermercado', 'Gasto', true, 'Necesario'], ['Almacen', 'Gasto', false, 'Necesario'], ['Kiosco', 'Gasto', false, 'Discrecional'], ['Salidas / ocio', 'Gasto', true, 'Discrecional'], ['Transporte', 'Gasto', false, 'Necesario'], ['Combustible', 'Gasto', true, 'Necesario'], ['Auto / moto', 'Gasto', false, 'Necesario'], ['Hogar', 'Gasto', false, 'Necesario'], ['Servicios', 'Gasto', false, 'Necesario'], ['Impuestos', 'Gasto', false, 'Necesario'], ['Salud', 'Gasto', false, 'Necesario'], ['Ropa', 'Gasto', false, 'Discrecional'], ['Tecnología', 'Ambos', false, 'Discrecional'], ['Suscripciones', 'Gasto', false, 'Discrecional'], ['Educación', 'Gasto', false, 'Necesario'], ['Regalos', 'Gasto', false, 'Discrecional'], ['Viajes', 'Gasto', false, 'Discrecional'], ['Compras personales', 'Gasto', false, 'Discrecional'], ['Cuotas / financiación', 'Gasto', false, 'Necesario'], ['Mascotas / animales', 'Gasto', false, 'Necesario'], ['Gastos bancarios', 'Gasto', false, 'Necesario'], ['Alquiler de cochera', 'Gasto', false, 'Necesario'], ['Otros gastos', 'Gasto', false, 'No aplica'], ['Otros ingresos', 'Ingreso', false, 'No aplica']]
  .map((r, i) => [...r, i + 1, true]);
const PAGOS = ['Débito', 'Crédito', 'Transferencia', 'Efectivo', 'QR', 'Débito automático', 'Otro'];
const SUBCATS = ['Trabajo rural / Sueldo', 'Almuerzo', 'Delivery', 'Combustible', 'Juegos', 'Spotify', 'Bar', 'Trabajo', 'Ingresos extra', 'Servicios', 'Venta', 'Intereses / rendimientos', 'Inversiones', 'Regalo / devolución', 'Otros ingresos', 'Alimento', 'Comisiones / mantenimiento', 'Banco', 'Efectivo', 'Estacionamiento', 'Plataformas de peliculas', 'iCloud', 'Mantenimiento', 'Agua mineral', 'Carniceria', 'Verduleria', 'Panaderia'];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n, now) => { const d = new Date(now); d.setDate(d.getDate() - n); return iso(d); };

// Datos de ejemplo (inventados) para probar la app sin tocar la planilla real.
export function demoSeed(now = new Date()) {
  const m = [];
  let n = 0;
  const add = (ago, type, cat, sub, desc, acc, amount, freq, prio, pay, extra = {}) => {
    n++;
    m.push([`PER-2609-${String(n).padStart(3, '0')}`, daysAgo(ago, now), '', type, cat, sub, desc, acc, extra.cur || 'ARS', amount, extra.rate || '', '', freq, prio, pay, extra.notes || '', extra.dest || '', '']);
  };
  add(60, 'Saldo inicial', 'Saldo inicial', 'Banco', 'Saldo inicial (ejemplo)', 'Banco', 150000, '', 'No aplica', 'Otro');
  add(60, 'Saldo inicial', 'Saldo inicial', 'Efectivo', 'Saldo inicial (ejemplo)', 'Efectivo', 40000, '', 'No aplica', 'Otro');
  add(40, 'Ingreso', 'Trabajo', 'Trabajo rural / Sueldo', 'Sueldo (ejemplo)', 'Banco', 400000, '', 'No aplica', 'Transferencia');
  add(35, 'Gasto', 'Supermercado', '', 'Súper (ejemplo)', 'Banco', 52300.5, 'Variable', 'Necesario', 'Débito');
  add(12, 'Ingreso', 'Trabajo', 'Trabajo rural / Sueldo', 'Sueldo (ejemplo)', 'Banco', 400000, '', 'No aplica', 'Transferencia');
  add(9, 'Gasto', 'Combustible', 'Combustible', 'Nafta (ejemplo)', 'Banco', 35000, 'Variable', 'Necesario', 'Débito');
  add(6, 'Gasto', 'Alimentación', 'Panaderia', 'Panadería (ejemplo)', 'Efectivo', 2400, 'Variable', 'Necesario', 'Efectivo');
  add(4, 'Gasto', 'Suscripciones', 'Spotify', 'Spotify (ejemplo)', 'Tarjeta de crédito', 4.99, 'Fijo', 'Discrecional', 'Crédito', { cur: 'USD', rate: 1500 });
  add(3, 'Gasto', 'Salidas / ocio', 'Bar', 'Salida con amigos (ejemplo)', 'Mercado Pago', 18000, 'Variable', 'Discrecional', 'QR');
  add(1, 'Gasto', 'Mascotas / animales', 'Alimento', 'Alimento gato (ejemplo)', 'Banco', 8800, 'Variable', 'Necesario', 'Débito');
  return { mov: m, aju: [], props: {} };
}

function evalMov(r) {
  const out = r.slice();
  if (typeof out[1] === 'number') out[1] = coreIso(out[1]);
  out[2] = out[1] ? out[1].slice(0, 8) + '01' : '';
  const j = Number(out[9]) || 0, k = Number(out[10]) || 0;
  out[11] = Math.round((out[8] === 'USD' ? j * k : j) * 100) / 100;
  return out;
}

export function createMock(state, { now = () => new Date() } = {}) {
  state.mov = state.mov.map(evalMov);
  const db = {
    mov: () => state.mov,
    aju: () => state.aju,
    inicio: () => {
      const month = iso(now()).slice(0, 7);
      const sum = (rows, f) => rows.reduce((t, r) => t + (f(r) ? Number(r[11]) || 0 : 0), 0);
      const M = state.mov, A = state.aju;
      const isApp = (r) => /^MC-/.test(String(r[0])) || /^MC-/.test(String(r[17]));
      const ajSum = (dir, inMonth) => A.reduce((t, r) => t + (r[3] === dir && (!inMonth || String(r[1]).startsWith(month)) ? Number(r[4]) || 0 : 0), 0);
      const cash = sum(M, (r) => r[3] === 'Saldo inicial') + sum(M, (r) => r[3] === 'Ingreso') - sum(M, (r) => r[3] === 'Gasto') - sum(M, (r) => r[3] === 'Ahorro / inversión')
        + ajSum('Sobrante') - ajSum('Faltante')
        + sum(M, (r) => r[3] === 'Gasto' && isApp(r) && r[14] === 'Crédito')
        - sum(M, (r) => r[3] === 'Transferencia propia' && isApp(r) && r[16] === 'Tarjeta de crédito');
      const income = sum(M, (r) => r[3] === 'Ingreso' && String(r[1]).startsWith(month));
      const expense = sum(M, (r) => r[3] === 'Gasto' && String(r[1]).startsWith(month));
      const adj = ajSum('Sobrante', true) - ajSum('Faltante', true);
      return ['INICIO', month + '-01', cash, income, expense, adj, income - expense + adj];
    },
    cuentas: () => CUENTAS,
    categorias: () => CATS,
    pagos: () => PAGOS,
    subcats: () => SUBCATS,
    writeMov: (i, row) => {
      if (row[2] !== F_PERIODO || row[11] !== F_IMPORTE) throw new Error('Fila sin fórmulas');
      const r = evalMov(row);
      if (i == null) state.mov.push(r); else state.mov[i] = r;
    },
    writeAju: (i, row) => { const r = row.slice(); r[1] = coreIso(r[1]); if (i == null) state.aju.push(r); else state.aju[i] = r; },
    getProp: (k) => state.props[k] ?? null,
    setProp: (k, v) => { state.props[k] = v; },
  };
  return { state, handle: (body) => coreHandle(db, body, DEMO_TOKEN), db };
}
