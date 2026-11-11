// Arma gas/Code.gs (servidor para pegar en Apps Script) y sella sw.js con la lista de archivos y una versión nueva.
// Uso: node tools/build.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1) Code.gs = lógica compartida (sin "export") + adaptador de Apps Script
const core = read('js/core.js').replace(/\/\* EXPORTS:BEGIN \*\/[\s\S]*?\/\* EXPORTS:END \*\//, '').trim();
const version = read('js/version.js').match(/VERSION = '([^']+)'/)[1];
const gs = `// Mi Caja · servidor de la planilla (Apps Script) · versión ${version}\n// Archivo generado: no editar a mano. Fuente: js/core.js + tools/gas-adapter.js (repo el-ten/mi-caja).\n\n${core}\n\n${read('tools/gas-adapter.js')}`;
writeFileSync(join(root, 'gas/Code.gs'), gs);

// 2) sw.js: lista de archivos de la app + sello de versión (cambia si cambia cualquier archivo)
const files = [];
const walk = (d) => { for (const n of readdirSync(join(root, d))) { const p = d ? `${d}/${n}` : n; if (statSync(join(root, p)).isDirectory()) walk(p); else files.push(p); } };
for (const d of ['css', 'js', 'icons']) walk(d);
files.push('index.html', 'manifest.webmanifest');
files.sort();
const h = createHash('sha256');
for (const f of files) h.update(f).update(readFileSync(join(root, f)));
const build = h.digest('hex').slice(0, 10);
const sw = read('sw.js').replace(/\/\* STAMP:BEGIN \*\/[\s\S]*?\/\* STAMP:END \*\//, `/* STAMP:BEGIN */\nconst BUILD = '${build}';\nconst SHELL = ${JSON.stringify(['./', ...files])};\n/* STAMP:END */`);
writeFileSync(join(root, 'sw.js'), sw);
console.log(`Code.gs ${gs.length} bytes · sw build ${build} · ${files.length} archivos`);
