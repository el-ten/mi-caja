// Mi Caja: pantallas, carga de movimientos y ajustes. La sincronización vive en sync.js (mismo motor que Don Enrique).
import { store } from './store.js';
import { sync, startAutoSync, isSyncing } from './sync.js';
import { api, ServerError, resetDemo } from './api.js';
import { buildBook, monthSummary, isCredit, EDITABLE_TYPES } from './book.js';
import { normalizeDecimalInput, convertAmount, suggestedCategories, subcategoriesFor, money, centsToInput } from './ledger.js';
import { makeCode, parseCode, validUrl } from './connect.js';
import { icon } from './icons.js';
import { VERSION, VERSION_FECHA } from './version.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fdate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
const opts = (list, value) => list.map((v) => `<option ${v === value ? 'selected' : ''} value="${esc(v)}">${esc(v)}</option>`).join('');

let book = buildBook(null, []);
let page = 'home', mode = 'Gasto', draft = {}, editing = null, detailId = null;
let filters = { month: '', type: 'Todos', cat: '', q: '' }, showCount = 120, historyY = 0;
let pendingRender = false, busy = false, swWaiting = null, swReady = false;

// ---------- utilidades de pantalla ----------
let toastTimer;
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
function ago(iso) {
  if (!iso) return 'todavía no';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'recién'; if (s < 3600) return `hace ${Math.round(s / 60)} min`; if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
}
const sign = (r) => (r.type === 'Ingreso' || r.type === 'Saldo inicial' || (r.type === 'Ajuste' && r.direction === 'Sobrante') ? '+' : r.type === 'Transferencia propia' ? '' : '−');
const typeIcon = (r) => icon(r.type === 'Ingreso' ? 'in' : r.type === 'Transferencia propia' ? 'swap' : r.type === 'Ajuste' ? 'scale' : r.type === 'Saldo inicial' ? 'start' : 'out', 20);
const statusLabel = (r) => (r.status === 'failed' ? 'No se pudo enviar' : r.status === 'pending' ? (r.editOf ? 'Corrección sin enviar' : 'Sin enviar') : '');

// ---------- encabezado ----------
function renderSync() {
  const el = $('#sync'), pend = store.pending(), fails = store.failed().length;
  let tone = 'ok', text = 'Al día', ic = 'check';
  const offline = !store.online || (store.sync.state === 'error' && store.sync.offline);
  if (!store.config.mode) { el.hidden = true; return; }
  if (offline) { tone = 'off'; text = pend ? `Sin señal · ${pend}` : 'Sin señal'; ic = 'cloudoff'; }
  else if (store.sync.state === 'syncing') { tone = 'busy'; text = 'Enviando…'; ic = 'refresh'; }
  else if (fails) { tone = 'err'; text = `${fails} con error`; ic = 'alert'; }
  else if (pend) { tone = 'warn'; text = `${pend} sin enviar`; ic = 'cloud'; }
  else if (store.sync.state === 'error') { tone = 'err'; text = 'Error'; ic = 'alert'; }
  else if (store.config.mode === 'demo') { tone = 'demo'; text = 'Demo'; ic = 'sparkle'; }
  el.hidden = false; el.className = `sync-pill sync-${tone}`;
  el.innerHTML = `${icon(ic, 15, tone === 'busy' ? 'spin' : '')}<span>${text}</span>`;
  el.setAttribute('aria-label', `Estado: ${text}. Ver sincronización`);
}

