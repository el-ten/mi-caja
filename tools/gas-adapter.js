// ===================== Apps Script (planilla real) =====================
// Pasos (una sola vez): abrir el proyecto "Mi Caja · servidor" en script.google.com (o pegar este archivo en Extensiones → Apps Script), ejecutar "configurar",
// e Implementar → Nueva implementación → Aplicación web (Ejecutar como: yo · Acceso: cualquier persona).

// Solo para la instalación original (proyecto aparte, no pegado dentro de la planilla). Las copias de la
// planilla modelo usan su propio programa desde Extensiones → Apps Script y no necesitan esto.
var MC_PLANILLA = '1QIixkftqfa8VzWSS3EiCBYFAnO_cSU1UcbyhQLHtaLM';
var MC_HOJAS = { mov: '01_MOVIMIENTOS', conf: '03_CONFIGURACION', aju: '04_APP_AJUSTES', ini: '05_APP_INICIO', cue: '06_APP_CUENTAS', cat: '07_APP_CATEGORIAS' };

function mcJson(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() { return ContentService.createTextOutput('Mi Caja: servidor activo. Esta dirección se usa desde la app.'); }

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return mcJson({ ok: false, error: 'Pedido ilegible.', code: 'bad' }); }
  var token = PropertiesService.getScriptProperties().getProperty('MC_TOKEN');
  if (!token) return mcJson({ ok: false, error: 'Falta ejecutar "configurar" en Apps Script.', code: 'config' });
  var lock = null;
  try {
    if (body && body.token === token && body.action === 'write') {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) return mcJson({ ok: false, error: 'La planilla está ocupada. Se reintenta solo.', code: 'busy' });
    }
    var db = mcDb(body && body.sheet);
    // Al conectar, se comprueba que la planilla se pueda abrir y tenga las hojas de Mi Caja.
    if (body && body.token === token && body.action === 'ping') db.check();
    return mcJson(coreHandle(db, body, token));
  } catch (err) {
    return mcJson({ ok: false, error: String((err && err.message) || err), code: 'server' });
  } finally {
    if (lock) { SpreadsheetApp.flush(); lock.releaseLock(); }
  }
}

// Genera la clave (si no existe) y la muestra en el registro de ejecución.
function configurar() {
  var p = PropertiesService.getScriptProperties();
  var t = p.getProperty('MC_TOKEN');
  if (!t) { t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); p.setProperty('MC_TOKEN', t); }
  // Si el programa está dentro de la planilla, se prueba leerla. Si es un proyecto aparte, la planilla la indica la app.
  if (SpreadsheetApp.getActiveSpreadsheet()) mcDb().mov();
  console.log('Clave de Mi Caja: ' + t);
  console.log('Ahora: Implementar → Nueva implementación → Aplicación web (Ejecutar como: yo · Acceso: cualquier persona).');
}

// Si la clave se filtró: genera otra. Después hay que volver a conectar los celulares.
function nuevaClave() { PropertiesService.getScriptProperties().deleteProperty('MC_TOKEN'); configurar(); }

// Saca el ID de un link de Google Sheets (o acepta el ID solo).
function mcSheetId(v) { var m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(String(v || '')); return m ? m[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(String(v || '').trim()) ? String(v).trim() : ''); }

function mcDb(sheetHint) {
  // Qué planilla usar: 1) la que contiene este programa (Extensiones → Apps Script);
  // 2) la que manda la app (link de la planilla, cuando el programa es un proyecto aparte); 3) la instalación original.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss && sheetHint) {
    var id = mcSheetId(sheetHint);
    try { ss = SpreadsheetApp.openById(id); } catch (e) { throw new Error('No pude abrir tu planilla: revisá el link que pegaste en la app.'); }
  }
  if (!ss) {
    try { ss = SpreadsheetApp.openById(MC_PLANILLA); } catch (e) {
      throw new Error('Falta indicar tu planilla: en la app, al conectar, pegá también el link de tu planilla.');
    }
  }
  var tz = ss.getSpreadsheetTimeZone();
  var cache = {};
  function hoja(k) { var h = ss.getSheetByName(MC_HOJAS[k]); if (!h) throw new Error('No encuentro la hoja ' + MC_HOJAS[k]); return h; }
  function limpiar(v) { return Object.prototype.toString.call(v) === '[object Date]' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v; }
  function filas(k, cols) {
    if (cache[k]) return cache[k];
    var h = hoja(k), last = h.getLastRow();
    var data = last >= 2 ? h.getRange(2, 1, last - 1, cols).getValues() : [];
    // se cortan las filas vacías del final (pueden tener formato o desplegables, pero no datos)
    var n = data.length; while (n > 0 && String(data[n - 1][0]).trim() === '') n--;
    cache[k] = data.slice(0, n).map(function (r) { return r.map(limpiar); });
    return cache[k];
  }
  function escribir(k, cols, formatos, index, fila) {
    var h = hoja(k), lista = filas(k, cols);
    var i = index == null ? lista.length : index;
    var rowNum = i + 2;
    if (rowNum > h.getMaxRows()) h.insertRowsAfter(h.getMaxRows(), rowNum - h.getMaxRows());
    var rango = h.getRange(rowNum, 1, 1, cols);
    rango.setValues([fila]);
    for (var c in formatos) h.getRange(rowNum, Number(c)).setNumberFormat(formatos[c]);
    var guardada = fila.map(function (v, j) { return j === 1 && typeof v === 'number' ? coreIso(v) : v; });
    if (index == null) lista.push(guardada); else lista[index] = guardada;
  }
  return {
    check: function () { for (var k in MC_HOJAS) hoja(k); },
    mov: function () { return filas('mov', 18); },
    aju: function () { return filas('aju', 7); },
    inicio: function () {
      var d = hoja('ini').getRange(2, 1, Math.max(1, hoja('ini').getLastRow() - 1), 7).getValues().map(function (r) { return r.map(limpiar); });
      for (var i = 0; i < d.length; i++) if (String(d[i][0]) === 'INICIO') return d[i];
      return null;
    },
    cuentas: function () { var h = hoja('cue'); return h.getLastRow() >= 2 ? h.getRange(2, 1, h.getLastRow() - 1, 4).getValues() : []; },
    categorias: function () { var h = hoja('cat'); return h.getLastRow() >= 2 ? h.getRange(2, 1, h.getLastRow() - 1, 6).getValues() : []; },
    pagos: function () { return hoja('conf').getRange('E1:E7').getValues().map(function (r) { return r[0]; }); },
    subcats: function () {
      try {
        var v = hoja('mov').getRange('F2').getDataValidation();
        var c = v && v.getCriteriaValues();
        return c && Array.isArray(c[0]) ? c[0] : [];
      } catch (e) { return []; }
    },
    writeMov: function (index, fila) { escribir('mov', 18, { 2: 'dd/MM/yyyy', 3: 'mmmm yyyy', 10: '#,##0.00', 11: '"$ " #,##0.00', 12: '"$ " #,##0.00' }, index, fila); },
    writeAju: function (index, fila) { escribir('aju', 7, { 2: 'dd/MM/yyyy', 5: '"$ " #,##0.00' }, index, fila); },
    getProp: function (k) { return PropertiesService.getScriptProperties().getProperty('MC_' + k); },
    setProp: function (k, v) { PropertiesService.getScriptProperties().setProperty('MC_' + k, v); },
  };
}
