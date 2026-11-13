// Mi Caja: pantallas, carga de movimientos y ajustes. Mismo diseño y motor de sincronización que Don Enrique.
import { store } from './store.js';
import { sync, startAutoSync, isSyncing } from './sync.js';
import { api, ServerError, resetDemo } from './api.js';
import { buildBook, monthSummary, isCredit, EDITABLE_TYPES } from './book.js';
import { formatAmountInput, caretAfterFormat, convertAmount, suggestedCategories, subcategoriesFor, money, centsToInput } from './ledger.js';
import { makeCode, parseCode, validUrl } from './connect.js';
import { icon } from './icons.js';
import { VERSION, VERSION_FECHA } from './version.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fdate = (s) => (s ? s.split('-').reverse().join('/') : '');
const shortDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MES3[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; };
const monthName = (ym) => { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1]} ${y}`; };
// Montos cortos para los recuadros del inicio: $ 71.685 · $ 1,06 M
const money0 = (c) => Math.abs(c) >= 100000000 ? `${c < 0 ? '−' : ''}$ ${(Math.abs(c) / 100000000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M` : `${c < 0 ? '−' : ''}$ ${Math.round(Math.abs(c) / 100).toLocaleString('es-AR')}`;
const opts = (list, value) => list.map((v) => `<option ${v === value ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');
function dayLabel(s) {
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (s === iso(t)) return 'Hoy'; if (s === iso(y)) return 'Ayer';
  const [yy, m, d] = s.split('-').map(Number); const dt = new Date(yy, m - 1, d);
  return `${DIAS[dt.getDay()][0].toUpperCase() + DIAS[dt.getDay()].slice(1)} ${d} de ${MESES[m - 1]}${yy !== t.getFullYear() ? ' de ' + yy : ''}`;
}

// La moneda del logo (misma forma en el logo, el panel de inicio y la bienvenida). El signo $ está centrado en la moneda.
const S_PATH = 'M286.6 154.6 C279.4 143.8 268.6 138.4 256 138.4 C236.2 138.4 221.8 149.2 221.8 165.4 C221.8 183.4 238 190.6 256 196 C274 201.4 290.2 208.6 290.2 226.6 C290.2 242.8 275.8 253.6 256 253.6 C243.4 253.6 232.6 248.2 225.4 237.4 M256 118.6V138.4M256 253.6V273.4';
function coinShape(id, cx, cy, r) {
  const k = r / 104, t = `translate(${cx - 256 * k} ${cy - 196 * k}) scale(${k})`;
  return `<defs><linearGradient id="${id}-coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f9d77c"/><stop offset="1" stop-color="#e3921d"/></linearGradient></defs>` +
    `<g transform="${t}"><circle cx="256" cy="196" r="104" fill="url(#${id}-coin)"/><circle cx="256" cy="196" r="84" fill="none" stroke="#b8730f" stroke-width="8" opacity=".5"/>` +
    `<path d="${S_PATH}" fill="none" stroke="#8a5207" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}
const coinArt = (id) => `<svg viewBox="140 80 232 232" aria-hidden="true">${coinShape(id, 256, 196, 104)}</svg>`;

const logoSvg = (id, size) => '<svg viewBox="0 0 512 512" width="' + size + '" height="' + size + '" aria-hidden="true"><defs><linearGradient id="' + id + '-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b6a4d"/><stop offset="1" stop-color="#0b3022"/></linearGradient><linearGradient id="' + id + '-box" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6efdc"/><stop offset="1" stop-color="#e2d6b8"/></linearGradient><clipPath id="' + id + '-c"><rect width="512" height="512" rx="112"/></clipPath></defs><g clip-path="url(#' + id + '-c)"><rect width="512" height="512" fill="url(#' + id + '-bg)"/><g transform="translate(0 -14)">' + coinShape(id, 256, 196, 104) + '<rect x="104" y="326" width="304" height="124" rx="30" fill="url(#' + id + '-box)"/><rect x="186" y="350" width="140" height="22" rx="11" fill="#0f3d2c"/></g></g></svg>';

let book = buildBook(null, []);
let page = 'home', mode = 'Gasto', draft = {}, editing = null, detailId = null, connectOpen = false;
let filters = { month: '', type: 'Todos', cat: '', q: '' }, showCount = 120, historyY = 0;
let pendingRender = false, busy = false, swWaiting = null, swReady = false;

// ---------- utilidades ----------
let toastTimer;
function toast(msg, tone = '', ms = tone === 'ok' ? 1800 : 3500) { const t = $('#toast'); t.textContent = msg; t.className = `toast show ${tone ? 'toast-' + tone : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
function ago(s) {
  if (!s) return 'todavía no';
  const x = Math.max(0, (Date.now() - new Date(s).getTime()) / 1000);
  if (x < 45) return 'recién'; if (x < 3600) return `hace ${Math.round(x / 60)} min`; if (x < 86400) return `hace ${Math.round(x / 3600)} h`;
  return `hace ${Math.round(x / 86400)} días`;
}
const isIn = (r) => r.type === 'Ingreso' || r.type === 'Saldo inicial' || (r.type === 'Ajuste' && r.direction === 'Sobrante');
const sign = (r) => (isIn(r) ? '+' : r.type === 'Transferencia propia' ? '' : '−');
const kind = (r) => (r.type === 'Ingreso' ? ['in', 'crop-fuel-in', 'lit-in'] : r.type === 'Transferencia propia' ? ['swap', 'crop-blue', 'lit-mid'] : r.type === 'Ajuste' ? ['scale', 'crop-silo', isIn(r) ? 'lit-in' : 'lit-out'] : r.type === 'Saldo inicial' ? ['start', 'crop-earth', 'lit-in'] : r.payment === 'Crédito' ? ['card', 'crop-fuel-out', 'lit-out'] : ['out', 'crop-fuel-out', 'lit-out']);
const field = (label, inner) => `<div class="field"><span class="f-label">${label}</span>${inner}</div>`;
const select = (id, name, inner) => `<div class="select-wrap"><select class="input select" id="${id}" name="${name}">${inner}</select>${icon('down', 18)}</div>`;

// ---------- barra superior ----------
function renderSync() {
  const el = $('#sync'), pend = store.pending(), fails = store.failed().length;
  if (!store.config.mode) { el.hidden = true; return; }
  let tone = 'ok', text = 'Al día', ic = 'check';
  const offline = !store.online || (store.sync.state === 'error' && store.sync.offline);
  if (offline) { tone = 'off'; text = pend ? `Sin señal · ${pend}` : 'Sin señal'; ic = 'cloudoff'; }
  else if (store.sync.state === 'syncing') { tone = 'busy'; text = 'Enviando…'; ic = 'refresh'; }
  else if (fails) { tone = 'err'; text = `${fails} con error`; ic = 'alert'; }
  else if (pend) { tone = 'warn'; text = `${pend} sin subir`; ic = 'cloud'; }
  else if (store.sync.state === 'error') { tone = 'err'; text = 'Error al sincronizar'; ic = 'alert'; }
  else if (store.config.mode === 'demo') { tone = 'demo'; text = 'Modo demo'; ic = 'sparkle'; }
  el.hidden = false; el.className = `sync-pill sync-${tone}`;
  el.innerHTML = `${icon(ic, 16, tone === 'busy' ? 'spin' : '')}<span>${text}</span>`;
  el.setAttribute('aria-label', `Estado de sincronización: ${text}`);
}

// ---------- tarjeta de movimiento ----------
function movCard(r) {
  const [ic, crop, lit] = kind(r);
  const sub = r.type === 'Transferencia propia' ? `${r.account} → ${r.destination}` : [r.category || r.type, r.account].filter(Boolean).join(' · ');
  const chip = r.status === 'failed' ? '<span class="chip chip-err">No se pudo enviar</span>' : r.status === 'pending' ? `<span class="chip chip-warn">${r.editOf ? 'Corrección sin subir' : 'Sin subir'}</span>` : '';
  return `<button type="button" class="card tap row-flex mov" data-detail="${esc(r.id)}">
    <span class="crop ${crop}">${icon(ic, 22)}</span>
    <span class="grow"><span class="ct">${esc(r.description || r.subcategory || r.category || r.type)}</span><span class="sub">${esc(sub)}</span>${chip ? `<span class="mov-chips">${chip}</span>` : ''}</span>
    <span class="mov-amt"><b class="lit ${lit}">${sign(r)} ${money(r.cents)}</b><small>${r.currency === 'USD' ? `US$ ${(r.originalCents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : shortDate(r.date)}</small></span>
  </button>`;
}
function emptyState(ic, title, text) { return `<div class="empty"><span class="empty-ic">${icon(ic, 30)}</span><h3>${title}</h3><p>${text}</p></div>`; }

// ---------- Inicio ----------
function home() {
  const now = new Date(), month = today().slice(0, 7), s = monthSummary(book, month);
  // Solo se avisa cuando hay algo que resolver. Lo pendiente ya se ve arriba (etiqueta de estado) y en cada movimiento.
  const fails = store.failed().length, mes = MESES[now.getMonth()];
  const note = fails ? ['note-err', 'alert', `${fails} movimiento${fails === 1 ? '' : 's'} no se pudo enviar. Tocá para revisarlo.`]
    : (store.sync.state === 'error' && !store.sync.offline) ? ['note-err', 'alert', 'No se pudo actualizar la planilla. Tocá para ver el detalle.'] : null;
  return `<div class="page">
  <div class="hero">
    <div class="hero-coin">${coinArt('hc')}</div>
    <p class="eyebrow">${DIAS[now.getDay()]} ${now.getDate()} de ${mes}</p>
    <p class="hero-label">Saldo disponible${s.estimated ? ' estimado' : ''}</p>
    <p class="hero-balance">${s.cash == null ? '—' : money(s.cash)}</p>
    <p class="hero-sub">${!s.known ? 'Todavía no hay una copia de la planilla en este celular.' : s.estimated ? 'Incluye lo que falta subir.' : `Según la planilla · ${ago(store.sync.lastSync)}`}</p>
    <div class="hero-stats">
      <button type="button" class="hs" data-hist="Ingreso"><b>${money0(s.income)}</b><span>ingresos del mes</span></button>
      <button type="button" class="hs" data-hist="Gasto"><b>${money0(s.expense)}</b><span>gastos del mes</span></button>
      <div class="hs hs-wide"><span>Resultado del mes${s.adjustments ? ' (con ajustes)' : ''}</span><b>${money0(s.result)}</b></div>
    </div>
  </div>
  ${note ? `<button type="button" class="note ${note[0]} note-btn" data-page="settings">${icon(note[1], 20)}<span>${note[2]}</span>${icon('right', 18)}</button>` : ''}
  <div class="quick">
    <button type="button" class="q" data-new="Gasto"><span class="q-ic q-out">${icon('out', 24)}</span>Gasto</button>
    <button type="button" class="q" data-new="Ingreso"><span class="q-ic q-in">${icon('in', 24)}</span>Ingreso</button>
    <button type="button" class="q" data-new="Transferencia propia"><span class="q-ic q-mid">${icon('swap', 24)}</span>Transferir</button>
    <button type="button" class="q" data-new="Ajuste"><span class="q-ic q-adj">${icon('scale', 24)}</span>Diferencia de caja</button>
  </div>
  ${installNudge()}
  <section class="sec"><div class="sec-head"><h2 class="sec-title">Últimos movimientos</h2>${book.rows.length > 6 ? '<button type="button" class="link" data-page="history">Ver todos</button>' : ''}</div>
  <div class="list">${book.rows.slice(0, 6).map(movCard).join('') || emptyState('wallet', 'Sin movimientos', 'Cargá tu primer gasto con los botones de arriba.')}</div></section>
  </div>`;
}
function installNudge() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false; try { dismissed = localStorage.getItem('mc-install-dismissed') === '1'; } catch {}
  if (!ios || standalone || dismissed) return '';
  return `<div class="nudge">${icon('share', 22)}<div class="grow"><b>Instalá Mi Caja en tu iPhone</b><p>Tocá Compartir y después "Añadir a pantalla de inicio". Así abre a pantalla completa y anda sin señal.</p></div><button class="icon-btn" type="button" id="hideNudge" aria-label="Ocultar">${icon('close', 18)}</button></div>`;
}

// ---------- Cargar / corregir ----------
function catList(type) { return book.catalog.categories.filter((c) => c.type === type || c.type === 'Ambos').map((c) => c.name); }
function defaultPayment(a) { if (mode === 'Ingreso') return a === 'Efectivo' ? 'Efectivo' : 'Transferencia'; return isCredit(book.catalog, a) ? 'Crédito' : a === 'Efectivo' ? 'Efectivo' : a === 'Mercado Pago' ? 'QR' : 'Débito'; }
function form() {
  const d = draft, cat = book.catalog;
  const transfer = mode === 'Transferencia propia', adjust = mode === 'Ajuste', withCat = !transfer && !adjust;
  const accounts = cat.accounts.map((a) => a.name);
  const fromAccounts = mode === 'Gasto' ? accounts : accounts.filter((a) => !isCredit(cat, a));
  const account = d.account && (fromAccounts.includes(d.account) || editing) ? d.account : fromAccounts[0];
  const cats = catList(mode);
  if (editing && d.category && !cats.includes(d.category)) cats.unshift(d.category);
  const frequent = cat.categories.filter((c) => c.frequent).map((c) => c.name);
  const category = d.category && cats.includes(d.category) ? d.category : (mode === 'Gasto' ? suggestedCategories(book.rows, cats, today(), 1, frequent)[0] : cats[0]);
  const sub = subcategoriesFor(book.rows, category, cat.subcats || []);
  if (d.subcategory && !sub.used.includes(d.subcategory) && !sub.rest.includes(d.subcategory)) sub.used.unshift(d.subcategory);
  const currency = withCat ? d.currency || 'ARS' : 'ARS', usd = currency === 'USD';
  const credit = isCredit(cat, account);
  const payments = cat.payments.filter((p) => mode !== 'Gasto' || p !== 'Crédito');
  const payment = credit && mode === 'Gasto' ? 'Crédito' : (d.payment && payments.includes(d.payment) ? d.payment : defaultPayment(account));
  const prio = d.priority ?? ((cat.categories.find((c) => c.name === category) || {}).priority || '');
  const date = d.date || today();
  const titles = { Gasto: 'Nuevo gasto', Ingreso: 'Nuevo ingreso', 'Transferencia propia': 'Transferencia entre cuentas', Ajuste: 'Diferencia de caja' };
  const dest = d.destination && d.destination !== account ? d.destination : accounts.find((a) => a !== account && isCredit(cat, a)) || accounts.find((a) => a !== account);
  return `<div class="page">
  <div class="page-head"><div><h1>${editing ? 'Corregir' : 'Cargar'}</h1><p>${editing ? (editing.kind === 'synced' ? `${esc(editing.displayId || '')} · conserva su número en la planilla` : 'Todavía no se envió') : titles[mode]}</p></div></div>
  ${!editing ? `<div class="seg" role="tablist">${[['Gasto', 'Gasto'], ['Ingreso', 'Ingreso'], ['Transferencia propia', 'Transferir'], ['Ajuste', 'Ajuste']].map(([t, l]) => `<button type="button" role="tab" aria-selected="${mode === t}" data-mode="${t}" class="${mode === t ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
  <form id="entry" class="form" autocomplete="off" novalidate>
    <input type="hidden" name="currency" value="${currency}">
    <div class="amount-card">
      <div class="amount-top"><span class="f-label">Importe ${usd ? 'en dólares' : 'en pesos'}</span>${withCat ? `<div class="seg seg-mini">${['ARS', 'USD'].map((c) => `<button type="button" data-cur="${c}" class="${currency === c ? 'on' : ''}">${c === 'ARS' ? 'Pesos' : 'Dólares'}</button>`).join('')}</div>` : ''}</div>
      <div class="amount-line"><span class="amount-cur">${usd ? 'US$' : '$'}</span><input class="money" id="amount" name="amount" type="text" inputmode="decimal" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0" value="${esc(formatAmountInput(d.amount ?? ''))}" aria-label="Importe"></div>
      ${usd ? `<div class="amount-rate"><span class="f-label">Tipo de cambio (pesos por dólar)</span><input class="input" id="exchangeRate" name="exchangeRate" type="text" inputmode="decimal" autocorrect="off" spellcheck="false" placeholder="Ej.: 1585" value="${esc(formatAmountInput(d.exchangeRate || '', 6))}"><span class="hint" id="converted" aria-live="polite"></span></div>` : ''}
    </div>
    ${withCat ? field('Categoría', `${select('category', 'category', opts(cats, category))}${mode === 'Gasto' && !editing ? `<div class="chips sug">${suggestedCategories(book.rows, cats, today(), 4, frequent).map((c) => `<button type="button" class="opt sm ${c === category ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}`) : ''}
    ${withCat ? field('Subcategoría <span class="opt-label">opcional</span>', select('subcategory', 'subcategory', `<option value="">Sin especificar</option>${sub.used.length ? `<optgroup label="Usadas con ${esc(category)}">${opts(sub.used, d.subcategory || '')}</optgroup><optgroup label="Otras">${opts(sub.rest, d.subcategory || '')}</optgroup>` : opts(sub.rest, d.subcategory || '')}`)) : ''}
    ${adjust ? field('Diferencia', `<div class="chips">${['Faltante', 'Sobrante'].map((v) => `<button type="button" class="opt ${(d.direction || 'Faltante') === v ? 'on' : ''}" data-dir="${v}">${v === 'Faltante' ? 'Falta plata' : 'Sobra plata'}</button>`).join('')}</div><input type="hidden" name="direction" value="${esc(d.direction || 'Faltante')}"><span class="hint">Para cuando contás la plata y no coincide con lo registrado. No suma a los gastos.</span>`) : ''}
    ${field(transfer ? 'Desde' : 'Cuenta / medio', select('account', 'account', opts(editing && !fromAccounts.includes(account) ? [account, ...fromAccounts] : fromAccounts, account)))}
    ${transfer ? field('Hacia', `${select('destination', 'destination', opts(accounts.filter((a) => a !== account), dest))}<span class="hint">Pagar el resumen de la tarjeta es una transferencia hacia la tarjeta: baja tu disponible sin sumar otro gasto.</span>`) : ''}
    ${withCat ? (credit && mode === 'Gasto' ? `<div class="note">${icon('card', 20)}<span>Compra con tarjeta: cuenta como gasto del mes, pero no baja tu disponible hasta que pagues el resumen.</span></div><input type="hidden" name="payment" value="Crédito">`
      : field('Forma de pago', `<div class="chips">${payments.map((p) => `<button type="button" class="opt sm ${p === payment ? 'on' : ''}" data-pay="${esc(p)}">${esc(p)}</button>`).join('')}</div><input type="hidden" name="payment" value="${esc(payment)}">`)) : ''}
    ${field('Descripción <span class="opt-label">opcional</span>', `<input class="input" name="description" id="description" maxlength="240" placeholder="¿En qué fue?" value="${esc(d.description || '')}">`)}
    <p class="f-section">Datos adicionales</p>
    ${field('Fecha', `<div class="input pick-wrap"><span class="pick-shown">${date === today() ? 'Hoy · ' : ''}${shortDate(date)}</span>${icon('calendar', 20)}<input class="pick-native" type="date" id="date" name="date" value="${esc(date)}" max="${today()}" aria-label="Fecha"></div>`)}
    ${mode === 'Gasto' ? `<div class="row-2">${field('Fijo / variable', select('frequency', 'frequency', opts(['Variable', 'Fijo'], d.frequency || 'Variable')))}${field('Prioridad', select('priority', 'priority', `<option value="">Sin especificar</option>${opts(['Necesario', 'Discrecional', 'No aplica'], prio)}`))}</div>` : ''}
    ${field('Observaciones <span class="opt-label">opcional</span>', `<textarea class="input" id="notes" name="notes" maxlength="1000" rows="2">${esc(d.notes || '')}</textarea>`)}
    <p class="err" id="formError" role="alert"></p>
    <div class="btn-col">
      <button class="btn btn-primary btn-lg btn-block" id="save" type="submit">${icon('check', 20)} ${editing ? 'Guardar corrección' : 'Guardar'}</button>
      ${editing ? '<button class="btn btn-ghost btn-block" type="button" data-cancel-edit>Cancelar</button>' : ''}
    </div>
    <p class="w-note">Se guarda en el celular al instante y se envía solo a la planilla cuando hay señal.</p>
  </form></div>`;
}
function capture() {
  const f = $('#entry'); if (!f) return;
  draft = { ...draft, ...Object.fromEntries(new FormData(f)) };
  if ($('#priority')) draft.priority = $('#priority').value;
}
function updateConversion() {
  const p = $('#converted'); if (!p) return;
  try { p.textContent = 'Equivale a ' + money(convertAmount($('#amount').value, 'USD', $('#exchangeRate').value).cents); } catch { p.textContent = 'Ingresá importe y cotización para ver el equivalente en pesos.'; }
}
async function save(f) {
  const d = Object.fromEntries(new FormData(f));
  const currency = d.currency || 'ARS';
  const { cents, originalCents, exchangeRate } = convertAmount(d.amount, currency, d.exchangeRate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw Error('Revisá la fecha.');
  if (d.date > today()) throw Error('La fecha no puede ser futura.');
  if (mode === 'Transferencia propia' && d.account === d.destination) throw Error('Elegí dos cuentas distintas.');
  const rec = {
    id: editing ? editing.id : store.newUuid(), type: mode, date: d.date, account: d.account, currency, originalCents, cents, exchangeRate,
    category: d.category || '', subcategory: d.subcategory || '', description: (d.description || '').trim(), notes: (d.notes || '').trim(),
    payment: mode === 'Transferencia propia' ? 'Transferencia' : d.payment || '', frequency: mode === 'Gasto' ? d.frequency || 'Variable' : '',
    priority: mode === 'Gasto' ? d.priority || '' : mode === 'Transferencia propia' ? 'No aplica' : '', destination: d.destination || '', direction: d.direction || '',
  };
  if (!editing) await store.enqueue({ t: 'add', rec });
  else if (editing.kind === 'op') {
    const op = store.ops.find((o) => o.id === editing.opId);
    await store.replaceOp(editing.opId, op && op.t === 'edit' ? { rec: { ...rec, id: op.key } } : { rec });
  } else await store.enqueue({ t: 'edit', key: editing.id, prev: editing.prev, rec });
  const wasEdit = !!editing;
  if (editing) mode = 'Gasto';
  editing = null; draft = {}; page = 'saved';
  navigate('home');
  toast(wasEdit ? 'Corrección guardada. Se envía sola.' : 'Guardado. Se envía solo a la planilla.', 'ok');
}

// ---------- Movimientos ----------
function history() {
  const months = [...new Set(book.rows.map((r) => (r.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = filters.q.trim().toLowerCase();
  const typeOk = (r) => filters.type === 'Todos' || (filters.type === 'Otros' ? !['Gasto', 'Ingreso'].includes(r.type) : r.type === filters.type);
  const list = book.rows.filter((r) => (!filters.month || (r.date || '').startsWith(filters.month)) && typeOk(r) && (!filters.cat || r.category === filters.cat)
    && (!q || [r.description, r.category, r.subcategory, r.account, r.notes, r.displayId, money(r.cents)].join(' ').toLowerCase().includes(q)));
  const out = list.filter((r) => r.type === 'Gasto').reduce((t, r) => t + r.cents, 0), inn = list.filter((r) => r.type === 'Ingreso').reduce((t, r) => t + r.cents, 0);
  let html = '', lastDay = '';
  for (const r of list.slice(0, showCount)) { if (r.date !== lastDay) { lastDay = r.date; html += `<h3 class="group-title">${dayLabel(r.date)}</h3>`; } html += movCard(r); }
  return `<div class="page">
  <div class="page-head"><div><h1>Movimientos</h1><p>${list.length} ${list.length === 1 ? 'movimiento' : 'movimientos'}${filters.month ? ' en ' + monthName(filters.month) : ''}</p></div></div>
  <div class="seg">${['Todos', 'Gasto', 'Ingreso', 'Otros'].map((t) => `<button type="button" data-ftype="${t}" class="${filters.type === t ? 'on' : ''}">${t === 'Gasto' ? 'Gastos' : t === 'Ingreso' ? 'Ingresos' : t}</button>`).join('')}</div>
  <label class="searchbox">${icon('search', 20)}<input class="input search" id="q" type="search" placeholder="Buscar descripción, categoría, número…" value="${esc(filters.q)}" enterkeyhint="search"></label>
  <div class="filters fit">
    <label class="filter">${icon('calendar', 16)}<select class="input select sm" id="fMonth" aria-label="Mes"><option value="">Mes</option>${months.map((m) => `<option value="${m}" ${m === filters.month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></label>
    <label class="filter">${icon('filter', 16)}<select class="input select sm" id="fCat" aria-label="Categoría"><option value="">Categoría</option>${opts([...new Set(book.rows.map((r) => r.category).filter(Boolean))].sort(), filters.cat)}</select></label>
  </div>
  ${out || inn ? `<div class="totals"><div class="total tot-out"><small>Gastos</small><b>${money(out)}</b></div><div class="total tot-in"><small>Ingresos</small><b>${money(inn)}</b></div></div>` : ''}
  <div class="list">${html || emptyState('search', 'Nada por acá', 'No hay movimientos con esos filtros.')}</div>
  ${list.length > showCount ? '<button class="btn btn-ghost btn-block" id="more" type="button">Mostrar más</button>' : ''}
  </div>`;
}

function detail(r) {
  const [ic, crop, lit] = kind(r);
  const rows = [['Número', r.displayId || (r.status === 'synced' ? '' : 'Se asigna al enviar')], ['Fecha', fdate(r.date)], ['Tipo', r.type + (r.direction ? ` · ${r.direction}` : '')], ['Categoría', r.category], ['Subcategoría', r.subcategory],
    ['Cuenta', r.account + (r.destination ? ` → ${r.destination}` : '')], ['Forma de pago', r.payment], ['Moneda', r.currency === 'USD' ? `US$ ${(r.originalCents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })} a ${r.exchangeRate}` : ''],
    ['Fijo / variable', r.frequency], ['Prioridad', r.priority], ['Observaciones', r.notes]].filter(([, v]) => v);
  const canEdit = EDITABLE_TYPES.includes(r.type);
  return `<div class="overlay in" data-overlay><div class="sheet" role="dialog" aria-modal="true" aria-label="Detalle del movimiento">
    <div class="sheet-head"><h2>${esc(r.description || r.subcategory || r.category || r.type)}</h2><button class="icon-btn" type="button" data-close aria-label="Cerrar">${icon('close', 22)}</button></div>
    <div class="sheet-body">
      <div class="det-top"><span class="crop ${crop}">${icon(ic, 24)}</span><b class="det-amt ${lit}">${sign(r)} ${money(r.cents)}</b></div>
      ${r.status !== 'synced' ? `<div class="note ${r.status === 'failed' ? 'note-err' : 'note-warn'}">${icon(r.status === 'failed' ? 'alert' : 'cloud', 20)}<span>${r.status === 'failed' ? `La planilla no lo aceptó: ${esc(r.error || 'error')}. Corregilo o descartalo.` : r.editOf ? 'La corrección todavía no subió. Se envía sola.' : 'Todavía no subió. Se envía solo cuando hay señal.'}</span></div>` : ''}
      <div class="card flat">${rows.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
      ${!canEdit ? '<p class="hint">Este tipo de movimiento se corrige desde la planilla.</p>' : ''}
    </div>
    ${canEdit || r.status !== 'synced' ? `<div class="sheet-foot"><div class="btn-row">
      ${r.status !== 'synced' ? `<button class="btn btn-ghost danger-text" type="button" data-discard="${esc(r.opId)}">${icon('trash', 20)} ${r.editOf ? 'Descartar corrección' : 'Descartar'}</button>` : ''}
      ${canEdit ? `<button class="btn btn-primary" type="button" data-edit="${esc(r.id)}">${icon('edit', 20)} Corregir</button>` : ''}
    </div></div>` : ''}
  </div></div>`;
}
function openEdit(id) {
  const r = book.rows.find((x) => x.id === id); if (!r) return;
  if (store.ops.some((o) => o.id === r.opId && o.sent)) { toast('Se está terminando de enviar. Probá en unos segundos.', 'info'); return; }
  mode = r.type; detailId = null;
  draft = { ...r, amount: centsToInput(r.currency === 'USD' ? r.originalCents : r.cents), exchangeRate: r.exchangeRate ? String(r.exchangeRate).replace('.', ',') : '' };
  editing = r.opId ? { kind: 'op', opId: r.opId, id: r.id } : { kind: 'synced', id: r.id, displayId: r.displayId, prev: r };
  navigate('form');
}

// ---------- Ajustes ----------
function describeOp(o) { const r = o.rec || {}; return `${o.t === 'edit' ? 'Corrección' : r.type || 'Movimiento'}: ${r.description || r.category || ''} · ${money(r.cents || 0)} · ${shortDate(r.date)}`; }
function settings() {
  const m = store.config.mode, pend = store.ops.filter((o) => !o.failed), fails = store.failed();
  const avisos = (store.snapshot && store.snapshot.avisos) || [];
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  return `<div class="page">
  <div class="page-head"><div><h1>Ajustes</h1><p>Conexión, pendientes y atajos</p></div></div>
  <div class="card">
    <div class="conn-row"><span class="dot dot-${m === 'demo' ? 'demo' : store.online ? 'ok' : 'off'}"></span><div class="grow"><b>${m === 'live' ? 'Conectada a tu planilla' : 'Modo demo (datos de ejemplo)'}</b><div class="sub">${store.online ? 'Con señal' : 'Sin señal'} · última sincronización ${ago(store.sync.lastSync)}</div></div></div>
    ${store.sync.error ? `<div class="note ${store.sync.offline ? 'note-warn' : 'note-err'}">${icon('alert', 20)}<span>${esc(store.sync.error)}</span></div>` : ''}
    ${avisos.map((a) => `<div class="note note-warn">${icon('alert', 20)}<span>La planilla avisa: ${esc(a)}</span></div>`).join('')}
    <button class="btn btn-primary btn-lg btn-block" id="syncNow" type="button" ${isSyncing() ? 'disabled' : ''}>${icon('refresh', 20, isSyncing() ? 'spin' : '')} ${isSyncing() ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
    <p class="hint">Lo que cargás se envía solo: al guardar, al volver la señal y cada vez que abrís la app. En el iPhone no puede enviar con la app cerrada.</p>
  </div>
  ${pend.length || fails.length ? `<section class="sec"><h2 class="sec-title">Sin subir (${pend.length + fails.length})</h2><div class="card">
    ${pend.map((o) => `<div class="op">${icon('cloud', 18)}<span class="grow">${esc(describeOp(o))}</span></div>`).join('')}
    ${fails.map((o) => `<div class="op failed">${icon('alert', 18)}<span class="grow">${esc(describeOp(o))}<small>${esc(o.error || 'Error')}</small></span><button class="link" type="button" data-detail="${esc(o.t === 'edit' ? o.key : o.rec.id)}">Ver</button></div>`).join('')}
    ${fails.length ? `<button class="btn btn-soft btn-block" id="retry" type="button">${icon('refresh', 20)} Reintentar los que fallaron</button>` : ''}
    <button class="btn btn-ghost btn-sm" id="export" type="button">${icon('download', 18)} Descargar copia de lo pendiente</button></div></section>` : ''}
  <section class="sec"><h2 class="sec-title">Atajos</h2><div class="tiles">
    <button type="button" class="tile tile-blue" data-new="Transferencia propia"><span class="tile-ic">${icon('swap', 26)}</span><b>Transferir</b><small>Entre cuentas o pagar la tarjeta</small></button>
    <button type="button" class="tile tile-gold" data-new="Ajuste"><span class="tile-ic">${icon('scale', 26)}</span><b>Diferencia de caja</b><small>Faltantes o sobrantes al contar</small></button>
  </div></section>
  <section class="sec"><h2 class="sec-title">Conexión con la planilla</h2><div class="card">
    ${m === 'live' ? `<p class="prose">Para usar Mi Caja en otro celular (por ejemplo el de tu mamá), copiá este código y pegalo allá en "Conectar con mi planilla".</p><button class="btn btn-soft btn-block" id="copyCode" type="button">${icon('copy', 20)} Copiar código de conexión</button>` : '<p class="prose">Estás en modo demo. Cuando tengas el servidor instalado en la planilla, conectala acá: lo del modo demo queda aparte.</p>'}
    <details class="adv" ${m !== 'live' ? 'open' : ''}><summary>${m === 'live' ? 'Cambiar conexión' : 'Conectar con mi planilla real'}</summary>${connectForm()}</details>
    ${m === 'demo' ? `<label class="check"><input type="checkbox" id="demoOffline" ${store.demoOffline ? 'checked' : ''}> Simular "sin señal" para probar</label><button class="btn btn-ghost btn-sm" id="demoReset" type="button">${icon('undo', 18)} Volver a los datos de ejemplo</button>` : ''}
  </div></section>
  <section class="sec"><h2 class="sec-title">Uso sin conexión</h2><div class="card">
    <div class="conn-row"><span class="dot dot-${swReady ? 'ok' : 'off'}"></span><div class="grow"><b>${swReady ? 'Lista para usar sin señal' : 'Preparando…'}</b><div class="sub">${swReady ? 'Abre sin conexión y guarda lo que cargues.' : 'Abrila una vez con señal.'}</div></div></div>
    ${!standalone ? '<p class="hint">Para instalarla: en el iPhone, Safari → Compartir → "Añadir a pantalla de inicio". En Android, menú ⋮ → "Instalar app".</p>' : ''}
  </div></section>
  <p class="version">Mi Caja ${VERSION} · ${VERSION_FECHA}<br><button class="link" id="checkUpdate" type="button">Buscar actualización</button></p>
  </div>`;
}
function connectForm() {
  return `<form id="connect" class="form connect-form">
  ${field('Código de conexión', '<textarea class="input mono" id="cCode" rows="2" placeholder="MC1.…" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>')}
  <p class="w-note">o bien</p>
  ${field('Dirección de la aplicación web', '<input class="input" id="cUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocorrect="off" spellcheck="false">')}
  ${field('Clave', '<input class="input" id="cTok" type="password" placeholder="La que muestra «configurar»" autocapitalize="off" autocorrect="off" spellcheck="false">')}
  <button class="btn btn-primary btn-block" type="submit">${icon('cloud', 20)} Conectar</button></form>`;
}
async function connect() {
  let cfg = parseCode($('#cCode').value);
  if (!cfg && $('#cUrl').value.trim()) cfg = { url: $('#cUrl').value.trim(), token: $('#cTok').value.trim() };
  if (!cfg || !cfg.token) { toast('Pegá el código completo, o la dirección y la clave.', 'warn'); return; }
  if (!validUrl(cfg.url)) { toast('La dirección tiene que ser la de Apps Script y terminar en /exec.', 'warn', 5000); return; }
  toast('Probando la conexión…', 'info', 8000);
  try { await api.ping({ url: cfg.url, token: cfg.token }); } catch (e) {
    toast(e instanceof ServerError && e.code === 'auth' ? 'La clave no coincide. Revisala.' : `No pude conectar: ${e.message}`, 'err', 6000); return;
  }
  await store.setConfig({ mode: 'live', url: cfg.url, token: cfg.token });
  page = 'home'; renderNow();
  const r = await sync();
  toast(r.ok ? 'Conectada. Tus datos ya están en el celular.' : r.error, r.ok ? 'ok' : 'warn', 5000);
}

// ---------- Bienvenida ----------
function welcome() {
  return `<div class="welcome-page">
  <div class="w-hero"><div class="w-coin">${coinArt('wc')}</div><div class="w-logo">${logoSvg('wl', 84)}</div><h1>Mi Caja</h1><p>Tus gastos e ingresos, cargados en segundos y guardados en tu planilla. Funciona aunque no haya señal.</p></div>
  <div class="w-body">
    <button class="btn btn-primary btn-lg btn-block" id="openConnect" type="button">${icon('cloud', 20)} Conectar con mi planilla</button>
    <div class="connect-panel" ${connectOpen ? '' : 'hidden'}>${connectForm()}</div>
    <button class="btn btn-ghost btn-lg btn-block" id="demo" type="button">${icon('sparkle', 20)} Probar con datos de ejemplo</button>
    <p class="w-note">Los datos de ejemplo son inventados. No se mezclan con tu planilla real.</p>
  </div></div>`;
}

// ---------- navegación y dibujo ----------
function navigate(next) {
  if (page === 'history') historyY = window.scrollY;
  if (page === 'form' && next !== 'form') { if (editing) { editing = null; draft = {}; mode = 'Gasto'; } else capture(); }
  page = next; detailId = null;
  renderNow();
  window.scrollTo({ top: next === 'history' ? historyY : 0, left: 0, behavior: 'instant' });
}
function renderNow() {
  book = buildBook(store.snapshot, store.ops);
  renderSync();
  if (!store.config.mode) { document.body.classList.add('welcome'); $('#view').innerHTML = welcome(); $('#overlay').innerHTML = ''; return; }
  document.body.classList.remove('welcome');
  $('#view').innerHTML = page === 'home' ? home() : page === 'form' ? form() : page === 'history' ? history() : settings();
  $('#tabbar').querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.page === page)));
  const r = detailId && book.rows.find((x) => x.id === detailId);
  $('#overlay').innerHTML = r ? detail(r) : '';
  document.body.classList.toggle('noscroll', !!r);
  if (page === 'form') updateConversion();
}
function safeRender() {
  const a = document.activeElement;
  if (a && $('#view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = true; renderSync(); return; }
  if (page === 'form') capture();
  renderNow();
}
function updateBanner() { $('#update').hidden = !swWaiting; }
function setDraft(k, v) { capture(); draft[k] = v; renderNow(); }

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  if (e.target.matches('[data-overlay]')) { detailId = null; renderNow(); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.page) { navigate(b.dataset.page); return; }
  if (b.dataset.new) { editing = null; draft = {}; mode = b.dataset.new; navigate('form'); return; }
  if (b.dataset.hist) { filters = { ...filters, type: b.dataset.hist, month: today().slice(0, 7) }; showCount = 120; historyY = 0; navigate('history'); return; }
  if (b.dataset.mode) { capture(); mode = b.dataset.mode; draft = { amount: draft.amount, date: draft.date, description: draft.description, notes: draft.notes, account: draft.account }; renderNow(); return; }
  if (b.dataset.cat) { capture(); draft.category = b.dataset.cat; draft.subcategory = ''; draft.priority = undefined; renderNow(); return; }
  if (b.dataset.cur) { setDraft('currency', b.dataset.cur); return; }
  if (b.dataset.pay) { setDraft('payment', b.dataset.pay); return; }
  if (b.dataset.dir) { setDraft('direction', b.dataset.dir); return; }
  if (b.dataset.ftype) { filters.type = b.dataset.ftype; showCount = 120; renderNow(); return; }
  if (b.dataset.detail) { detailId = b.dataset.detail; renderNow(); return; }
  if (b.dataset.close !== undefined) { detailId = null; renderNow(); return; }
  if (b.dataset.edit) { openEdit(b.dataset.edit); return; }
  if (b.dataset.cancelEdit !== undefined) { navigate('history'); return; }
  if (b.dataset.discard) {
    if (!confirm('¿Descartar este cambio? No se va a guardar en la planilla.')) return;
    await store.discard(b.dataset.discard); detailId = null; toast('Descartado'); return;
  }
  if (b.id === 'sync') { navigate('settings'); return; }
  if (b.id === 'hideNudge') { try { localStorage.setItem('mc-install-dismissed', '1'); } catch {} renderNow(); return; }
  if (b.id === 'openConnect') { connectOpen = !connectOpen; renderNow(); return; }
  if (b.id === 'syncNow') { const r = sync(); renderNow(); const x = await r; toast(x.ok ? 'Todo al día' : x.error, x.ok ? 'ok' : 'warn', 4000); return; }
  if (b.id === 'retry') { await store.retryFailed(); sync(); return; }
  if (b.id === 'more') { showCount += 200; renderNow(); return; }
  if (b.id === 'demo') { await store.setConfig({ mode: 'demo' }); page = 'home'; renderNow(); toast('Modo demo: nada de esto toca tu planilla', 'info'); await sync(); return; }
  if (b.id === 'demoReset') { if (!confirm('¿Borrar lo cargado en el modo demo y volver a los datos de ejemplo?')) return; for (const o of [...store.ops]) await store.discard(o.id); await store.setKV('mock:demo', null); resetDemo(); await sync(); toast('Datos de ejemplo restablecidos', 'ok'); return; }
  if (b.id === 'copyCode') { const code = makeCode(store.config.url, store.config.token); try { await navigator.clipboard.writeText(code); toast('Código copiado. Pegalo en el otro celular.', 'ok'); } catch { prompt('Copiá este código:', code); } return; }
  if (b.id === 'export') {
    const blob = new Blob([JSON.stringify({ app: 'Mi Caja', version: VERSION, exportedAt: new Date().toISOString(), pendientes: store.ops }, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `mi-caja-pendientes-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); return;
  }
  if (b.id === 'checkUpdate') { const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) { toast('Ya tenés la última versión.'); return; } await reg.update().catch(() => {}); setTimeout(() => toast(swWaiting ? 'Hay una versión nueva: tocá "Actualizar" arriba.' : 'Ya tenés la última versión.', 'info'), 1500); return; }
  if (b.id === 'applyUpdate') { if (page === 'form' && ($('#amount')?.value || editing)) { toast('Guardá o cancelá la carga antes de actualizar.', 'warn'); return; } swWaiting && swWaiting.postMessage('SKIP_WAITING'); return; }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'connect') { await connect(); return; }
  if (e.target.id !== 'entry' || busy) return;
  busy = true; $('#save').disabled = true;
  try { await save(e.target); } catch (err) { const el = $('#formError'); if (el) el.textContent = err.message; const s = $('#save'); if (s) s.disabled = false; } finally { busy = false; }
});
// Punto de miles automático mientras se escribe (1000 → 1.000), sin mover el cursor de lugar.
function formatMoneyField(input) {
  const raw = input.value, st = input.selectionStart ?? raw.length;
  const before = raw.slice(0, st).replace(/[^\d,]/g, '').length;
  const out = formatAmountInput(raw, input.id === 'exchangeRate' ? 6 : 2);
  if (out === raw) return;
  input.value = out;
  const pos = caretAfterFormat(out, before);
  try { input.setSelectionRange(pos, pos); } catch {}
}
document.addEventListener('input', (e) => {
  if (['amount', 'exchangeRate'].includes(e.target.id)) { if (!e.isComposing) formatMoneyField(e.target); updateConversion(); }
  if (e.target.id === 'q') { filters.q = e.target.value; clearTimeout(window.__qt); window.__qt = setTimeout(() => { const pos = e.target.selectionStart; renderNow(); const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 250); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'account' || id === 'category') {
    capture();
    if (id === 'account') draft.payment = defaultPayment(e.target.value);
    if (id === 'category') { draft.subcategory = ''; draft.priority = undefined; }
    renderNow(); return;
  }
  if (id === 'date') { setDraft('date', e.target.value || today()); return; }
  if (id === 'fMonth') { filters.month = e.target.value; showCount = 120; renderNow(); }
  if (id === 'fCat') { filters.cat = e.target.value; showCount = 120; renderNow(); }
  if (id === 'demoOffline') { store.demoOffline = e.target.checked; if (!e.target.checked) sync(); else { store.online = false; store.emit(); } }
});
document.addEventListener('focusout', () => {
  if (!pendingRender) return;
  setTimeout(() => { const a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = false; if (page === 'form') capture(); renderNow(); } }, 80);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && detailId) { detailId = null; renderNow(); } });

// Gestos: sin zoom con dos dedos (el scroll con un dedo sigue normal).
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (ev) => ev.preventDefault(), { passive: false });
document.addEventListener('touchmove', (ev) => { if (ev.touches.length > 1 && ev.cancelable) ev.preventDefault(); }, { passive: false });

// ---------- versión nueva ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const ask = (sw) => { swWaiting = sw; updateBanner(); };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => { const sw = reg.installing; sw && sw.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) ask(sw); }); });
    navigator.serviceWorker.ready.then(() => { swReady = true; if (page === 'settings') safeRender(); });
    setInterval(() => reg.update().catch(() => {}), 3600000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloaded) return; reloaded = true; location.reload(); });
}

async function boot() {
  $('#brandLogo').innerHTML = logoSvg('lg', 34);
  $('#tabbar').innerHTML = [['home', 'Inicio', 'home'], ['form', 'Cargar', 'plus'], ['history', 'Movimientos', 'list'], ['settings', 'Ajustes', 'gear']]
    .map(([p, l, ic]) => `<button type="button" data-page="${p}">${icon(ic, 24)}<span>${l}</span></button>`).join('');
  try { await store.init(); } catch { $('#view').innerHTML = '<div class="page"><h1>No se pudo abrir el almacenamiento</h1><p>Mi Caja necesita permiso para guardar datos en este navegador.</p></div>'; return; }
  store.subscribe(safeRender);
  renderNow();
  startAutoSync();
  if (store.config.mode) sync({ quiet: !!store.snapshot });
  registerSW();
  window.__mc = { store, sync }; // para pruebas
}
boot();