// ---------- Inicio ----------
function record(r) {
  const st = statusLabel(r);
  const sub = [fdate(r.date), r.account, r.type === 'Transferencia propia' ? '→ ' + r.destination : r.subcategory].filter(Boolean).join(' · ');
  return `<button class="row ${r.status !== 'synced' ? 'is-' + r.status : ''}" data-detail="${esc(r.id)}">
    <span class="icon">${typeIcon(r)}</span>
    <span class="body"><strong>${esc(r.description || r.category || r.type)}</strong><small>${esc(sub)}</small>${st ? `<small class="st">${icon(r.status === 'failed' ? 'alert' : 'cloud', 13)} ${st}</small>` : ''}</span>
    <span class="amount ${sign(r) === '+' ? 'positive' : ''}">${sign(r)} ${money(r.cents)}${r.currency === 'USD' ? `<small>USD ${(r.originalCents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</small>` : ''}</span>
  </button>`;
}
function home() {
  const month = today().slice(0, 7), s = monthSummary(book, month);
  const pend = store.pending(), fails = store.failed().length;
  const note = fails ? `${fails} movimiento${fails === 1 ? '' : 's'} no se pudo enviar. Revisalo en Ajustes.` : pend ? `${pend} movimiento${pend === 1 ? '' : 's'} esperando señal para enviarse solo${pend === 1 ? '' : 's'}.` : (store.sync.state === 'error' && !store.sync.offline) ? 'No se pudo actualizar la planilla.' : '';
  return `<div class="eyebrow">Tu dinero, en orden</div><h1>Un vistazo a tu caja</h1>
  <div class="hero"><small>Saldo disponible${s.estimated ? ' estimado' : ''}</small><div class="balance">${s.cash == null ? '—' : money(s.cash)}</div>
  <p>${!s.known ? 'Todavía no hay una copia de la planilla en este celular.' : s.estimated ? 'Planilla + lo cargado que todavía no se envió.' : `Según la planilla · ${ago(store.sync.lastSync)}`}</p></div>
  ${note ? `<div class="sync-inline ${fails ? 'bad' : ''}"><span>${note}</span><button data-page="settings">Ver</button></div>` : ''}
  <div class="cards"><div class="card"><small>Ingresos de ${MONTHS[Number(month.slice(5)) - 1]}</small><strong>${money(s.income)}</strong></div><div class="card"><small>Gastos de ${MONTHS[Number(month.slice(5)) - 1]}</small><strong>${money(s.expense)}</strong></div></div>
  <p class="muted">Resultado del mes: <b>${money(s.result)}</b>${s.adjustments ? ` · incluye ajustes por ${money(s.adjustments)}` : ''}</p>
  <div class="actions"><button class="primary" data-new="Gasto">${icon('plus', 18)} Cargar gasto</button><button class="secondary" data-new="Ingreso">Ingreso</button></div>
  <h2>Últimos movimientos</h2>${book.rows.slice(0, 6).map(record).join('') || '<div class="empty">Todavía no hay movimientos.</div>'}
  ${book.rows.length > 6 ? '<button class="link-more" data-page="history">Ver todos</button>' : ''}`;
}

// ---------- Cargar / corregir ----------
function catList(type) { return book.catalog.categories.filter((c) => c.type === type || c.type === 'Ambos').map((c) => c.name); }
function form() {
  const d = draft, cat = book.catalog;
  const transfer = mode === 'Transferencia propia', adjust = mode === 'Ajuste', withCat = !transfer && !adjust;
  const accounts = cat.accounts.map((a) => a.name);
  const fromAccounts = mode === 'Gasto' ? accounts : accounts.filter((a) => !isCredit(cat, a));
  const account = d.account && (fromAccounts.includes(d.account) || editing) ? d.account : fromAccounts[0];
  const cats = catList(mode);
  if (editing && d.category && !cats.includes(d.category)) cats.unshift(d.category);
  const category = d.category && cats.includes(d.category) ? d.category : (mode === 'Gasto' ? suggestedCategories(book.rows, cats, today(), 1, cat.categories.filter((c) => c.frequent).map((c) => c.name))[0] : cats[0]);
  const sub = subcategoriesFor(book.rows, category, cat.subcats || []);
  if (d.subcategory && !sub.used.includes(d.subcategory) && !sub.rest.includes(d.subcategory)) sub.used.unshift(d.subcategory);
  const usd = d.currency === 'USD' && withCat;
  const credit = isCredit(cat, account);
  const payment = credit && mode === 'Gasto' ? 'Crédito' : (d.payment || defaultPayment(account));
  const prio = d.priority ?? ((cat.categories.find((c) => c.name === category) || {}).priority || '');
  const title = editing ? 'Corregir movimiento' : 'Cargar movimiento';
  return `<div class="eyebrow">${editing ? (editing.kind === 'synced' ? `Corrigiendo ${esc(editing.displayId || '')}` : 'Corrigiendo un pendiente') : 'Registro rápido'}</div><h1>${title}</h1>
  ${!editing ? `<div class="tabs" role="tablist">${['Gasto', 'Ingreso', 'Transferencia propia', 'Ajuste'].map((t) => `<button type="button" data-mode="${t}" class="${mode === t ? 'active' : ''}">${t === 'Transferencia propia' ? 'Transferir' : t}</button>`).join('')}</div>` : `<p class="muted">${esc(mode)}${editing.kind === 'synced' ? ' · la corrección se envía sola a la planilla y conserva el mismo número.' : ''}</p>`}
  <form id="entry" autocomplete="off">
    ${withCat ? `<div class="seg" role="radiogroup" aria-label="Moneda">${['ARS', 'USD'].map((c) => `<label class="${(d.currency || 'ARS') === c ? 'on' : ''}"><input type="radio" name="currency" value="${c}" ${(d.currency || 'ARS') === c ? 'checked' : ''}> ${c === 'ARS' ? 'Pesos' : 'Dólares'}</label>`).join('')}</div>` : '<input type="hidden" name="currency" value="ARS">'}
    <label for="amount">Importe ${usd ? 'en dólares' : 'en pesos'}</label>
    <input class="money" id="amount" name="amount" type="text" inputmode="decimal" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="0,00" value="${esc(d.amount ?? '')}" required>
    ${usd ? `<label for="exchangeRate">Tipo de cambio (pesos por 1 USD)</label><input id="exchangeRate" name="exchangeRate" type="text" inputmode="decimal" autocorrect="off" spellcheck="false" placeholder="Ej.: 1585" value="${esc(d.exchangeRate || '')}" required><p class="muted" id="converted" aria-live="polite"></p>` : ''}
    ${withCat ? `<label for="category">Categoría</label><select id="category" name="category">${opts(cats, category)}</select>
      ${mode === 'Gasto' && !editing ? `<div class="chips">${suggestedCategories(book.rows, cats, today(), 4, cat.categories.filter((c) => c.frequent).map((c) => c.name)).map((c) => `<button type="button" class="${c === category ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      <label for="subcategory">Subcategoría <span class="muted">(opcional)</span></label><select id="subcategory" name="subcategory"><option value="">Sin especificar</option>
      ${sub.used.length ? `<optgroup label="Usadas con ${esc(category)}">${opts(sub.used, d.subcategory || '')}</optgroup><optgroup label="Otras">${opts(sub.rest, d.subcategory || '')}</optgroup>` : opts(sub.rest, d.subcategory || '')}</select>` : ''}
    ${adjust ? `<label for="direction">Diferencia de caja</label><select name="direction" id="direction">${opts(['Faltante', 'Sobrante'], d.direction || 'Faltante')}</select><p class="muted">Para cuando contás la plata y no coincide con lo registrado. No suma a gastos de consumo.</p>` : ''}
    <label for="account">${transfer ? 'Desde' : 'Cuenta / medio'}</label><select name="account" id="account">${opts(editing && !fromAccounts.includes(account) ? [account, ...fromAccounts] : fromAccounts, account)}</select>
    ${transfer ? `<label for="destination">Hacia</label><select name="destination" id="destination">${opts(accounts.filter((a) => a !== account), d.destination && d.destination !== account ? d.destination : accounts.find((a) => a !== account && isCredit(cat, a)) || accounts.find((a) => a !== account))}</select><p class="muted">Pagar el resumen de la tarjeta es una transferencia hacia la tarjeta: baja tu disponible sin sumar otro gasto.</p>` : ''}
    ${withCat ? `<label for="payment">Forma de pago</label><select id="payment" name="payment" ${credit && mode === 'Gasto' ? 'disabled' : ''}>${opts(cat.payments.filter((p) => mode !== 'Gasto' || credit || p !== 'Crédito'), payment)}</select>${credit && mode === 'Gasto' ? '<input type="hidden" name="payment" value="Crédito"><p class="muted">Compra con tarjeta: cuenta como gasto del mes, pero no baja tu disponible hasta que pagues el resumen.</p>' : ''}` : ''}
    ${mode === 'Gasto' ? `<div class="twocol"><div><label for="frequency">Fijo / variable</label><select id="frequency" name="frequency">${opts(['Variable', 'Fijo'], d.frequency || 'Variable')}</select></div><div><label for="priority">Prioridad</label><select id="priority" name="priority"><option value="">Sin especificar</option>${opts(['Necesario', 'Discrecional', 'No aplica'], prio)}</select></div></div>` : ''}
    <label for="description">Descripción <span class="muted">(opcional)</span></label><input name="description" id="description" maxlength="240" placeholder="¿En qué fue?" value="${esc(d.description || '')}">
    <details ${d.date && d.date !== today() || d.notes ? 'open' : ''}><summary>Fecha y observaciones</summary>
      <label for="date">Fecha</label><input type="date" id="date" name="date" value="${esc(d.date || today())}" max="${today()}" required>
      <label for="notes">Observaciones</label><textarea id="notes" name="notes" maxlength="1000" rows="3">${esc(d.notes || '')}</textarea></details>
    <p class="error" id="formError" role="alert"></p>
    <button class="primary wide" id="save" type="submit">${editing ? 'Guardar corrección' : 'Guardar'}</button>
    ${editing ? '<button class="secondary wide" type="button" data-cancel-edit>Cancelar</button>' : ''}
    <p class="muted center">Se guarda en el celular al instante y se envía solo a la planilla cuando hay señal.</p>
  </form>`;
}
function defaultPayment(a) { if (mode === 'Ingreso') return a === 'Efectivo' ? 'Efectivo' : 'Transferencia'; return isCredit(book.catalog, a) ? 'Crédito' : a === 'Efectivo' ? 'Efectivo' : a === 'Mercado Pago' ? 'QR' : 'Débito'; }
function capture() { const f = $('#entry'); if (f) { const fd = Object.fromEntries(new FormData(f)); draft = { ...draft, ...fd }; if ($('#priority')) draft.priority = $('#priority').value; } }
function updateConversion() {
  const p = $('#converted'); if (!p) return;
  try { p.textContent = 'Equivale a ' + money(convertAmount($('#amount').value, 'USD', $('#exchangeRate').value).cents); } catch { p.textContent = 'Ingresá importe y cotización para ver el equivalente en pesos.'; }
}

async function save(form) {
  const d = Object.fromEntries(new FormData(form));
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
  toast(wasEdit ? 'Corrección guardada. Se envía sola.' : 'Guardado. Se envía solo a la planilla.');
}

// ---------- Movimientos ----------
function history() {
  const months = [...new Set(book.rows.map((r) => (r.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const q = filters.q.trim().toLowerCase();
  const list = book.rows.filter((r) => (!filters.month || (r.date || '').startsWith(filters.month)) && (filters.type === 'Todos' || r.type === filters.type) && (!filters.cat || r.category === filters.cat)
    && (!q || [r.description, r.category, r.subcategory, r.account, r.notes, r.displayId, money(r.cents)].join(' ').toLowerCase().includes(q)));
  const totalOut = list.filter((r) => r.type === 'Gasto').reduce((t, r) => t + r.cents, 0), totalIn = list.filter((r) => r.type === 'Ingreso').reduce((t, r) => t + r.cents, 0);
  return `<div class="eyebrow">Todo a mano</div><h1>Movimientos</h1>
  <div class="searchbox">${icon('search', 18)}<input id="q" type="search" placeholder="Buscar descripción, categoría, número…" value="${esc(filters.q)}" enterkeyhint="search"></div>
  <div class="filters"><select id="fMonth" aria-label="Mes"><option value="">Todos los meses</option>${months.map((m) => `<option value="${m}" ${m === filters.month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select>
  <select id="fType" aria-label="Tipo">${opts(['Todos', 'Gasto', 'Ingreso', 'Transferencia propia', 'Ajuste', 'Saldo inicial', 'Ahorro / inversión'], filters.type)}</select>
  <select id="fCat" aria-label="Categoría"><option value="">Todas las categorías</option>${opts([...new Set(book.rows.map((r) => r.category).filter(Boolean))].sort(), filters.cat)}</select></div>
  <p class="muted">${list.length} movimiento${list.length === 1 ? '' : 's'}${totalOut ? ` · gastos ${money(totalOut)}` : ''}${totalIn ? ` · ingresos ${money(totalIn)}` : ''}</p>
  ${list.slice(0, showCount).map(record).join('') || '<div class="empty">No hay movimientos con esos filtros.</div>'}
  ${list.length > showCount ? '<button class="link-more" id="more">Mostrar más</button>' : ''}`;
}

function detail(r) {
  const rows = [['Número', r.displayId || (r.status === 'synced' ? '' : 'Se asigna al enviar')], ['Fecha', fdate(r.date)], ['Tipo', r.type + (r.direction ? ` · ${r.direction}` : '')], ['Categoría', [r.category, r.subcategory].filter(Boolean).join(' · ')],
    ['Cuenta', r.account + (r.destination ? ` → ${r.destination}` : '')], ['Forma de pago', r.payment], ['Importe', money(r.cents) + (r.currency === 'USD' ? ` (USD ${(r.originalCents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })} a ${r.exchangeRate})` : '')],
    ['Fijo / variable', r.frequency], ['Prioridad', r.priority], ['Observaciones', r.notes]].filter(([, v]) => v);
  const canEdit = EDITABLE_TYPES.includes(r.type);
  return `<div class="sheet-bg" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Detalle del movimiento">
    <div class="sheet-head"><b>${esc(r.description || r.category || r.type)}</b><button class="iconbtn" data-close aria-label="Cerrar">${icon('close', 20)}</button></div>
    <div class="sheet-amount ${sign(r) === '+' ? 'positive' : ''}">${sign(r)} ${money(r.cents)}</div>
    ${r.status !== 'synced' ? `<div class="note ${r.status === 'failed' ? 'bad' : ''}">${icon(r.status === 'failed' ? 'alert' : 'cloud', 16)}<span>${r.status === 'failed' ? `La planilla no lo aceptó: ${esc(r.error || 'error')}. Corregilo o descartalo.` : r.editOf ? 'La corrección todavía no se envió. Se envía sola.' : 'Todavía no se envió. Se envía solo cuando hay señal.'}</span></div>` : ''}
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="sheet-actions">
      ${canEdit ? `<button class="primary" data-edit="${esc(r.id)}">${icon('edit', 18)} Corregir</button>` : '<p class="muted">Este tipo de movimiento se corrige desde la planilla.</p>'}
      ${r.status !== 'synced' ? `<button class="danger" data-discard="${esc(r.opId)}">${icon('trash', 18)} ${r.editOf ? 'Descartar corrección' : 'Descartar'}</button>` : ''}
    </div></div>`;
}
function openEdit(id) {
  const r = book.rows.find((x) => x.id === id); if (!r) return;
  if (store.ops.some((o) => o.id === r.opId && o.sent)) { toast('Se está terminando de enviar. Probá en unos segundos.'); return; }
  mode = r.type; detailId = null;
  draft = { ...r, amount: centsToInput(r.currency === 'USD' ? r.originalCents : r.cents), exchangeRate: r.exchangeRate ? String(r.exchangeRate).replace('.', ',') : '' };
  editing = r.opId ? { kind: 'op', opId: r.opId, id: r.id } : { kind: 'synced', id: r.id, displayId: r.displayId, prev: r };
  navigate('form');
}

// ---------- Ajustes ----------
function describeOp(o) {
  const r = o.rec || {};
  return `${o.t === 'edit' ? 'Corrección' : r.type || 'Movimiento'}: ${r.description || r.category || ''} · ${money(r.cents || 0)} · ${fdate(r.date)}`;
}
function settings() {
  const mode = store.config.mode, pend = store.ops.filter((o) => !o.failed), fails = store.failed();
  const avisos = (store.snapshot && store.snapshot.avisos) || [];
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  return `<div class="eyebrow">A tu manera</div><h1>Ajustes</h1>
  <section class="box"><div class="conn"><span class="dot dot-${mode === 'demo' ? 'demo' : store.online ? 'ok' : 'off'}"></span><div><b>${mode === 'live' ? 'Conectada a tu planilla' : 'Modo demo · datos de ejemplo'}</b><small>${store.online ? 'Con señal' : 'Sin señal'} · última actualización ${ago(store.sync.lastSync)}</small></div></div>
    ${store.sync.error ? `<div class="note ${store.sync.offline ? '' : 'bad'}">${icon('alert', 16)}<span>${esc(store.sync.error)}</span></div>` : ''}
    ${avisos.map((a) => `<div class="note">${icon('alert', 16)}<span>La planilla avisa: ${esc(a)}</span></div>`).join('')}
    <button class="primary wide" id="syncNow" ${isSyncing() ? 'disabled' : ''}>${icon('refresh', 18, isSyncing() ? 'spin' : '')} ${isSyncing() ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
    <p class="muted">Lo que cargás se envía solo: al guardar, al volver la señal y cada vez que abrís la app. En el iPhone no puede enviar con la app cerrada.</p></section>
  ${pend.length || fails.length ? `<h2>Sin enviar (${pend.length + fails.length})</h2><section class="box">
    ${pend.map((o) => `<div class="op">${icon('cloud', 16)}<span>${esc(describeOp(o))}</span></div>`).join('')}
    ${fails.map((o) => `<div class="op bad">${icon('alert', 16)}<span>${esc(describeOp(o))}<small>${esc(o.error || 'Error')}</small></span><button class="link" data-detail="${esc(o.t === 'edit' ? o.key : o.rec.id)}">Ver</button></div>`).join('')}
    ${fails.length ? '<button class="secondary wide" id="retry">Reintentar los que fallaron</button>' : ''}
    <button class="link small" id="export">${icon('download', 15)} Descargar copia de lo pendiente</button></section>` : ''}
  <h2>Atajos</h2><section class="box list">
    <button class="item" data-new="Transferencia propia">${icon('swap', 20)}<span><b>Transferir entre cuentas</b><small>Incluye pagar el resumen de la tarjeta</small></span>${icon('chevron', 18)}</button>
    <button class="item" data-new="Ajuste">${icon('scale', 20)}<span><b>Diferencia de caja</b><small>Faltantes o sobrantes al contar la plata</small></span>${icon('chevron', 18)}</button></section>
  <h2>Conexión</h2><section class="box">
    ${mode === 'live' ? `<p class="muted">Para usar Mi Caja en otro celular (por ejemplo el de tu mamá), copiá este código y pegalo allá en "Conectar con mi planilla".</p><button class="secondary wide" id="copyCode">${icon('copy', 18)} Copiar código de conexión</button>` : ''}
    <details ${mode !== 'live' ? 'open' : ''}><summary>${mode === 'live' ? 'Cambiar conexión' : 'Conectar con mi planilla real'}</summary>${connectForm()}</details>
    ${mode === 'demo' ? `<label class="check"><input type="checkbox" id="demoOffline" ${store.demoOffline ? 'checked' : ''}> Simular "sin señal" (para probar)</label><button class="link small" id="demoReset">Volver a los datos de ejemplo</button>` : ''}
  </section>
  <h2>Uso sin conexión</h2><section class="box"><p class="muted" id="offlineState">${swReady ? 'Lista: la app abre sin señal y guarda lo que cargues.' : 'Preparando… abrila una vez con señal.'}</p>
    ${!standalone ? '<p class="muted">Para instalarla: en el iPhone, Safari → Compartir → "Agregar a inicio". En Android, menú ⋮ → "Instalar app".</p>' : ''}</section>
  <p class="version">Mi Caja ${VERSION} · ${VERSION_FECHA} <button class="link small" id="checkUpdate">Buscar actualización</button></p>`;
}
function connectForm() {
  return `<form id="connect" class="connect"><label for="cCode">Código de conexión</label><textarea id="cCode" rows="2" placeholder="MC1.…" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
  <p class="muted center">o bien</p>
  <label for="cUrl">Dirección de la aplicación web</label><input id="cUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocorrect="off" spellcheck="false">
  <label for="cTok">Clave</label><input id="cTok" type="password" placeholder="La que muestra «configurar»" autocapitalize="off" autocorrect="off" spellcheck="false">
  <button class="primary wide" type="submit">Conectar</button></form>`;
}
async function connect() {
  let cfg = parseCode($('#cCode').value);
  if (!cfg && $('#cUrl').value.trim()) cfg = { url: $('#cUrl').value.trim(), token: $('#cTok').value.trim() };
  if (!cfg || !cfg.token) { toast('Pegá el código completo, o la dirección y la clave.'); return; }
  if (!validUrl(cfg.url)) { toast('La dirección tiene que ser la de Apps Script y terminar en /exec.'); return; }
  if (store.ops.length && store.config.mode === 'demo' && !confirm('Hay movimientos de ejemplo sin enviar en el modo demo. Quedan en el modo demo y no pasan a tu planilla. ¿Seguir?')) return;
  toast('Probando la conexión…', 8000);
  try { await api.ping({ url: cfg.url, token: cfg.token }); } catch (e) {
    toast(e instanceof ServerError && e.code === 'auth' ? 'La clave no coincide. Revisala.' : `No pude conectar: ${e.message}`, 6000); return;
  }
  await store.setConfig({ mode: 'live', url: cfg.url, token: cfg.token });
  page = 'home'; render();
  const r = await sync();
  toast(r.ok ? 'Conectada. Tus datos ya están en el celular.' : r.error, 5000);
}

// ---------- Bienvenida ----------
function welcome() {
  return `<div class="welcome"><img src="icons/monogram-192.png" width="72" height="72" alt=""><h1>Mi Caja</h1><p>Tus gastos e ingresos, cargados en segundos y guardados en tu planilla de Google. Funciona sin señal.</p>
  <section class="box">${connectForm()}</section>
  <button class="secondary wide" id="demo">${icon('sparkle', 18)} Probar con datos de ejemplo</button>
  <p class="muted center">El modo demo no toca tu planilla.</p></div>`;
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
  const nav = $('#tabbar');
  if (!store.config.mode) { document.body.classList.add('is-welcome'); nav.hidden = true; $('#screen').innerHTML = welcome(); return; }
  document.body.classList.remove('is-welcome'); nav.hidden = false;
  $('#screen').innerHTML = page === 'home' ? home() : page === 'form' ? form() : page === 'history' ? history() : settings();
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  const r = detailId && book.rows.find((x) => x.id === detailId);
  $('#overlay').innerHTML = r ? detail(r) : '';
  document.body.classList.toggle('noscroll', !!r);
  if (page === 'form') updateConversion();
}
function safeRender() {
  const a = document.activeElement;
  if (a && $('#screen').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = true; renderSync(); return; }
  if (page === 'form') capture();
  renderNow();
}

function updateBanner() {
  const b = $('#update');
  b.hidden = !swWaiting;
}

// ---------- eventos ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, [data-close]'); if (!b) return;
  if (b.dataset.page) { navigate(b.dataset.page); return; }
  if (b.dataset.new) { editing = null; draft = {}; mode = b.dataset.new; navigate('form'); return; }
  if (b.dataset.mode) { capture(); mode = b.dataset.mode; draft = { amount: draft.amount, date: draft.date, description: draft.description, notes: draft.notes, account: draft.account }; renderNow(); return; }
  if (b.dataset.cat) { capture(); draft.category = b.dataset.cat; draft.subcategory = ''; draft.priority = undefined; renderNow(); $('#amount') && !$('#amount').value && $('#amount').focus(); return; }
  if (b.dataset.detail) { detailId = b.dataset.detail; renderNow(); return; }
  if (b.dataset.close !== undefined) { detailId = null; renderNow(); return; }
  if (b.dataset.edit) { openEdit(b.dataset.edit); return; }
  if (b.dataset.cancelEdit !== undefined) { navigate('history'); return; }
  if (b.dataset.discard) {
    if (!confirm('¿Descartar este cambio? No se va a guardar en la planilla.')) return;
    await store.discard(b.dataset.discard); detailId = null; toast('Descartado'); return;
  }
  if (b.id === 'sync') { navigate('settings'); return; }
  if (b.id === 'syncNow') { const r = sync(); renderNow(); const x = await r; toast(x.ok ? 'Todo al día' : x.error, 4000); return; }
  if (b.id === 'retry') { await store.retryFailed(); sync(); return; }
  if (b.id === 'more') { showCount += 200; renderNow(); return; }
  if (b.id === 'demo') { await store.setConfig({ mode: 'demo' }); page = 'home'; renderNow(); await sync(); return; }
  if (b.id === 'demoReset') { if (!confirm('¿Borrar lo cargado en el modo demo y volver a los datos de ejemplo?')) return; for (const o of [...store.ops]) await store.discard(o.id); await store.setKV('mock:demo', null); resetDemo(); await sync(); toast('Datos de ejemplo restablecidos'); return; }
  if (b.id === 'copyCode') { const code = makeCode(store.config.url, store.config.token); try { await navigator.clipboard.writeText(code); toast('Código copiado. Pegalo en el otro celular.'); } catch { prompt('Copiá este código:', code); } return; }
  if (b.id === 'export') {
    const blob = new Blob([JSON.stringify({ app: 'Mi Caja', version: VERSION, exportedAt: new Date().toISOString(), pendientes: store.ops }, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = `mi-caja-pendientes-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); return;
  }
  if (b.id === 'checkUpdate') { const reg = await navigator.serviceWorker?.getRegistration(); if (!reg) { toast('Sin actualizaciones'); return; } await reg.update().catch(() => {}); setTimeout(() => toast(swWaiting ? 'Hay una versión nueva arriba.' : 'Ya tenés la última versión.'), 1500); return; }
  if (b.id === 'applyUpdate') { if (page === 'form' && ($('#amount')?.value || editing)) { toast('Guardá o cancelá la carga antes de actualizar.'); return; } swWaiting && swWaiting.postMessage('SKIP_WAITING'); return; }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'connect') { await connect(); return; }
  if (e.target.id !== 'entry' || busy) return;
  busy = true; $('#save').disabled = true;
  try { await save(e.target); } catch (err) { const el = $('#formError'); if (el) el.textContent = err.message; const s = $('#save'); if (s) s.disabled = false; } finally { busy = false; }
});
function cleanDecimalField(input) {
  const raw = input.value, clean = normalizeDecimalInput(raw);
  if (clean !== raw) { const st = input.selectionStart; input.value = clean; if (st != null) { const p = normalizeDecimalInput(raw.slice(0, st)).length; input.setSelectionRange(p, p); } }
}
document.addEventListener('input', (e) => {
  if (['amount', 'exchangeRate'].includes(e.target.id)) { if (!e.isComposing) cleanDecimalField(e.target); updateConversion(); }
  if (e.target.id === 'q') { filters.q = e.target.value; clearTimeout(window.__qt); window.__qt = setTimeout(() => { const pos = e.target.selectionStart; renderNow(); const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }, 250); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (e.target.name === 'currency' || id === 'account' || id === 'category') {
    capture();
    if (id === 'account') draft.payment = defaultPayment(e.target.value);
    if (id === 'category') { draft.subcategory = ''; draft.priority = undefined; }
    renderNow(); return;
  }
  if (id === 'fMonth') { filters.month = e.target.value; showCount = 120; renderNow(); }
  if (id === 'fType') { filters.type = e.target.value; showCount = 120; renderNow(); }
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
    reg.addEventListener('updatefound', () => { const sw = reg.installing; sw && sw.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) ask(sw); if (sw.state === 'activated') { swReady = true; if (page === 'settings') safeRender(); } }); });
    navigator.serviceWorker.ready.then(() => { swReady = true; if (page === 'settings') safeRender(); });
    setInterval(() => reg.update().catch(() => {}), 3600000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloaded) return; reloaded = true; location.reload(); });
}

async function boot() {
  try { await store.init(); } catch { $('#screen').innerHTML = '<h1>No se pudo abrir el almacenamiento</h1><p>Mi Caja necesita permiso para guardar datos en este navegador.</p>'; return; }
  store.subscribe(safeRender);
  renderNow();
  startAutoSync();
  if (store.config.mode) sync({ quiet: !!store.snapshot });
  registerSW();
  window.__mc = { store, sync }; // para pruebas
}
boot();
