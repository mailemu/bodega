// Mailemu Bodega · app web (pantalla de Bodega + consulta y corrección)
// JS sin compilación. Toda escritura va por las funciones de Postgres (bodega/sql/03 y 07);
// la app solo lee tablas y vistas. La clave de abajo es la pública (anon): puede estar en el código.
'use strict';

const SUPABASE_URL = 'https://xaemkkygdmqhslwtsbgm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhhZW1ra3lnZG1xaHNsd3RzYmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MDk4MjksImV4cCI6MjExMDA4NTgyOX0.LXhd2hJeI9VTWqbL6Kini1RuT1ErkD0LX5ZEq5USCs8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mailemu-bodega' },
});

const VARIEDADES = { ulmo: 'Ulmo', bosque_nativo: 'Bosque Nativo', quillay: 'Quillay' };
const CADENAS = { jumbo: 'Jumbo', santa_isabel: 'Santa Isabel', lider: 'Líder', tottus: 'Tottus' };
const CDS = { el_penon: 'El Peñón', lo_aguirre: 'Lo Aguirre' };
const DESTINOS = { mercado_libre: 'Mercado Libre', creado_en_chile: 'Creado en Chile', berni: 'Berni (web y otros)', cliente: 'Cliente', supermercado: 'Supermercado' };
const TIPOS_OP = { envasar: 'Envasado', encajar: 'Encajado', desarmar: 'Caja desarmada', armar_pack: 'Pack armado', preparar: 'Pistoleado en pedido', retiro: 'Retiro', ajuste: 'Conteo o ajuste', anulacion: 'Deshecho' };
// La app sugiere; quien sube la factura decide (Jumbo y Santa Isabel comparten RUT).
const RUT_CADENA = {
  '76042014-K': { sugerida: 'lider', texto: 'RUT de Walmart: sugerencia Líder. Marca también el CD.' },
  '81201000-K': { sugerida: null, texto: 'RUT de Cencosud: Jumbo y Santa Isabel comparten RUT. Márcala tú.' },
};
const TITULOS = { inicio: 'Bodega', envasar: 'Envasar', encajar: 'Encajar', pack: 'Encajar', pedidos: 'Por retirar', preparar: 'Preparar pedido',
  factura: 'Subir factura', pedido: 'Nuevo pedido', stock: 'Stock', tambores: 'Tambores', historial: 'Historial', conteo: 'Conteo de inventario',
  codigo: 'Registrar código', ayuda: 'Ayuda', config: 'Configuración' };
const PADRE = { preparar: 'pedidos', pedido: 'pedidos' }; // el resto vuelve al menú
// Al editar un pedido, la pantalla de arriba es ese mismo pedido
const padreDe = (p, ctx) => (p === 'pedido' && ctx && ctx.id ? 'preparar' : PADRE[p] || 'inicio');

const E = {
  usuaria: null, nombre: '', nombres: new Map(), productos: new Map(), codigos: new Map(), tambores: [],
  log: [], logId: 0, pantalla: null, ctx: {}, volverA: null, factura: null, mult: 1, avisosVistos: new Set(), ultimoEncajable: null,
};

const app = document.getElementById('app');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 1 });
const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const fechaCorta = (d) => (d ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const quien = (email) => E.nombres.get(email) || email || '';
const plural = (n, uno, varios) => `${num(n)} ${Math.abs(n) === 1 ? uno : varios}`;

// ───────── Utilidades ─────────

let audio;
function pitido(ok) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.type = ok ? 'sine' : 'square'; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.15;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.35));
  } catch { /* sin sonido */ }
}

// Aviso flotante. Con `accion` muestra un botón (ej. "Deshacer").
function aviso(texto, tipo = 'info', accion = null) {
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo;
  d.innerHTML = `<span>${enlazar(esc(texto))}</span>${accion ? `<button type="button">${esc(accion.texto)}</button>` : ''}<button type="button" class="cerrar" aria-label="Cerrar">×</button>`;
  d.querySelector('.cerrar').onclick = () => d.remove();
  if (accion) d.querySelector('button').onclick = () => { d.remove(); accion.fn(); };
  $('#avisos').appendChild(d);
  setTimeout(() => d.remove(), accion ? 12000 : tipo === 'error' || tipo === 'alerta' ? 8000 : 4500);
}
const avisosDe = (r) => (r?.avisos || []).forEach((a) => aviso(a, 'alerta'));

// Ventana de confirmación propia: admite una casilla ("no volver a mostrar") y campos (alAceptar lee sus valores).
// No pone el foco en "Aceptar", para que un Enter de la pistola no la confirme sin querer.
function dialogo({ titulo, html, aceptar = 'Aceptar', cancelar = 'Cancelar', casilla = null, alAceptar = null }) {
  return new Promise((resolver) => {
    const fondo = document.createElement('div'); fondo.className = 'dialogo-fondo';
    fondo.innerHTML = `<div class="dialogo" role="dialog" aria-modal="true"><h3>${esc(titulo)}</h3><div class="cuerpo">${html}</div>
      ${casilla ? `<label class="check"><input type="checkbox" class="dlg-casilla"> ${esc(casilla)}</label>` : ''}
      <div class="fila-botones"><button type="button" class="dlg-ok">${esc(aceptar)}</button>${cancelar ? `<button type="button" class="sec dlg-no">${esc(cancelar)}</button>` : ''}</div></div>`;
    document.body.appendChild(fondo);
    const cerrar = (ok) => {
      const r = { ok, casilla: !!fondo.querySelector('.dlg-casilla')?.checked, valor: ok && alAceptar ? alAceptar(fondo) : null };
      fondo.remove(); resolver(r);
    };
    fondo.querySelector('.dlg-ok').onclick = () => cerrar(true);
    const no = fondo.querySelector('.dlg-no'); if (no) no.onclick = () => cerrar(false);
  });
}

// Aviso que se muestra hasta que la usuaria marque "No volver a mostrar" (se recuerda por usuaria en este aparato)
async function avisoPrimeraVez(clave, titulo, html) {
  const k = `no_mostrar_${clave}_${E.usuaria}`;
  if (leer(k) === '1') return true;
  const r = await dialogo({ titulo, html, aceptar: 'Sí, continuar', casilla: 'No volver a mostrar este mensaje' });
  if (r.ok && r.casilla) guardar(k, '1');
  return r.ok;
}

// Cantidad por lectura (×1, ×10, ×12 u otra): vale para la próxima lectura y después vuelve a ×1
function htmlMultiplicador() {
  return `<div class="mult" id="mult"></div>`;
}
function pintarMult() {
  const m = $('#mult'); if (!m) return;
  if (E.multEditando) { // "Otra": la cantidad se escribe ahí mismo
    m.innerHTML = `<span>Cada lectura vale</span><input type="number" id="multOtra" min="1" max="500" inputmode="numeric" placeholder="¿Cuántos?" aria-label="Cantidad por lectura">
      <button type="button" class="mini elegida" data-mult="ok">Listo</button><button type="button" class="mini" data-mult="cancelar">Cancelar</button>`;
    const i = $('#multOtra'); i.focus();
    i.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); aplicarOtra(); }
      if (ev.key === 'Escape') { E.multEditando = false; pintarMult(); enfocarScan(); }
    };
    return;
  }
  const fijo = [1, 10, 12].includes(E.mult);
  m.innerHTML = `<span>Cada lectura vale</span>${[1, 10, 12].map((n) => `<button type="button" class="mini ${E.mult === n ? 'elegida' : ''}" data-mult="${n}">×${n}</button>`).join('')}
    <button type="button" class="mini ${fijo ? '' : 'elegida'}" data-mult="otra">${fijo ? 'Otra' : '×' + E.mult}</button>
    ${E.mult > 1 ? '<span class="chico">(solo la próxima lectura)</span>' : ''}`;
}
const enfocarScan = () => { const s = $('#scan'); if (s) s.focus({ preventScroll: true }); };
function aplicarOtra() {
  const n = parseInt($('#multOtra')?.value, 10);
  E.multEditando = false; E.mult = n >= 1 && n <= 500 ? n : 1; pintarMult(); enfocarScan();
}
function tomarMult() { const n = E.mult; if (n !== 1) { E.mult = 1; pintarMult(); } return n; }
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-mult]'); if (!b) return;
  const v = b.dataset.mult;
  if (v === 'otra') { E.multEditando = true; pintarMult(); return; }
  if (v === 'ok') { aplicarOtra(); return; }
  if (v === 'cancelar') { E.multEditando = false; pintarMult(); enfocarScan(); return; }
  E.mult = Number(v); pintarMult(); enfocarScan();
});

function mensaje(e) {
  const m = e?.message || String(e);
  if (/failed to fetch|networkerror|load failed|network request/i.test(m)) return 'Sin conexión: no se grabó. Revisa internet y vuelve a intentarlo.';
  if (/jwt expired|invalid jwt/i.test(m)) return 'La sesión venció. Sal y vuelve a entrar.';
  return m;
}

async function rpc(fn, args = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { const e = new Error(error.message || 'Error'); e.codigo = error.hint; throw e; }
  return data;
}
async function consulta(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

function resumenCant(cj, u) {
  return [cj ? plural(cj, 'caja', 'cajas') : '', u ? plural(u, 'unidad', 'unidades') : ''].filter(Boolean).join(' + ') || 'sin productos';
}
// "37 cajas + 4 sueltas" o "12 unidades" según el producto
function textoStock(p, sueltas, cajas) {
  if (p.caja_controlada) {
    return [cajas ? plural(cajas, 'caja', 'cajas') : '', sueltas ? plural(sueltas, 'suelta', 'sueltas') : ''].filter(Boolean).join(' + ') || '0';
  }
  if (p.id === 'pack') return plural(sueltas, 'pack', 'packs');
  if (!p.uds_por_caja) return plural(sueltas, 'balde', 'baldes');
  return plural(sueltas, 'unidad', 'unidades');
}
const nombreTambor = (t) => (t.identificacion ? t.identificacion : `N.º ${t.id}`);
// Palabra para las unidades sueltas de cada producto
const unidadDe = (p) => (p.caja_controlada ? ['suelta', 'sueltas'] : p.id === 'pack' ? ['pack', 'packs'] : !p.uds_por_caja ? ['balde', 'baldes'] : ['unidad', 'unidades']);

// Guía plegable "Cómo se hace" (se recuerda si la usuaria la cerró)
function guia(clave, pasos) {
  const cerrada = leer('guia_' + clave) === '1';
  return `<details class="guia" data-guia="${clave}" ${cerrada ? '' : 'open'}><summary>Cómo se hace</summary><ol>${pasos.map((p) => `<li>${enlazar(p)}</li>`).join('')}</ol></details>`;
}

// Accesos directos: el nombre de una sección en un texto lleva a esa sección con un toque.
// En textos con formato, "<b>Tambores</b>"; en avisos y lecturas, el nombre escrito tal cual.
const ATAJOS = [['Conteo de inventario', 'conteo'], ['Registrar código', 'codigo'], ['Encajar y packs', 'encajar'], ['Nuevo pedido', 'pedido'],
  ['Subir factura', 'factura'], ['Por retirar', 'pedidos'], ['Configuración', 'config'], ['Tambores', 'tambores'], ['Historial', 'historial'],
  ['Envasar', 'envasar'], ['Encajar', 'encajar'], ['Armar pack', 'encajar'], ['Stock', 'stock'], ['Ayuda', 'ayuda']];
const ATAJOS_TEXTO = ['Conteo de inventario', 'Registrar código', 'Encajar', 'Nuevo pedido', 'Subir factura', 'Por retirar', 'Configuración', 'Tambores', 'Historial'];
function enlazar(html) {
  const link = (t) => { const a = ATAJOS.find(([n]) => n === t); return a ? `<a href="#" class="atajo" data-ir="${a[1]}">${t}</a>` : null; };
  let s = String(html).replace(/<b>([^<]+)<\/b>/g, (m, t) => link(t) || m);
  if (!s.includes('<')) { // solo en texto plano (avisos y lecturas): nunca dentro de etiquetas
    const re = new RegExp(`(^|[^\\wáéíóúñ])(${ATAJOS_TEXTO.join('|')})(?=$|[^\\wáéíóúñ])`, 'g');
    s = s.replace(re, (m, pre, t) => pre + link(t));
  }
  return s;
}
function activarGuias() {
  document.querySelectorAll('details.guia').forEach((d) => d.addEventListener('toggle', () => guardar('guia_' + d.dataset.guia, d.open ? '0' : '1')));
}

// Cola: cada acción se graba en orden, una tras otra.
let cola = Promise.resolve();
function encolar(fn) {
  cola = cola.then(fn).catch((e) => {
    if ($('#log')) registrar(false, mensaje(e)); else { pitido(false); aviso(mensaje(e), 'error'); }
    if (e.desconocido) pintarDesconocido(e.desconocido);
  });
  return cola;
}

// ───────── Pistola y registro de lecturas (con Deshacer) ─────────

function htmlPistola(texto, extra = '') {
  return `<div class="pistola">
    <label for="scan">${esc(texto)}</label>${extra}
    <div class="fila">
      <input id="scan" inputmode="none" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Esperando la pistola…">
      <button type="button" class="sec" id="manual">Escribir a mano</button>
    </div>
    <ul class="sugerencias" id="sugerencias"></ul>
    <div class="estado" id="estadoScan"></div>
  </div>
  <div id="desc"></div>
  <ul id="log" class="log"></ul>`;
}

// Búsqueda de productos por nombre mientras se escribe ("balde", "ulmo 1kg", "bn 300"...), sin acentos ni mayúsculas
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(\d)\s*(kg|g)\b/g, '$1$2');
function buscarProductos(q, filtro = null) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return [...E.productos.values()].filter((p) => p.activo && (!filtro || filtro(p))).filter((p) => {
    const texto = `${norm(p.nombre)} ${p.variedad === 'bosque_nativo' ? 'bn' : ''} ${p.id === 'pack' ? 'pack variedades' : ''}`;
    const palabras = texto.split(/[\s,()×]+/);
    return toks.every((t) => palabras.some((w) => w.startsWith(t)) || (t.length >= 3 && texto.includes(t)));
  }).slice(0, 8);
}

// alLeer(código): lo que hace la pantalla con un código. alElegir(producto): con un producto elegido por nombre (opcional).
// filtro(producto): limita las sugerencias (ej.: solo lo que lleva el pedido).
function activarPistola(alLeer, alElegir = null, filtro = null) {
  const inp = $('#scan'); if (!inp) return;
  let manual = false;
  const estado = () => {
    const s = $('#estadoScan'); if (!s) return;
    s.textContent = document.activeElement !== inp ? 'Toca el recuadro para volver a pistolear.'
      : manual ? (alElegir ? 'Escribe el código y aprieta Enter, o el nombre del producto y elígelo.' : 'Escribe el código y aprieta Enter.') : '';
  };
  const sug = $('#sugerencias');
  const limpiarSug = () => { if (sug) sug.innerHTML = ''; };
  const salirManual = () => { manual = false; inp.setAttribute('inputmode', 'none'); inp.placeholder = 'Esperando la pistola…'; };
  const elegir = (p) => { inp.value = ''; limpiarSug(); salirManual(); encolar(() => alElegir(p)); inp.blur(); };
  const pintarSug = () => {
    if (!sug) return;
    const q = inp.value.trim();
    if (!alElegir || !/[a-zñ]/i.test(q)) { limpiarSug(); return; } // la pistola solo manda números: así no parpadea
    const ps = buscarProductos(q, filtro);
    sug.innerHTML = ps.length ? ps.map((p) => `<li><button type="button" data-sug="${p.id}">${esc(p.nombre)}</button></li>`).join('')
      : `<li class="chico">${filtro ? 'Ningún producto de este pedido con ese nombre.' : 'Ningún producto con ese nombre.'}</li>`;
    sug.querySelectorAll('[data-sug]').forEach((b) => { b.onmousedown = (ev) => ev.preventDefault(); b.onclick = () => elegir(E.productos.get(b.dataset.sug)); });
  };
  const enfocar = () => {
    if ($('#scan') !== inp) return; // ya se cambió de pantalla
    const a = document.activeElement;
    if (a && a !== inp && a.matches('input, select, textarea')) { estado(); return; } // no robar el foco a otro campo
    inp.focus({ preventScroll: true }); estado();
  };
  inp.addEventListener('input', pintarSug);
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { inp.value = ''; limpiarSug(); return; }
    if (ev.key !== 'Enter' && ev.key !== 'Tab') return;
    ev.preventDefault();
    const v = inp.value.trim();
    if (alElegir && /[a-zñ]/i.test(v)) { const ps = buscarProductos(v, filtro); if (ps.length) elegir(ps[0]); return; } // Enter con texto = primera sugerencia
    inp.value = ''; limpiarSug();
    if (v) encolar(() => alLeer(v));
    if (manual) { salirManual(); inp.blur(); }
  });
  inp.addEventListener('focus', estado);
  inp.addEventListener('blur', () => setTimeout(() => {
    // Si dejó "Escribir a mano" sin terminar, vuelve al modo pistola (si no, el teclado reaparece cada vez)
    if (manual && document.activeElement !== inp) { salirManual(); limpiarSug(); }
    enfocar();
  }, 150));
  $('#manual').onclick = () => {
    manual = true; inp.setAttribute('inputmode', 'text');
    inp.placeholder = alElegir ? 'Código o producto (ej.: balde)' : 'Escribe el código';
    inp.blur(); setTimeout(() => { inp.focus(); estado(); }, 30);
  };
  enfocar(); pintarLog();
}

// extra.op = id de la operación (permite "Deshacer"); extra.alDeshacer = qué refrescar después
function registrar(ok, texto, extra = {}) {
  E.log.unshift({ id: ++E.logId, ok, texto, op: extra.op || null, alDeshacer: extra.alDeshacer || null, deshecho: false,
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) });
  E.log = E.log.slice(0, 10);
  pitido(ok); pintarLog();
}
function pintarLog() {
  const ul = $('#log'); if (!ul) return;
  // Vacío hasta la primera lectura. Lo deshecho queda tachado, chico y sin hora.
  ul.innerHTML = E.log.map((l) => (l.deshecho
    ? `<li class="deshecho"><div class="txt">${esc(l.texto)}</div></li>`
    : `<li class="${l.ok ? 'ok' : 'mal'}"><div class="txt"><span class="hora">${esc(l.hora)}</span>${enlazar(esc(l.texto))}</div>
      ${l.op ? `<button type="button" class="mini sec" data-deshacer="${l.id}">Deshacer</button>` : ''}</li>`)).join('');
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-deshacer]'); if (!b) return;
  const l = E.log.find((x) => x.id === Number(b.dataset.deshacer)); if (!l || l.deshecho) return;
  if (!confirm(`¿Deshacer esto?\n\n${l.texto}`)) return;
  encolar(async () => {
    await rpc('op_anular', { p_operacion: l.op, p_motivo: `Deshecho al momento por ${E.nombre}` });
    l.deshecho = true; pintarLog(); pitido(true); aviso('Listo, se deshizo.', 'ok');
    if (l.alDeshacer) await l.alDeshacer();
  });
});

// Si la pistola "escribe" cuando el recuadro no tiene el foco (por ejemplo, tras una pregunta), los números se mandan igual al recuadro
document.addEventListener('keydown', (ev) => {
  const inp = $('#scan'); const a = document.activeElement;
  if (!inp || a === inp || (a && a.matches('input, select, textarea'))) return;
  if (/^[0-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    ev.preventDefault(); inp.value += ev.key; inp.focus({ preventScroll: true });
  }
});

function pintarDesconocido(cod) {
  const d = $('#desc'); if (!d) return;
  E.volverA = { p: E.pantalla, id: E.ctx.id };
  d.innerHTML = `<button type="button" class="sec ancho" data-ir="codigo" data-codigo="${esc(cod)}">La app no conoce el código ${esc(cod)}: registrarlo</button>`;
}

function buscarCodigo(cod) {
  const c = E.codigos.get(cod);
  if (!c) { const e = new Error(`Código desconocido: ${cod}`); e.desconocido = cod; throw e; }
  return { tipo: c.tipo, p: E.productos.get(c.producto_id) };
}

// ───────── Datos base ─────────

async function cargarBase() {
  const [p, c, u] = await Promise.all([
    consulta(sb.from('productos').select('*').order('orden')),
    consulta(sb.from('codigos').select('*')),
    consulta(sb.from('usuarias').select('*')),
  ]);
  E.productos = new Map(p.map((x) => [x.id, x]));
  E.codigos = new Map(c.map((x) => [x.codigo, x]));
  E.nombres = new Map(u.map((x) => [x.email, x.nombre]));
  await cargarTambores();
}
async function cargarTambores() {
  E.tambores = await consulta(sb.from('v_tambores').select('*').eq('estado', 'abierto').order('abierto_en', { ascending: false }));
}
function tamborDe(variedad) {
  const abiertos = E.tambores.filter((t) => t.variedad === variedad);
  if (!abiertos.length) return null;
  const elegido = Number(leer('tambor_' + variedad));
  return abiertos.find((t) => t.id === elegido) || abiertos[0]; // por defecto, el abierto más reciente
}

// ───────── Navegación (con flecha y con el botón "atrás" del celular) ─────────

const PANTALLAS = {};
// reemplazar: tras retirar, anular o cargar, la pantalla anterior ya no sirve; "atrás" no debe volver a ella
function ir(p, ctx = {}, { historial = true, reemplazar = false } = {}) {
  if (p === 'codigo' && !ctx.codigo) E.volverA = null; // entrada desde el menú: no volver a otra pantalla
  const desde = E.pantalla;
  E.pantalla = p; E.ctx = { ...ctx }; E.log = []; E.mult = 1; E.multEditando = false; E.avisosVistos = new Set();
  if (reemplazar) history.replaceState({ p, ctx, desde: history.state && history.state.desde }, '', '#' + p);
  else if (historial) history.pushState({ p, ctx, desde }, '', '#' + p);
  window.scrollTo(0, 0); pintarCabecera();
  Promise.resolve(PANTALLAS[p](E.ctx)).then(activarGuias).catch((e) => aviso(mensaje(e), 'error'));
}
window.addEventListener('popstate', (ev) => {
  if (!E.usuaria) return;
  const s = ev.state || { p: 'inicio', ctx: {} };
  ir(PANTALLAS[s.p] ? s.p : 'inicio', s.ctx || {}, { historial: false });
});
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ir]'); if (!b || !E.usuaria) return;
  ev.preventDefault();
  ir(b.dataset.ir, { id: b.dataset.id ? Number(b.dataset.id) : undefined, codigo: b.dataset.codigo });
});

function pintarCabecera() {
  const enInicio = !E.usuaria || E.pantalla === 'inicio';
  const padre = padreDe(E.pantalla, E.ctx);
  $('#cab').innerHTML = `
    ${enInicio ? '' : `<button type="button" class="volver" id="btnVolver">← ${padre === 'inicio' ? 'Menú' : TITULOS[padre]}</button>`}
    <div class="titulo">${enInicio ? 'Mailemu <span>Bodega</span>' : esc(TITULOS[E.pantalla] || '')}</div>
    ${E.usuaria ? `<div class="quien"><span>${esc(E.nombre)}</span><button class="enlace" id="salir">Salir</button></div>` : ''}`;
  const s = $('#salir');
  if (s) s.onclick = async () => { if (confirm('¿Cerrar sesión en este aparato?')) await sb.auth.signOut(); };
  // La flecha sigue el mismo camino que el botón "atrás" del celular cuando se llegó desde la pantalla de arriba
  const v = $('#btnVolver');
  if (v) v.onclick = () => { if (history.state && history.state.desde === padre) history.back(); else ir(padre, padre === 'preparar' ? { id: E.ctx.id } : {}); };
}

// ───────── Sesión ─────────

async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaLogin();
  E.usuaria = session.user.email.toLowerCase();
  try {
    if (!(await rpc('es_usuaria'))) {
      pintarCabecera();
      app.innerHTML = `<div class="tarjeta"><p class="error">La cuenta ${esc(E.usuaria)} no está autorizada para la bodega.</p><p class="nota">Pídele a Berni que la agregue.</p></div>`;
      return;
    }
    await cargarBase();
    E.nombre = E.nombres.get(E.usuaria) || E.usuaria;
    history.replaceState({ p: 'inicio', ctx: {} }, '', '#inicio');
    ir('inicio', {}, { historial: false });
  } catch (e) {
    pintarCabecera();
    app.innerHTML = `<div class="tarjeta"><p class="error">${esc(mensaje(e))}</p><button onclick="location.reload()">Reintentar</button></div>`;
  }
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') pantallaLogin(); });

function pantallaLogin() {
  E.usuaria = null; E.pantalla = null; pintarCabecera();
  app.innerHTML = `<form class="tarjeta login" id="fLogin">
    <h1>Bodega Mailemu</h1>
    <p class="nota">Entra con tu correo de Mailemu y tu contraseña. Queda guardado en este aparato.</p>
    <label>Correo<input type="email" name="email" autocomplete="username" required value="${esc(leer('ultimo_correo') || '')}"></label>
    <label>Contraseña<input type="password" name="clave" autocomplete="current-password" required></label>
    <button type="submit">Entrar</button>
    <p class="error" id="errLogin"></p>
  </form>`;
  $('#fLogin').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target); const b = ev.target.querySelector('button');
    const email = String(f.get('email')).trim().toLowerCase();
    b.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: String(f.get('clave')) });
    b.disabled = false;
    if (error) { $('#errLogin').textContent = /invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.' : mensaje(error); return; }
    guardar('ultimo_correo', email);
    iniciar();
  };
}

// ───────── Menú ─────────

PANTALLAS.inicio = async () => {
  app.innerHTML = `<p class="saludo">Hola, ${esc(E.nombre)}. ¿Qué vas a hacer?</p>
  <div id="primerPaso"></div>
  <div class="grupo">En la bodega</div>
  <div class="menu">
    <button class="grande" data-ir="envasar"><b>Envasar</b><span>Registra frascos y cajas que salen del tambor</span></button>
    <button class="grande" data-ir="encajar"><b>Encajar</b><span>Cajas de 12, cajas de 10 y Pack Variedades 3 × 300 g</span></button>
    <button class="grande" data-ir="pedidos"><b>Por retirar <span class="contador oculto" id="nPend"></span></b><span>Prepara pedidos y facturas y márcalos retirados</span></button>
  </div>
  <div class="grupo">Cargar</div>
  <div class="menu">
    <button class="grande claro" data-ir="factura"><b>Subir factura</b><span>XML de Defontana (supermercados)</span></button>
    <button class="grande claro" data-ir="pedido"><b>Nuevo pedido</b><span>Mercado Libre, clientes, Berni y otros</span></button>
  </div>
  <div class="grupo">Ver y corregir</div>
  <div class="menu">
    <button class="grande claro" data-ir="stock"><b>Stock</b><span>Cuánto hay de cada producto</span></button>
    <button class="grande claro" data-ir="tambores"><b>Tambores</b><span>Kilos de cada tambor; abrir, cerrar, corregir</span></button>
    <button class="grande claro" data-ir="historial"><b>Historial</b><span>Todo lo registrado; deshacer errores</span></button>
    <button class="grande claro" data-ir="conteo"><b>Conteo de inventario</b><span>Inventario inicial o corregir lo contado</span></button>
    <button class="grande claro" data-ir="codigo"><b>Registrar código</b><span>Etiqueta que la app no conoce</span></button>
    <button class="grande claro" data-ir="config"><b>Configuración</b><span>Nombres de productos y tambores, avisos</span></button>
    <button class="grande claro" data-ir="ayuda"><b>Ayuda</b><span>Cómo funciona, la pistola, primer día</span></button>
  </div>`;
  const [pend, ops] = await Promise.all([
    sb.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'por_retirar'),
    sb.from('operaciones').select('id', { count: 'exact', head: true }),
  ]);
  const n = $('#nPend'); if (n && pend.count) { n.textContent = pend.count; n.classList.remove('oculto'); }
  const pp = $('#primerPaso');
  if (pp && ops.count === 0) {
    pp.innerHTML = enlazar(`<div class="aviso-inicio"><strong>Primer paso: crea el inventario.</strong><br>
      1) En <b>Tambores</b>, registra cada tambor con sus kilos. 2) En <b>Conteo de inventario</b>, escribe cuántos frascos y cajas hay.
      <div class="fila-botones"><button class="mini" data-ir="tambores">Ir a Tambores</button><button class="mini sec" data-ir="conteo">Ir al Conteo</button></div></div>`);
  }
};

// ───────── Envasar ─────────

PANTALLAS.envasar = () => {
  app.innerHTML = guia('envasar', [
    'Revisa que cada variedad tenga su tambor en uso (abajo). Si no, ábrelo en <b>Tambores</b>.',
    'Pistolea <b>cada frasco</b> que envasas, o <b>la caja</b> si envasas directo en caja de 12. Si son varios iguales, toca <b>×10</b> (u otra cantidad) y pistolea uno.',
    'Lo que no tiene código (baldes): toca <b>Escribir a mano</b>, escribe "balde" y elige la variedad.',
    'Cada lectura descuenta los kilos del tambor y suma al stock. ¿Te equivocaste? Toca <b>Deshacer</b> en esa línea.',
  ]) + `
  ${htmlPistola('Pistolea el frasco o la caja', htmlMultiplicador())}
  <h3>Tambores en uso</h3>
  <div class="usos" id="usos"></div>`;
  pintarUsos(); pintarMult();
  activarPistola(async (cod) => {
    const { p, tipo } = buscarCodigo(cod);
    const n = tomarMult();
    await envasar(p, tipo === 'caja' ? 0 : n, tipo === 'caja' ? n : 0);
  }, async (p) => envasar(p, tomarMult(), 0)); // elegido por nombre (ej.: baldes): unidades
};

const CLASE_VARIEDAD = { ulmo: 'v-ulmo', bosque_nativo: 'v-bn', quillay: 'v-quillay' };
// Mini barra con lo que queda del tambor, en el color de la variedad
const miniBarra = (t) => `<span class="minibarra" title="Queda ${num((Number(t.kg_restantes) / Number(t.kg_iniciales)) * 100)} %"><i style="width:${Math.max(0, Math.min(100, (Number(t.kg_restantes) / Number(t.kg_iniciales)) * 100))}%"></i></span>`;

function pintarUsos() {
  const s = $('#usos'); if (!s) return;
  s.innerHTML = Object.entries(VARIEDADES).map(([v, nombre]) => {
    const abiertos = E.tambores.filter((t) => t.variedad === v);
    const t = tamborDe(v);
    if (!t) return `<div class="uso falta ${CLASE_VARIEDAD[v]}"><b>${nombre}</b><span class="texto">Sin tambor abierto</span><button type="button" class="cambiar" data-ir="tambores">abrir uno</button></div>`;
    // Misma fila para todos (las barras quedan alineadas); si hay más de un tambor abierto, "cambiar" abre la lista
    return `<div class="uso ${CLASE_VARIEDAD[v]}"><b>${nombre}</b><span class="texto">${esc(nombreTambor(t))} · <span class="kgbarra">quedan <strong>${num(t.kg_restantes)} kg</strong>${miniBarra(t)}</span></span>
      ${abiertos.length > 1 ? `<button type="button" class="cambiar" data-cambiar="${v}">cambiar</button>` : ''}</div>`;
  }).join('');
  s.querySelectorAll('[data-cambiar]').forEach((b) => { b.onclick = () => elegirTambor(b.dataset.cambiar); });
}

// Elegir de qué tambor abierto se envasa una variedad (cuando hay más de uno)
async function elegirTambor(v) {
  const abiertos = E.tambores.filter((t) => t.variedad === v); const actual = tamborDe(v);
  const r = await dialogo({ titulo: `Envasar ${VARIEDADES[v]} desde…`, aceptar: 'Usar este',
    html: abiertos.map((a) => `<label class="radio"><input type="radio" name="dlgTambor" value="${a.id}" ${a.id === actual.id ? 'checked' : ''}> ${esc(nombreTambor(a))} · quedan ${num(a.kg_restantes)} kg</label>`).join(''),
    alAceptar: (f) => f.querySelector('input[name="dlgTambor"]:checked')?.value });
  if (r.ok && r.valor) { guardar('tambor_' + v, r.valor); pintarUsos(); }
  enfocarScan();
}

async function envasar(p, sueltas, cajas) {
  if (!p.variedad) throw new Error('El pack se arma en Encajar.');
  const t = tamborDe(p.variedad);
  if (!t) throw new Error(`No hay tambor abierto de ${VARIEDADES[p.variedad]}: ábrelo en Tambores antes de envasar.`);
  const r = await rpc('op_envasar', { p_producto: p.id, p_tambor: t.id, p_sueltas: sueltas, p_cajas: cajas });
  const i = E.tambores.findIndex((x) => x.id === r.tambor.id); if (i >= 0) E.tambores[i] = r.tambor;
  pintarUsos(); avisosDe(r);
  const que = cajas ? `+${plural(cajas, 'caja', 'cajas')} de ${p.uds_por_caja}` : !p.uds_por_caja ? `+${plural(sueltas, 'balde', 'baldes')}` : sueltas === 1 ? '+1 frasco' : `+${sueltas} frascos`;
  registrar(true, `${p.nombre} ${que}. Stock: ${textoStock(p, r.stock.sueltas, r.stock.cajas)}. Tambor ${nombreTambor(r.tambor)}: quedan ${num(r.tambor.kg_restantes)} kg`,
    { op: r.operacion, alDeshacer: async () => { await cargarTambores(); pintarUsos(); } });
}

// ───────── Encajar (cajas de 12, cajas de 10 y packs) ─────────

// Se pistolea la caja de 12 o la cajita del pack; las cajas de 10 (500 g y 1 kg) y cualquier caja sin etiqueta van en "Encajar sin pistolear".
PANTALLAS.encajar = () => {
  const encajables = [...E.productos.values()].filter((p) => p.activo && (p.caja_controlada || p.id === 'pack'));
  app.innerHTML = guia('encajar_v2', [
    '<b>Cajas de 12</b> (300 y 550 g): junta 12 frascos sueltos del mismo producto en su caja y pistolea el <b>código de la caja</b>, no el del frasco.',
    '<b>Packs 3 × 300 g</b>: arma la cajita con 1 frasco de Ulmo, 1 de Bosque Nativo y 1 de Quillay de 300 g y pistolea el <b>código de la cajita</b>.',
    '<b>Cajas de 10</b> (500 g y 1 kg) y cualquier caja sin código o sin etiqueta: usa el recuadro de abajo, <b>Encajar sin pistolear</b>. Elige el producto y toca <b>Añadir caja</b> una vez por cada caja.',
    'También puedes tocar <b>Escribir a mano</b> y escribir el código o el nombre del producto (ej.: "ulmo 1kg", "pack"): las opciones aparecen mientras escribes.',
    'Cada caja suma 1 caja al stock y descuenta sus frascos sueltos (12 o 10; el pack, 1 de cada variedad). ¿Te equivocaste? Toca <b>Deshacer</b>.',
  ]) + htmlPistola('Pistolea la caja o la cajita del pack') + `
  <section class="tarjeta"><h3>Encajar sin pistolear</h3><p class="nota">Para cajas sin código o etiqueta.</p>
    <div class="fila-botones"><select id="encProd" aria-label="Producto a encajar">${encajables.map((p) => `<option value="${p.id}" ${p.id === E.ultimoEncajable ? 'selected' : ''}>${esc(p.nombre)}${p.id === 'pack' ? '' : ` · caja de ${p.uds_por_caja}`}</option>`).join('')}</select>
    <button type="button" id="encManual">Añadir caja</button></div></section>`;
  $('#encProd').onchange = () => { E.ultimoEncajable = $('#encProd').value; };
  // Cada toque agrega una caja (se graban en orden, aunque se toque rápido)
  $('#encManual').onclick = () => { const p = E.productos.get($('#encProd').value); E.ultimoEncajable = p.id; encolar(() => (p.id === 'pack' ? armarPack() : encajar(p))); };
  const porProducto = async (p) => {
    if (p.id === 'pack') return armarPack();
    if (p.caja_controlada) return encajar(p);
    throw new Error(`${p.nombre} no se encaja.`);
  };
  activarPistola(async (cod) => {
    const { p, tipo } = buscarCodigo(cod);
    if (p.id === 'pack' || tipo === 'caja') return porProducto(p);
    if (p.caja_controlada) throw new Error(`${p.nombre}: ese es el código del frasco. Pistolea el de la caja${p.uds_por_caja === 10 ? ', o usa Encajar sin pistolear (abajo)' : ''}.`);
    throw new Error(`${p.nombre} no se encaja.`);
  }, porProducto, (p) => p.caja_controlada || p.id === 'pack');
};
PANTALLAS.pack = () => PANTALLAS.encajar(); // enlaces antiguos

// El aviso se muestra la primera vez que se encaja cada producto en esta visita a la pantalla (salvo "No volver a mostrar")
async function avisoEncajar(clave, titulo, html) {
  if (E.avisosVistos.has(clave)) return true;
  const ok = await avisoPrimeraVez(clave === 'pack' ? 'pack' : 'encajar', titulo, html);
  if (ok) E.avisosVistos.add(clave);
  return ok;
}

async function encajar(p) {
  const ok = await avisoEncajar('enc_' + p.id, 'Encajar',
    `Vas a encajar <b>${esc(p.nombre)}</b> en una caja de ${p.uds_por_caja}.<br>Se suma 1 caja y se descuentan <b>${p.uds_por_caja} frascos sueltos</b> del inventario.`);
  if (!ok) return;
  const r = await rpc('op_encajar', { p_producto: p.id, p_cajas: 1 });
  avisosDe(r); registrar(true, `${p.nombre}: +1 caja (−${p.uds_por_caja} sueltas). Stock: ${textoStock(p, r.stock.sueltas, r.stock.cajas)}`, { op: r.operacion });
}
async function armarPack() {
  const ok = await avisoEncajar('pack', 'Armar pack',
    'Vas a armar <b>1 Pack Variedades 3 × 300 g</b>.<br>Se suma 1 pack y se descuenta <b>1 frasco suelto</b> de Ulmo, de Bosque Nativo y de Quillay 300 g.');
  if (!ok) return;
  const r = await rpc('op_armar_pack', { p_cantidad: 1 });
  avisosDe(r); registrar(true, `+1 pack (${plural(r.stock?.sueltas, 'pack armado', 'packs armados')}). Se restó 1 frasco de cada 300 g`, { op: r.operacion });
}

// ───────── Por retirar ─────────

PANTALLAS.pedidos = async () => {
  app.innerHTML = guia('pedidos', [
    'Aquí están los pedidos y facturas que esperan retiro. Su stock ya está reservado.',
    'Toca uno para prepararlo pistoleando cada caja o frasco (opcional en facturas, pero ayuda a no equivocarse).',
    'Cuando lo retiren, aprieta <b>Marcar retirado</b>: recién ahí sale del stock.',
  ]) + `<div class="fila-botones"><button class="sec" data-ir="pedido">+ Nuevo pedido</button><button class="sec" data-ir="factura">+ Subir factura</button></div>
  <div id="lista" class="lista"><p class="nota">Cargando…</p></div>`;
  const data = await consulta(sb.from('v_pedidos').select('*').eq('estado', 'por_retirar').order('creado_en'));
  const l = $('#lista'); if (!l) return;
  l.innerHTML = data.length ? data.map((p) => {
    const total = p.cajas + p.unidades; const prep = p.cajas_prep + p.unidades_prep;
    return `<button class="pedido ${p.completo ? 'listo' : ''}" data-ir="preparar" data-id="${p.id}">
      <b>${esc(p.etiqueta)}</b>
      <span>${resumenCant(p.cajas, p.unidades)}${p.oc ? ` · OC ${esc(p.oc)}` : ''}${p.nota ? ` · ${esc(p.nota)}` : ''}</span>
      <span class="chico">Cargado por ${esc(quien(p.creado_por))} el ${fecha(p.creado_en)}</span>
      <span class="progreso">${p.completo ? 'Listo para retirar' : `Pistoleado ${prep} de ${total}`}</span></button>`;
  }).join('') : '<p class="nota">No hay pedidos ni facturas por retirar.</p>';
};

PANTALLAS.preparar = async ({ id }) => {
  app.innerHTML = `<h2 id="titPed">Cargando…</h2><p id="resPed" class="nota"></p>` + guia('preparar', [
    'Pistolea cada caja o frasco a medida que lo juntas. La línea avanza y te avisa si sobra o no está en el pedido.',
    'Si son varios iguales (ej.: 10 frascos de 1 kg), toca <b>×10</b> y pistolea uno solo.',
    'Los productos sin código (baldes) tienen un botón <b>+1</b>.',
    'Cuando lo retiren, aprieta <b>Marcar retirado</b>.',
  ]) + `${htmlPistola('Pistolea cada frasco o caja de este pedido', htmlMultiplicador())}
  <section class="tarjeta"><table class="tabla" id="lineas"></table></section>
  <button type="button" class="grande" id="btnRetirar"><b>Marcar retirado</b><span>Sale del stock lo que dice el pedido</span></button>
  <div class="fila-botones"><button type="button" class="sec mini oculto" id="btnEditarPed">Editar pedido</button><button type="button" class="sec mini oculto" id="btnCadena">Corregir cadena</button>
    <button type="button" class="peligro mini" id="btnAnularPed">Anular este pedido</button></div>`;
  pintarMult();
  activarPistola(async (cod) => { const { p, tipo } = buscarCodigo(cod); const n = tomarMult(); await preparar(id, p, tipo, false, n); },
    async (p) => { // elegido por nombre: se usa la línea del pedido (unidades si las pide; si no, cajas)
      const ls = (E.ctx.lineas || []).filter((l) => l.producto_id === p.id);
      if (!ls.length) throw new Error(`${p.nombre} no está en este pedido`);
      const l = ls.find((x) => x.unidad === 'unidad') || ls[0];
      await preparar(id, p, l.unidad, false, tomarMult());
    }, (p) => (E.ctx.lineas || []).some((l) => l.producto_id === p.id));
  $('#btnRetirar').onclick = () => encolar(() => retirar(id));
  $('#btnAnularPed').onclick = () => encolar(() => anularPedido(id));
  $('#btnEditarPed').onclick = () => ir('pedido', { id });
  $('#btnCadena').onclick = () => encolar(() => corregirCadena(id));
  await cargarPedido(id);
};

// Facturas: se corrige solo la cadena (y el CD en Líder); el resto viene del XML
async function corregirCadena(id) {
  const p = E.ctx.pedido; if (!p) return;
  const r = await dialogo({ titulo: `Corregir cadena · ${p.etiqueta}`, aceptar: 'Guardar',
    html: `<label>Cadena<select class="dlg-cadena">${Object.entries(CADENAS).map(([k, n]) => `<option value="${k}" ${p.cadena === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>CD (solo Líder)<select class="dlg-cd"><option value="">—</option>${Object.entries(CDS).map(([k, n]) => `<option value="${k}" ${p.cd === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`,
    alAceptar: (f) => ({ cadena: f.querySelector('.dlg-cadena').value, cd: f.querySelector('.dlg-cd').value || null }) });
  if (!r.ok) return;
  if (r.valor.cadena === 'lider' && !r.valor.cd) throw new Error('En Líder hay que elegir el CD.');
  await rpc('corregir_cadena', { p_pedido: id, p_cadena: r.valor.cadena, p_cd: r.valor.cadena === 'lider' ? r.valor.cd : null });
  pitido(true); aviso('Cadena corregida.', 'ok');
  await cargarPedido(id);
}

async function cargarPedido(id) {
  const [p, l] = await Promise.all([
    consulta(sb.from('v_pedidos').select('*').eq('id', id).single()),
    consulta(sb.from('v_pedido_lineas').select('*').eq('pedido_id', id).order('orden')),
  ]);
  if (E.pantalla !== 'preparar' || E.ctx.id !== id) return;
  E.ctx.pedido = p; E.ctx.lineas = l;
  pintarPedido();
}

const tieneCodigo = (prod, unidad) => [...E.codigos.values()].some((c) => c.producto_id === prod && c.tipo === unidad);

function pintarPedido() {
  const p = E.ctx.pedido; const ls = E.ctx.lineas; if (!p || !$('#lineas')) return;
  const total = p.cajas + p.unidades; const prep = p.cajas_prep + p.unidades_prep;
  $('#titPed').textContent = p.etiqueta;
  $('#resPed').textContent = `${resumenCant(p.cajas, p.unidades)}${p.oc ? ` · OC ${p.oc}` : ''} · pistoleado ${prep} de ${total}`
    + (p.estado !== 'por_retirar' ? ` · ${p.estado === 'retirado' ? 'RETIRADO' : 'ANULADO'}` : '');
  const abierto = p.estado === 'por_retirar';
  $('#btnRetirar').classList.toggle('oculto', !abierto);
  $('#btnAnularPed').classList.toggle('oculto', !abierto);
  $('#btnEditarPed').classList.toggle('oculto', !abierto || p.tipo !== 'pedido');
  $('#btnCadena').classList.toggle('oculto', !abierto || p.destino !== 'supermercado');
  $('#btnAnularPed').textContent = p.tipo === 'factura' ? 'Anular esta factura' : 'Anular este pedido';
  $('#lineas').innerHTML = '<tr><th>Producto</th><th class="num">Pide</th><th class="num">Listo</th><th></th></tr>' + ls.map((l) =>
    `<tr class="${l.faltan === 0 ? 'ok' : ''}"><td>${esc(l.producto)}</td><td class="num">${plural(l.cantidad, l.unidad === 'caja' ? 'caja' : 'unidad', l.unidad === 'caja' ? 'cajas' : 'unidades')}</td><td class="num">${l.preparado}</td>
     <td>${abierto && !tieneCodigo(l.producto_id, l.unidad) && l.faltan > 0 ? `<button type="button" class="mini" data-linea="${l.id}">+1</button>` : ''}</td></tr>`).join('');
  $('#lineas').querySelectorAll('[data-linea]').forEach((b) => {
    const l = ls.find((x) => x.id === Number(b.dataset.linea));
    b.onclick = () => encolar(() => preparar(p.id, E.productos.get(l.producto_id), l.unidad, false, tomarMult()));
  });
}

async function preparar(id, p, unidad, desarmar = false, cantidad = 1) {
  let r;
  try {
    r = await rpc('op_preparar', { p_pedido: id, p_producto: p.id, p_unidad: unidad, p_cantidad: cantidad, p_desarmar: desarmar });
  } catch (e) {
    if (e.codigo === 'FALTAN_SUELTAS' && !desarmar) {
      pitido(false);
      if (confirm(e.message)) return preparar(id, p, unidad, true, cantidad);
      throw new Error(`${p.nombre}: no se pistoleó (no se desarmó la caja)`);
    }
    throw e;
  }
  avisosDe(r);
  if (E.pantalla === 'preparar' && E.ctx.id === id && E.ctx.lineas) {
    const i = E.ctx.lineas.findIndex((x) => x.id === r.linea.id); if (i >= 0) E.ctx.lineas[i] = r.linea;
    E.ctx.pedido = r.pedido; pintarPedido();
  }
  registrar(true, `${p.nombre} (${cantidad > 1 ? cantidad + ' ' : ''}${unidad === 'caja' ? (cantidad > 1 ? 'cajas' : 'caja') : (cantidad > 1 ? 'unidades' : 'unidad')}): ${r.linea.faltan ? `faltan ${r.linea.faltan}` : 'línea completa'}`,
    { op: r.operacion, alDeshacer: () => cargarPedido(id) });
  if (r.pedido.completo) aviso('Pedido completo: ya puedes marcarlo retirado.', 'ok');
}

async function retirar(id) {
  const p = E.ctx.pedido; if (!p) return;
  const faltan = (p.cajas + p.unidades) - (p.cajas_prep + p.unidades_prep);
  const msg = faltan > 0
    ? `${faltan === 1 ? 'Falta 1' : `Faltan ${faltan}`} por pistolear. ¿Marcar retirado igual? Sale del stock lo que dice el pedido.`
    : `¿Confirmas que retiraron ${p.etiqueta}?`;
  if (!confirm(msg)) return;
  const r = await rpc('op_retirar', { p_pedido: id });
  avisosDe(r); pitido(true);
  aviso(`${p.etiqueta}: retirado`, 'ok', { texto: 'Deshacer', fn: () => encolar(async () => {
    if (!confirm(`¿Deshacer el retiro de ${p.etiqueta}? Vuelve a "Por retirar".`)) return;
    await rpc('op_anular', { p_operacion: r.operacion, p_motivo: `Retiro deshecho al momento por ${E.nombre}` });
    aviso('Retiro deshecho: el pedido vuelve a "Por retirar".', 'ok');
    if (E.pantalla === 'pedidos') ir('pedidos', {}, { historial: false });
  }) });
  volverAPantalla('pedidos');
}

// Vuelve a la pantalla de arriba sin dejar en el historial la que ya no sirve (pedido retirado o anulado)
function volverAPantalla(p, ctx = {}) {
  if (history.state && history.state.desde === p) history.back(); else ir(p, ctx, { reemplazar: true });
}

async function anularPedido(id) {
  const p = E.ctx.pedido; if (!p) return;
  const motivo = prompt(`¿Por qué se anula ${p.etiqueta}? (ej.: "cargado dos veces", "el cliente lo canceló")`);
  if (motivo === null) return;
  if (!motivo.trim()) throw new Error('Para anular hay que escribir el motivo.');
  await rpc('anular_pedido', { p_pedido: id, p_motivo: motivo.trim() });
  pitido(true); aviso(`${p.etiqueta}: anulado. Su stock queda libre.`, 'ok');
  volverAPantalla('pedidos');
}

// ───────── Nuevo pedido ─────────

// Nuevo pedido, o edición de uno existente si viene { id }
PANTALLAS.pedido = async ({ id } = {}) => {
  E.ctx.np = { destino: null, cadena: null, cd: null, editar: id || null };
  app.innerHTML = (id ? '<p class="aviso-inicio" id="npEditando">Cargando el pedido…</p>' : '') + guia('pedido', [
    'Elige a quién va el pedido.',
    'Escribe cuántas cajas o unidades lleva de cada producto (deja en blanco lo que no lleva).',
    'Al crearlo, su stock queda reservado y aparece en <b>Por retirar</b> para que lo preparen.',
  ]) + `<section class="tarjeta"><h3>¿A quién va?</h3><div id="npDestino"></div></section>
  <section class="tarjeta"><h3>Productos</h3>
    <table class="tabla"><tr><th>Producto</th><th class="num">Cajas</th><th class="num">Unidades</th></tr>
    ${[...E.productos.values()].filter((p) => p.activo).map((p) => `<tr><td>${esc(p.nombre)}</td>
      <td class="num">${p.caja_controlada ? `<input type="number" min="0" inputmode="numeric" data-np="${p.id}" data-unidad="caja" placeholder="cajas" aria-label="Cajas de ${esc(p.nombre)}">` : '<span class="chico">—</span>'}</td>
      <td class="num"><input type="number" min="0" inputmode="numeric" data-np="${p.id}" data-unidad="unidad" placeholder="${unidadDe(p)[1]}" aria-label="Unidades de ${esc(p.nombre)}"></td></tr>`).join('')}
    </table>
    <label style="margin-top:12px">Nota (opcional)<input id="npNota" placeholder="Ej.: N.º de venta de Mercado Libre"></label>
  </section>
  <p id="npResumen" class="nota"></p>
  <button type="button" class="grande ancho" id="npCrear" disabled><b>Crear pedido</b><span>Queda en "Por retirar"</span></button>
  <datalist id="clientes"></datalist>`;
  if (id) {
    // Cargar el pedido y dejarlo listo para editar
    const [p, ls] = await Promise.all([
      consulta(sb.from('v_pedidos').select('*').eq('id', id).single()),
      consulta(sb.from('v_pedido_lineas').select('*').eq('pedido_id', id)),
    ]);
    if (E.pantalla !== 'pedido' || E.ctx.np.editar !== id) return;
    if (p.tipo !== 'pedido' || p.estado !== 'por_retirar') { ir('preparar', { id }, { reemplazar: true }); return; }
    Object.assign(E.ctx.np, { destino: p.destino, cadena: p.cadena, cd: p.cd, cliente: p.cliente || '' });
    ls.forEach((l) => { const i = app.querySelector(`[data-np="${l.producto_id}"][data-unidad="${l.unidad}"]`); if (i) i.value = l.cantidad; });
    $('#npNota').value = p.nota || '';
    $('#npEditando').innerHTML = `Editando <b>${esc(p.etiqueta)}</b>. Cambia lo que necesites y aprieta Guardar cambios. No se puede bajar una cantidad por debajo de lo ya pistoleado.`;
    $('#npCrear').innerHTML = '<b>Guardar cambios</b><span>El pedido sigue en "Por retirar"</span>';
    const t = $('#cab .titulo'); if (t) t.textContent = 'Editar pedido';
  }
  pintarDestino();
  app.querySelectorAll('[data-np]').forEach((i) => { i.oninput = actualizarResumenPedido; });
  actualizarResumenPedido(); // muestra desde el inicio qué falta para habilitar "Crear pedido"
  $('#npCrear').onclick = () => encolar(id ? guardarEdicionPedido : crearPedido);
  const cl = await consulta(sb.from('v_clientes').select('*').order('ultimo', { ascending: false }).limit(200));
  const dl = $('#clientes'); if (dl) dl.innerHTML = cl.map((c) => `<option value="${esc(c.cliente)}">`).join('');
};

function pintarDestino() {
  const np = E.ctx.np; const c = $('#npDestino'); if (!c) return;
  c.innerHTML = `<div class="opciones">${Object.entries(DESTINOS).map(([k, n]) => `<button type="button" data-destino="${k}" class="${np.destino === k ? 'elegida' : ''}">${n}</button>`).join('')}</div>
    ${np.destino === 'cliente' ? `<label>Nombre del cliente<input id="npCliente" list="clientes" autocomplete="off" value="${esc(np.cliente || '')}"></label>` : ''}
    ${np.destino === 'supermercado' ? `<p class="chico">Para supermercados lo normal es subir la factura. Usa esto solo si no hay factura.</p>
      <div class="opciones">${Object.entries(CADENAS).map(([k, n]) => `<button type="button" data-cadena="${k}" class="${np.cadena === k ? 'elegida' : ''}">${n}</button>`).join('')}</div>
      ${np.cadena === 'lider' ? `<div class="opciones">${Object.entries(CDS).map(([k, n]) => `<button type="button" data-cd="${k}" class="${np.cd === k ? 'elegida' : ''}">${n}</button>`).join('')}</div>` : ''}` : ''}`;
  c.querySelectorAll('[data-destino]').forEach((b) => { b.onclick = () => { np.destino = b.dataset.destino; pintarDestino(); actualizarResumenPedido(); }; });
  c.querySelectorAll('[data-cadena]').forEach((b) => { b.onclick = () => { np.cadena = b.dataset.cadena; if (np.cadena !== 'lider') np.cd = null; pintarDestino(); actualizarResumenPedido(); }; });
  c.querySelectorAll('[data-cd]').forEach((b) => { b.onclick = () => { np.cd = b.dataset.cd; pintarDestino(); actualizarResumenPedido(); }; });
  const ic = $('#npCliente'); if (ic) ic.oninput = () => { np.cliente = ic.value; actualizarResumenPedido(); };
}

function lineasPedido() {
  const lineas = [];
  app.querySelectorAll('[data-np]').forEach((i) => {
    const n = parseInt(i.value, 10);
    if (n > 0) lineas.push({ producto: i.dataset.np, unidad: i.dataset.unidad, cantidad: n });
  });
  return lineas;
}
function actualizarResumenPedido() {
  const np = E.ctx.np; const ls = lineasPedido();
  const cj = ls.filter((l) => l.unidad === 'caja').reduce((a, l) => a + l.cantidad, 0);
  const u = ls.filter((l) => l.unidad === 'unidad').reduce((a, l) => a + l.cantidad, 0);
  const falta = !np.destino ? 'Elige a quién va.' : np.destino === 'cliente' && !(np.cliente || '').trim() ? 'Escribe el nombre del cliente.'
    : np.destino === 'supermercado' && !np.cadena ? 'Elige la cadena.' : np.cadena === 'lider' && np.destino === 'supermercado' && !np.cd ? 'Elige el CD de Líder.'
    : !ls.length ? 'Escribe al menos una cantidad.' : '';
  $('#npResumen').textContent = falta || `El pedido lleva ${resumenCant(cj, u)}.`;
  $('#npCrear').disabled = !!falta;
}
async function crearPedido() {
  const np = E.ctx.np; const ls = lineasPedido(); if (!ls.length || !np.destino) return;
  $('#npCrear').disabled = true;
  try {
    const r = await rpc('crear_pedido', { p_destino: np.destino, p_lineas: ls, p_cliente: np.destino === 'cliente' ? (np.cliente || '').trim() : null,
      p_cadena: np.destino === 'supermercado' ? np.cadena : null, p_cd: np.destino === 'supermercado' && np.cadena === 'lider' ? np.cd : null,
      p_nota: $('#npNota').value.trim() || null });
    pitido(true); aviso(`${r.pedido.etiqueta} creado: ${resumenCant(r.pedido.cajas, r.pedido.unidades)}`, 'ok');
    ir('preparar', { id: r.pedido.id }, { reemplazar: true });
  } catch (e) { $('#npCrear').disabled = false; throw e; }
}
async function guardarEdicionPedido() {
  const np = E.ctx.np; const ls = lineasPedido(); if (!ls.length || !np.destino) return;
  $('#npCrear').disabled = true;
  try {
    const r = await rpc('editar_pedido', { p_pedido: np.editar, p_destino: np.destino, p_lineas: ls,
      p_cliente: np.destino === 'cliente' ? (np.cliente || '').trim() : null,
      p_cadena: np.destino === 'supermercado' ? np.cadena : null, p_cd: np.destino === 'supermercado' && np.cadena === 'lider' ? np.cd : null,
      p_nota: $('#npNota').value.trim() || null });
    pitido(true); aviso(`${r.pedido.etiqueta} guardado: ${resumenCant(r.pedido.cajas, r.pedido.unidades)}`, 'ok');
    volverAPantalla('preparar', { id: np.editar });
  } catch (e) { $('#npCrear').disabled = false; throw e; }
}

// ───────── Subir factura (XML DTE de Defontana) ─────────

function decodificarXML(buf) {
  const cab = new TextDecoder('latin1').decode(new Uint8Array(buf).slice(0, 200));
  const m = cab.match(/encoding\s*=\s*["']([^"']+)/i);
  const enc = (m ? m[1] : 'iso-8859-1').toLowerCase();
  return new TextDecoder(enc === 'utf-8' || enc === 'utf8' ? 'utf-8' : 'iso-8859-1').decode(buf); // por defecto ISO-8859-1
}

function parsearDTE(texto) {
  const xml = new DOMParser().parseFromString(texto, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido.');
  const T = (el, n) => (el ? el.getElementsByTagNameNS('*', n) : []);
  const t1 = (el, n) => { const x = T(el, n)[0]; return x ? x.textContent.trim() : null; };
  const docs = T(xml, 'Documento');
  if (docs.length !== 1) throw new Error(docs.length ? 'El XML trae más de una factura: sube una por una.' : 'No se encontró la factura dentro del XML (¿es el XML del DTE?).');
  const d = docs[0];
  const enc = T(d, 'Encabezado')[0];
  const idDoc = T(enc, 'IdDoc')[0]; const rec = T(enc, 'Receptor')[0]; const tot = T(enc, 'Totales')[0];
  const f = {
    tipo_dte: Number(t1(idDoc, 'TipoDTE')), folio: Number(t1(idDoc, 'Folio')), fecha_emision: t1(idDoc, 'FchEmis'),
    rut_receptor: (t1(rec, 'RUTRecep') || '').replace(/\./g, '').toUpperCase(), razon_social: t1(rec, 'RznSocRecep'),
    monto_neto: tot && t1(tot, 'MntNeto') ? Number(t1(tot, 'MntNeto')) : null,
    oc: null, cajas_control: null, lineas: [], xml: texto, cadena: null, cd: null,
  };
  if (!f.tipo_dte || !f.folio) throw new Error('La factura no trae tipo o folio.');
  for (const det of T(d, 'Detalle')) {
    f.lineas.push({
      codigo: t1(det, 'VlrCodigo'), // TpoCodigo no es confiable: solo VlrCodigo
      nombre: t1(det, 'NmbItem'),
      cantidad: Number(t1(det, 'QtyItem')),
      precio: t1(det, 'PrcItem') ? Number(t1(det, 'PrcItem')) : null,
    });
  }
  for (const ref of T(d, 'Referencia')) {
    if (t1(ref, 'TpoDocRef') === '801') {
      f.oc = t1(ref, 'FolioRef');
      const m = (t1(ref, 'RazonRef') || '').match(/suma\s+cantidad\s*:\s*(\d+)/i);
      if (m) f.cajas_control = Number(m[1]);
    }
  }
  if (!f.lineas.length) throw new Error('La factura no trae líneas.');
  return f;
}

PANTALLAS.factura = () => {
  app.innerHTML = guia('factura', [
    'Descarga de Defontana el <b>XML</b> de la factura (no el PDF).',
    'Elígelo aquí abajo: la app lee sola el folio, la OC y las cajas.',
    'Marca la cadena (y el CD si es Líder) y aprieta <b>Cargar factura</b>. Queda en <b>Por retirar</b>.',
  ]) + `<section class="tarjeta"><label>Archivo XML de la factura
    <input type="file" id="archivoXml" accept=".xml,text/xml,application/xml"></label></section>
  <div id="fac"></div>`;
  $('#archivoXml').onchange = async (ev) => {
    const archivo = ev.target.files[0]; if (!archivo) return;
    try {
      E.factura = parsearDTE(decodificarXML(await archivo.arrayBuffer()));
      pintarFactura();
    } catch (e) { E.factura = null; $('#fac').innerHTML = `<p class="error">${esc(mensaje(e))}</p>`; pitido(false); }
  };
  if (E.factura) pintarFactura(); // vuelve de registrar un código
};

function pintarFactura() {
  const f = E.factura; const caja = $('#fac'); if (!f || !caja) return;
  const suma = f.lineas.reduce((a, l) => a + l.cantidad, 0);
  const desconocidas = f.lineas.filter((l) => !E.codigos.get(l.codigo));
  const cuadra = f.cajas_control == null || suma === f.cajas_control;
  const sug = RUT_CADENA[f.rut_receptor];
  const listo = !desconocidas.length && f.cadena && (f.cadena !== 'lider' || f.cd);
  caja.innerHTML = `<section class="tarjeta">
    <h3>Factura ${esc(f.folio)}</h3>
    <dl class="datos">
      <dt>Fecha</dt><dd>${esc(fechaCorta(f.fecha_emision) || '—')}</dd>
      <dt>Cliente</dt><dd>${esc(f.razon_social || '—')} (${esc(f.rut_receptor || 's/RUT')})</dd>
      <dt>OC</dt><dd>${esc(f.oc || '—')}</dd>
    </dl>
    <table class="tabla"><tr><th>Producto</th><th class="num">Cantidad</th></tr>
      ${f.lineas.map((l) => {
        const c = E.codigos.get(l.codigo);
        if (!c) return `<tr class="mal"><td>${esc(l.nombre)}<br><small>Código ${esc(l.codigo || 'sin código')} no registrado</small>
          ${l.codigo ? `<br><button type="button" class="mini sec" data-ir="codigo" data-codigo="${esc(l.codigo)}">Registrar código</button>` : ''}</td><td class="num">${num(l.cantidad)}</td></tr>`;
        return `<tr><td>${esc(E.productos.get(c.producto_id).nombre)}</td><td class="num">${plural(l.cantidad, c.tipo === 'caja' ? 'caja' : 'unidad', c.tipo === 'caja' ? 'cajas' : 'unidades')}</td></tr>`;
      }).join('')}
    </table>
    <p class="${cuadra ? 'cuadra' : 'no-cuadra'}">Suma ${plural(suma, 'caja', 'cajas')}${f.cajas_control != null ? ` · la OC dice ${f.cajas_control}` : ''}${cuadra ? (f.cajas_control != null ? ' ✓' : '') : ': no coincide'}</p>
  </section>
  <section class="tarjeta">
    <h3>Cadena (obligatoria)</h3>
    ${sug ? `<p class="nota">${esc(sug.texto)}</p>` : ''}
    <div class="opciones">${Object.entries(CADENAS).map(([k, n]) => `<button type="button" data-cadena="${k}" class="${f.cadena === k ? 'elegida' : ''} ${sug?.sugerida === k ? 'sugerida' : ''}">${n}</button>`).join('')}</div>
    ${f.cadena === 'lider' ? `<h3>CD de Líder</h3><div class="opciones">${Object.entries(CDS).map(([k, n]) => `<button type="button" data-cd="${k}" class="${f.cd === k ? 'elegida' : ''}">${n}</button>`).join('')}</div>` : ''}
  </section>
  <button type="button" class="grande ancho" id="btnCargar" ${listo ? '' : 'disabled'}><b>Cargar factura</b><span>Queda por retirar; el stock se descuenta al marcarla retirada</span></button>
  <p class="error" id="errFac">${desconocidas.length ? 'Primero registra los códigos en rojo.' : !f.cadena ? 'Falta elegir la cadena.' : f.cadena === 'lider' && !f.cd ? 'Falta elegir el CD.' : ''}</p>`;
  E.volverA = { p: 'factura' };
  caja.querySelectorAll('[data-cadena]').forEach((b) => { b.onclick = () => { f.cadena = b.dataset.cadena; if (f.cadena !== 'lider') f.cd = null; pintarFactura(); }; });
  caja.querySelectorAll('[data-cd]').forEach((b) => { b.onclick = () => { f.cd = b.dataset.cd; pintarFactura(); }; });
  $('#btnCargar').onclick = async () => {
    if (!cuadra && !confirm(`La suma de la factura (${suma}) no coincide con la OC (${f.cajas_control}). ¿Cargar igual?`)) return;
    const b = $('#btnCargar'); b.disabled = true;
    try {
      const r = await rpc('cargar_factura', { p: {
        tipo_dte: f.tipo_dte, folio: f.folio, fecha_emision: f.fecha_emision, rut_receptor: f.rut_receptor,
        razon_social: f.razon_social, oc: f.oc, cajas_control: f.cajas_control, monto_neto: f.monto_neto,
        cadena: f.cadena, cd: f.cadena === 'lider' ? f.cd : null, xml: f.xml,
        lineas: f.lineas.map((l) => ({ codigo: l.codigo, nombre: l.nombre, cantidad: l.cantidad, precio: l.precio })),
      } });
      pitido(true); aviso(`Factura ${f.folio} cargada: ${resumenCant(r.pedido.cajas, r.pedido.unidades)} por retirar. Si te equivocaste, ábrela en "Por retirar" y anúlala.`, 'ok');
      E.factura = null; E.volverA = null;
      ir('pedidos', {}, { reemplazar: true });
    } catch (e) { b.disabled = false; pitido(false); $('#errFac').textContent = mensaje(e); }
  };
}

// ───────── Stock ─────────

PANTALLAS.stock = async () => {
  app.innerHTML = guia('stock', [
    '<b>En bodega</b>: lo que hay físicamente. <b>Reservado</b>: lo que ya está en pedidos o facturas por retirar.',
    '<b>Libre</b> = en bodega − reservado. Es lo que se puede vender.',
    'Si algo sale en rojo (negativo), hay que revisarlo con un <b>Conteo de inventario</b>.',
  ]) + `<div class="fila-botones"><button class="sec mini" id="refrescar">Actualizar</button><button class="sec mini" data-ir="conteo">Conteo de inventario</button></div>
  <div id="st"><p class="nota">Cargando…</p></div>`;
  $('#refrescar').onclick = () => ir('stock', {}, { historial: false });
  const [s, t] = await Promise.all([
    consulta(sb.from('v_stock').select('*').eq('activo', true).order('orden')),
    consulta(sb.from('v_tambores').select('variedad,kg_restantes,estado').in('estado', ['abierto', 'sin_abrir'])),
  ]);
  const c = $('#st'); if (!c) return;
  const kg = (v, est) => t.filter((x) => x.variedad === v && (!est || x.estado === est)).reduce((a, x) => a + Number(x.kg_restantes), 0);
  const celda = (p, su, cj) => {
    const neg = su < 0 || cj < 0;
    return `<span class="${neg ? 'neg' : ''}">${textoStock(p, su, cj)}</span>`;
  };
  // 300 y 550 g: lo libre se muestra en frascos totales (si un pedido pide sueltas y solo hay cajas, se desarma una; no es un error)
  const libre = (x) => {
    if (!x.caja_controlada) return celda(x, x.disp_sueltas, 0);
    const u = x.unidades_disponibles;
    const detalle = x.disp_cajas >= 0 && x.disp_sueltas >= 0 && x.disp_cajas > 0 ? `<br><span class="chico">${textoStock(x, x.disp_sueltas, x.disp_cajas)}</span>` : '';
    return `<span class="${u < 0 ? 'neg' : ''}">${plural(u, 'frasco', 'frascos')}</span>${detalle}`;
  };
  c.innerHTML = `<section class="tarjeta"><h3>Miel en tambores</h3>
    <table class="tabla"><tr><th>Variedad</th><th class="num">Abiertos</th><th class="num">Sin abrir</th></tr>
      ${Object.entries(VARIEDADES).map(([v, n]) => `<tr><td>${n}</td><td class="num">${num(kg(v, 'abierto'))} kg</td><td class="num">${num(kg(v, 'sin_abrir'))} kg</td></tr>`).join('')}
    </table><p class="chico">Detalle por tambor en <a href="#" data-ir="tambores">Tambores</a>.</p></section>
  <section class="tarjeta"><h3>Productos</h3>
    <table class="tabla"><tr><th>Producto</th><th class="num">Libre</th></tr>
    ${s.map((x) => `<tr><td><b>${esc(x.nombre)}</b><br><span class="chico">En bodega: ${celda(x, x.sueltas, x.cajas)}${(x.comp_sueltas || x.comp_cajas) ? ` · Reservado: ${textoStock(x, x.comp_sueltas, x.comp_cajas)}` : ''}</span></td>
      <td class="num disp">${libre(x)}</td></tr>`).join('')}
    </table></section>`;
};

// ───────── Tambores ─────────

PANTALLAS.tambores = async () => {
  app.innerHTML = guia('tambores', [
    '<b>Registrar tambor</b>: cuando llega uno, anota sus kilos (los que vienen escritos por fuera). Si ya está empezado (inventario inicial), anota los kilos que le quedan.',
    '<b>Abrir</b>: cuando empiezas a envasar de él. Puede haber más de uno abierto por variedad.',
    '<b>Cerrar</b>: cuando se termina. La app calcula el rendimiento y la merma.',
    '¿Lo anotaste mal? Usa <b>Corregir</b> (kilos o nombre) o <b>Anular</b> (si se ingresó por error).',
  ]) + `<button type="button" class="ancho" id="btnNuevoT">+ Registrar tambor</button>
  <form id="fTambor" class="tarjeta oculto">
    <h3>Registrar tambor</h3>
    <label>Variedad<select name="variedad" required><option value="">Elige…</option>${Object.entries(VARIEDADES).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
    <label>Kilos<input name="kg" type="text" inputmode="decimal" autocomplete="off" required placeholder="Ej.: 300 o 287,5"></label>
    <label>Nombre o identificación (opcional)<input name="ident" placeholder="Ej.: T-U4, o lo que diga el tambor"></label>
    <label class="check"><input type="checkbox" name="abrir" checked> Lo abro ahora (voy a envasar de él)</label>
    <div class="fila-botones"><button type="submit">Registrar</button><button type="button" class="sec" id="cancTambor">Cancelar</button></div>
  </form>
  <div id="listaT" class="lista"><p class="nota">Cargando…</p></div>`;
  const f = $('#fTambor');
  $('#btnNuevoT').onclick = () => { f.classList.remove('oculto'); $('#btnNuevoT').classList.add('oculto'); f.variedad.focus(); };
  $('#cancTambor').onclick = () => { f.reset(); f.classList.add('oculto'); $('#btnNuevoT').classList.remove('oculto'); };
  f.onsubmit = (ev) => { ev.preventDefault(); encolar(() => registrarTambor(f)); };
  await pintarTambores();
};

async function pintarTambores() {
  const lista = await consulta(sb.from('v_tambores').select('*').neq('estado', 'anulado').order('creado_en', { ascending: false }).limit(60));
  const c = $('#listaT'); if (!c) return;
  const grupo = (titulo, ts) => (ts.length ? `<div class="grupo">${titulo}</div>${ts.map(fichaTambor).join('')}` : '');
  const abiertos = lista.filter((t) => t.estado === 'abierto');
  c.innerHTML = (lista.length ? '' : '<p class="nota">Todavía no hay tambores registrados.</p>')
    + grupo('Abiertos', abiertos) + grupo('Sin abrir', lista.filter((t) => t.estado === 'sin_abrir'))
    + grupo('Cerrados (últimos)', lista.filter((t) => t.estado === 'cerrado').slice(0, 15));
  c.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => encolar(() => accionTambor(b.dataset.accion, Number(b.dataset.t), lista)); });
}

function fichaTambor(t) {
  const pct = Math.max(0, Math.min(100, (Number(t.kg_restantes) / Number(t.kg_iniciales)) * 100));
  const etiquetas = { abierto: 'Abierto', sin_abrir: 'Sin abrir', cerrado: 'Cerrado' };
  const botones = {
    abierto: [['cerrar', 'Cerrar (se terminó)', 'sec'], ['corregir', 'Corregir', 'sec'], ['anular', 'Anular', 'peligro']],
    sin_abrir: [['abrir', 'Abrir', ''], ['corregir', 'Corregir', 'sec'], ['anular', 'Anular', 'peligro']],
    cerrado: [['reabrir', 'Reabrir', 'sec'], ['corregir', 'Corregir', 'sec']],
  }[t.estado] || [];
  return `<div class="ficha">
    <div class="cabeza"><b>${VARIEDADES[t.variedad]} · ${esc(nombreTambor(t))}</b><span class="etiqueta ${t.estado}">${etiquetas[t.estado] || t.estado}</span></div>
    ${t.estado === 'cerrado'
      ? `<p class="kg">${num(t.kg_iniciales)} kg</p><p class="chico">Envasado ${num(t.kg_envasados)} kg · rendimiento ${num(t.rendimiento * 100)} % · merma ${num(t.merma_kg)} kg</p>`
      : `<p class="kg">Quedan ${num(t.kg_restantes)} kg <span class="chico">de ${num(t.kg_iniciales)} kg</span></p><div class="barra"><i style="width:${pct}%"></i></div>
         <p class="chico">Envasado ${num(t.kg_envasados)} kg</p>`}
    <p class="chico">Registrado por ${esc(quien(t.creado_por))} el ${fechaCorta(t.ingresado_en)}${t.nota ? ` · ${esc(t.nota)}` : ''}</p>
    <div class="fila-botones">${botones.map(([a, txt, cls]) => `<button type="button" class="mini ${cls}" data-t="${t.id}" data-accion="${a}">${txt}</button>`).join('')}</div>
  </div>`;
}

async function registrarTambor(f) {
  const v = f.variedad.value; const kg = Number(String(f.kg.value).replace(',', '.'));
  if (!v) throw new Error('Elige la variedad');
  if (!(kg > 0)) throw new Error('Escribe los kilos del tambor');
  const abrir = f.abrir.checked;
  if (abrir) {
    const abiertos = E.tambores.filter((t) => t.variedad === v);
    if (abiertos.length && confirm(`Ya hay ${abiertos.length === 1 ? 'un tambor' : abiertos.length + ' tambores'} de ${VARIEDADES[v]} abierto${abiertos.length === 1 ? '' : 's'} (${abiertos.map(nombreTambor).join(', ')}).\n\n¿Se terminó y hay que cerrarlo?\nAceptar = cerrar ${abiertos.length === 1 ? 'ese tambor' : 'esos tambores'} (lo que les quede cuenta como merma)\nCancelar = dejar${abiertos.length === 1 ? 'lo' : 'los'} abierto${abiertos.length === 1 ? '' : 's'} también`)) {
      for (const t of abiertos) await rpc('tambor_cerrar', { p_id: t.id });
    }
  }
  const r = await rpc('tambor_alta', { p_variedad: v, p_kg: kg, p_identificacion: f.ident.value.trim() || null, p_abrir: abrir });
  if (abrir) guardar('tambor_' + v, r.tambor.id);
  await cargarTambores();
  pitido(true); aviso(`Tambor ${nombreTambor(r.tambor)} de ${VARIEDADES[v]} registrado (${num(kg)} kg)${abrir ? ' y abierto' : ''}.`, 'ok');
  f.reset(); f.classList.add('oculto'); $('#btnNuevoT').classList.remove('oculto');
  await pintarTambores();
}

async function accionTambor(accion, id, lista) {
  const t = lista.find((x) => x.id === id); if (!t) return;
  const nombre = `${VARIEDADES[t.variedad]} ${nombreTambor(t)}`;
  if (accion === 'abrir') {
    const otros = lista.filter((x) => x.variedad === t.variedad && x.estado === 'abierto');
    if (otros.length && confirm(`Ya hay ${otros.length === 1 ? 'otro tambor' : otros.length + ' tambores'} de ${VARIEDADES[t.variedad]} abierto${otros.length === 1 ? '' : 's'}: ${otros.map((x) => `${nombreTambor(x)} (quedan ${num(x.kg_restantes)} kg)`).join(', ')}.\n\n¿Se terminó y lo cierras? Lo que le quede cuenta como merma.\nAceptar = cerrar ese · Cancelar = dejarlo abierto también`)) {
      for (const x of otros) await rpc('tambor_cerrar', { p_id: x.id });
    }
    await rpc('tambor_abrir', { p_id: id }); guardar('tambor_' + t.variedad, id);
  } else if (accion === 'cerrar') {
    if (!confirm(`¿Cerrar el tambor ${nombre}? Quedan ${num(t.kg_restantes)} kg según la app; eso queda como merma.`)) return;
    await rpc('tambor_cerrar', { p_id: id });
  } else if (accion === 'reabrir') {
    if (!confirm(`¿Reabrir el tambor ${nombre}?`)) return;
    await rpc('tambor_reabrir', { p_id: id });
  } else if (accion === 'corregir') {
    const kg = prompt(`Kilos correctos del tambor ${nombre} (los que traía al registrarlo):`, String(t.kg_iniciales));
    if (kg === null) return;
    const ident = prompt('Nombre o identificación (puedes dejarlo igual):', t.identificacion || '');
    if (ident === null) return;
    const kgN = Number(String(kg).replace(',', '.'));
    if (!(kgN > 0)) throw new Error('Escribe los kilos del tambor (solo números, ej.: 287,5)');
    if (kgN < Number(t.kg_envasados) && !confirm(`De este tambor ya se envasaron ${num(t.kg_envasados)} kg, más que ${num(kgN)} kg: quedaría en negativo. ¿Corregir igual?`)) return;
    await rpc('tambor_corregir', { p_id: id, p_kg: kgN, p_identificacion: ident });
  } else if (accion === 'anular') {
    const motivo = prompt(`¿Por qué se anula el tambor ${nombre}? (ej.: "lo registré dos veces")`);
    if (motivo === null) return;
    await rpc('tambor_anular', { p_id: id, p_motivo: motivo });
  }
  pitido(true); aviso('Listo.', 'ok');
  await cargarTambores(); await pintarTambores();
}

// ───────── Historial (con Deshacer) ─────────

PANTALLAS.historial = async () => {
  E.ctx.limite = 40;
  app.innerHTML = guia('historial', [
    'Aquí queda todo lo registrado, con quién y cuándo. Lo más nuevo arriba.',
    '<b>Deshacer</b> crea un movimiento contrario: nada se borra, queda la huella.',
    'Para deshacer un retiro, el pedido vuelve a "Por retirar".',
  ]) + `<div id="hist" class="lista"><p class="nota">Cargando…</p></div>
  <button type="button" class="sec ancho oculto" id="masHist">Ver más</button>`;
  $('#masHist').onclick = () => { E.ctx.limite += 40; pintarHistorial(); };
  await pintarHistorial();
};

async function pintarHistorial() {
  const lim = E.ctx.limite;
  const data = await consulta(sb.from('v_historial').select('*').order('fecha', { ascending: false }).limit(lim + 1));
  const c = $('#hist'); if (!c) return;
  const items = data.slice(0, lim);
  $('#masHist').classList.toggle('oculto', data.length <= lim);
  c.innerHTML = items.length ? items.map((o) => `<div class="ficha mov ${o.anulada ? 'anulada' : ''}">
      <div class="cabeza"><b>${TIPOS_OP[o.tipo] || o.tipo}</b><span class="chico">${fecha(o.fecha)} · ${esc(quien(o.usuaria))}</span></div>
      ${o.pedido ? `<div class="chico">${esc(o.pedido)}</div>` : ''}
      <div class="resumen">${esc(o.resumen || (o.tipo === 'retiro' ? 'Salida del pedido' : ''))}</div>
      ${o.nota ? `<div class="chico">Nota: ${esc(o.nota)}</div>` : ''}
      ${o.anulada ? '<div class="chico">Deshecho</div>' : o.tipo !== 'anulacion' ? `<div class="fila-botones"><button type="button" class="mini sec" data-anular="${o.id}">Deshacer</button></div>` : ''}
    </div>`).join('') : '<p class="nota">Todavía no hay nada registrado.</p>';
  c.querySelectorAll('[data-anular]').forEach((b) => {
    b.onclick = () => {
      const o = items.find((x) => x.id === Number(b.dataset.anular));
      if (!confirm(`¿Deshacer este registro?\n\n${TIPOS_OP[o.tipo]} · ${o.resumen || o.pedido || ''}`)) return;
      encolar(async () => {
        await rpc('op_anular', { p_operacion: o.id, p_motivo: `Deshecho desde el Historial por ${E.nombre}` });
        pitido(true); aviso('Listo, se deshizo.', 'ok');
        await cargarTambores(); await pintarHistorial();
      });
    };
  });
}

// ───────── Conteo de inventario ─────────

PANTALLAS.conteo = async () => {
  app.innerHTML = guia('conteo', [
    'Cuenta lo que hay <b>físicamente</b> en la bodega y escríbelo aquí, incluido lo que ya está apartado para pedidos o facturas que aún no retiran. Si es la primera vez, esto crea el inventario inicial.',
    'Deja en blanco lo que no contaste (queda como está). Si lo contaste y no hay, escribe <b>0</b>.',
    'Aprieta <b>Revisar</b>: la app te muestra qué va a cambiar. Al guardar, corrige solo la diferencia (se puede deshacer en el Historial).',
    'Los tambores no van aquí: se registran en <b>Tambores</b> con los kilos que les quedan.',
  ]) + `<section class="tarjeta"><table class="tabla" id="tablaConteo"><tr><td class="nota">Cargando…</td></tr></table>
    <label style="margin-top:12px">Nota<input id="notaConteo"></label></section>
  <div id="cambios"></div>
  <div class="fila-botones"><button type="button" id="btnRevisar">Revisar</button><button type="button" class="oculto" id="btnGuardarConteo">Guardar conteo</button></div>`;
  const [s, ops] = await Promise.all([
    consulta(sb.from('v_stock').select('*').eq('activo', true).order('orden')),
    sb.from('operaciones').select('id', { count: 'exact', head: true }),
  ]);
  const t = $('#tablaConteo'); if (!t) return;
  E.ctx.stock = s;
  $('#notaConteo').value = ops.count ? `Conteo ${new Date().toLocaleDateString('es-CL')}` : 'Conteo inicial';
  t.innerHTML = '<tr><th>Producto</th><th class="num">Cajas</th><th class="num">Sueltas / unidades</th></tr>' + s.map((x) => `<tr>
      <td><b>${esc(x.nombre)}</b><br><span class="chico">La app tiene: ${textoStock(x, x.sueltas, x.cajas)}</span></td>
      <td class="num">${x.caja_controlada ? `<input type="number" min="0" inputmode="numeric" data-conteo="${x.id}" data-campo="cajas" placeholder="cajas" aria-label="Cajas de ${esc(x.nombre)}">` : '<span class="chico">—</span>'}</td>
      <td class="num"><input type="number" min="0" inputmode="numeric" data-conteo="${x.id}" data-campo="sueltas" placeholder="${unidadDe(x)[1]}" aria-label="Sueltas de ${esc(x.nombre)}"></td></tr>`).join('');
  t.querySelectorAll('input').forEach((i) => { i.oninput = () => { $('#btnGuardarConteo').classList.add('oculto'); $('#cambios').innerHTML = ''; }; });
  $('#btnRevisar').onclick = revisarConteo;
  $('#btnGuardarConteo').onclick = () => encolar(guardarConteo);
};

// Un campo en blanco = no contado: conserva lo que la app tiene en ese campo
// paraEnviar = true: los campos en blanco van como null y la base los deja como están en ese momento
function leerConteo(paraEnviar = false) {
  const filas = new Map();
  app.querySelectorAll('[data-conteo]').forEach((i) => {
    if (i.value === '') return;
    const x = E.ctx.stock.find((s) => s.id === i.dataset.conteo);
    const f = filas.get(i.dataset.conteo) || (paraEnviar ? { producto: i.dataset.conteo, sueltas: null, cajas: null }
      : { producto: i.dataset.conteo, sueltas: x.sueltas, cajas: x.caja_controlada ? x.cajas : 0 });
    f[i.dataset.campo] = parseInt(i.value, 10) || 0;
    filas.set(i.dataset.conteo, f);
  });
  return [...filas.values()];
}
function revisarConteo() {
  const items = leerConteo(); const c = $('#cambios');
  if (!items.length) { c.innerHTML = '<p class="error">No escribiste ninguna cantidad.</p>'; return; }
  const cambios = items.map((it) => {
    const x = E.ctx.stock.find((s) => s.id === it.producto);
    const dc = x.caja_controlada ? it.cajas - x.cajas : 0; const ds = it.sueltas - x.sueltas;
    if (!dc && !ds) return null;
    const signo = (n, uno, varios) => (n ? `${n > 0 ? '+' : '−'}${plural(Math.abs(n), uno, varios)}` : '');
    const [uno, varios] = unidadDe(x);
    return `<li><b>${esc(x.nombre)}</b>: la app tenía ${textoStock(x, x.sueltas, x.cajas)}, queda en ${textoStock(x, it.sueltas, it.cajas)} (${[signo(dc, 'caja', 'cajas'), signo(ds, uno, varios)].filter(Boolean).join(', ')})</li>`;
  }).filter(Boolean);
  if (!cambios.length) { c.innerHTML = '<p class="cuadra">Todo lo que contaste coincide con la app. No hay nada que corregir.</p>'; $('#btnGuardarConteo').classList.add('oculto'); return; }
  c.innerHTML = `<div class="resumen-cambios"><b>Esto va a cambiar:</b><ul>${cambios.join('')}</ul></div>`;
  $('#btnGuardarConteo').classList.remove('oculto');
}
async function guardarConteo() {
  const items = leerConteo(true); if (!items.length) return;
  const nota = $('#notaConteo').value.trim();
  const r = await rpc('op_conteo', { p_items: items, p_nota: nota });
  pitido(true);
  aviso(`Conteo guardado: ${plural(r.cambios, 'producto corregido', 'productos corregidos')}.`, 'ok', { texto: 'Deshacer', fn: () => encolar(async () => {
    if (!confirm('¿Deshacer el conteo completo? El stock vuelve a lo que tenía antes.')) return;
    await rpc('op_anular', { p_operacion: r.operacion, p_motivo: `Conteo deshecho al momento por ${E.nombre}` });
    aviso('Conteo deshecho.', 'ok'); if (E.pantalla === 'stock') ir('stock', {}, { historial: false });
  }) });
  ir('stock', {}, { reemplazar: true });
}

// ───────── Registrar código ─────────

PANTALLAS.codigo = ({ codigo }) => {
  app.innerHTML = guia('codigo', [
    'Úsalo cuando la pistola lee una etiqueta que la app no conoce.',
    'Pistolea la etiqueta (o escribe el número), elige el producto y si es de frasco o de caja.',
  ]) + `${htmlPistola('Pistolea la etiqueta nueva')}
  <form id="fCod" class="tarjeta">
    <label>Código<input name="codigo" inputmode="numeric" required value="${esc(codigo || '')}"></label>
    <label>Producto<select name="producto" required><option value="">Elige…</option>
      ${[...E.productos.values()].filter((p) => p.activo).map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
    <fieldset><legend>Es el código de…</legend>
      <label class="radio"><input type="radio" name="tipo" value="unidad" checked> un frasco o cajita (unidad)</label>
      <label class="radio"><input type="radio" name="tipo" value="caja"> una caja (de 12 en 300 y 550 g; de 10 en 500 g y 1 kg)</label>
    </fieldset>
    <button type="submit">Registrar</button>
  </form>`;
  const f = $('#fCod');
  activarPistola(async (cod) => {
    const c = E.codigos.get(cod);
    if (c) throw new Error(`Ese código ya es de ${E.productos.get(c.producto_id).nombre} (${c.tipo})`);
    f.codigo.value = cod; registrar(true, `Código ${cod} leído: elige el producto y aprieta Registrar`);
  });
  f.onsubmit = (ev) => {
    ev.preventDefault();
    encolar(async () => {
      const cod = f.codigo.value.trim();
      if (!/^[0-9]{8,14}$/.test(cod)) throw new Error('El código debe tener entre 8 y 14 números');
      const r = await rpc('registrar_codigo', { p_codigo: cod, p_producto: f.producto.value, p_tipo: f.tipo.value });
      E.codigos.set(r.codigo, { codigo: r.codigo, producto_id: r.producto, tipo: r.tipo });
      aviso(`Código ${r.codigo} registrado como ${E.productos.get(r.producto).nombre} (${r.tipo})`, 'ok'); pitido(true);
      const v = E.volverA; E.volverA = null;
      if (v) ir(v.p, { id: v.id }); else { f.reset(); registrar(true, `Código ${r.codigo} registrado`); }
    });
  };
};

// ───────── Configuración ─────────

function resetAvisos() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('no_mostrar_')).forEach((k) => localStorage.removeItem(k)); } catch { /* sin almacenamiento */ }
  aviso('Listo: los avisos se vuelven a mostrar.', 'ok');
}

PANTALLAS.config = async () => {
  app.innerHTML = guia('config', [
    'Cambia el nombre de un producto o de un tambor y aprieta <b>Guardar</b> en esa fila.',
    'El nombre nuevo se ve en toda la app, también en el historial. Los códigos de barra no cambian.',
  ]) + `<section class="tarjeta"><h3>Productos</h3><div id="cfgProd" class="cfg"></div></section>
  <section class="tarjeta"><h3>Tambores</h3><p class="nota">${enlazar('Abiertos y sin abrir. Para corregir los kilos, usa <b>Tambores</b>.')}</p><div id="cfgTamb" class="cfg"><p class="nota">Cargando…</p></div></section>
  <section class="tarjeta"><h3>Avisos</h3><p class="nota">Si marcaste "No volver a mostrar" en un aviso (por ejemplo, al encajar) y quieres verlo de nuevo.</p>
    <button type="button" class="sec" id="resetAvisos">Volver a mostrar los avisos</button></section>`;
  $('#resetAvisos').onclick = resetAvisos;
  $('#cfgProd').innerHTML = [...E.productos.values()].filter((p) => p.activo).map((p) => `<div class="cfg-fila">
      <input value="${esc(p.nombre)}" data-prod="${p.id}" aria-label="Nombre de ${esc(p.nombre)}"><button type="button" class="mini" data-guardar-prod="${p.id}">Guardar</button></div>`).join('');
  $('#cfgProd').querySelectorAll('[data-guardar-prod]').forEach((b) => {
    b.onclick = () => encolar(async () => {
      const id = b.dataset.guardarProd; const nombre = app.querySelector(`[data-prod="${id}"]`).value.trim();
      if (nombre === E.productos.get(id).nombre) { aviso('Ese nombre no cambió.'); return; }
      const r = await rpc('producto_renombrar', { p_id: id, p_nombre: nombre });
      E.productos.get(id).nombre = r.nombre; pitido(true); aviso(`"${r.antes}" ahora se llama "${r.nombre}".`, 'ok');
    });
  });
  const ts = await consulta(sb.from('v_tambores').select('*').in('estado', ['abierto', 'sin_abrir']).order('creado_en', { ascending: false }));
  const c = $('#cfgTamb'); if (!c) return;
  c.innerHTML = ts.length ? ts.map((t) => `<div class="cfg-fila ${CLASE_VARIEDAD[t.variedad]}"><span class="chico">${VARIEDADES[t.variedad]} · ${num(t.kg_iniciales)} kg</span>
      <input value="${esc(t.identificacion || '')}" placeholder="Sin nombre (N.º ${t.id})" data-tamb="${t.id}" aria-label="Nombre del tambor ${t.id}"><button type="button" class="mini" data-guardar-tamb="${t.id}">Guardar</button></div>`).join('')
    : '<p class="nota">No hay tambores abiertos ni sin abrir.</p>';
  c.querySelectorAll('[data-guardar-tamb]').forEach((b) => {
    b.onclick = () => encolar(async () => {
      const t = ts.find((x) => x.id === Number(b.dataset.guardarTamb)); const nombre = app.querySelector(`[data-tamb="${t.id}"]`).value.trim();
      if (!nombre) throw new Error('Escribe un nombre para el tambor.');
      if (nombre === (t.identificacion || '')) { aviso('Ese nombre no cambió.'); return; }
      await rpc('tambor_corregir', { p_id: t.id, p_kg: Number(t.kg_iniciales), p_identificacion: nombre });
      t.identificacion = nombre; await cargarTambores(); pitido(true); aviso(`Tambor renombrado: ${nombre}.`, 'ok');
    });
  });
};

// ───────── Ayuda ─────────

PANTALLAS.ayuda = () => {
  app.innerHTML = enlazar(`<section class="tarjeta"><h3>Cómo funciona</h3>
    <p>Cada cosa que pasa en la bodega se registra pistoleando: envasar, juntar cajas, preparar y retirar pedidos. Con eso la app calcula sola el stock y los kilos de cada tambor. Nada se borra: si alguien se equivoca, se deshace y queda anotado quién y cuándo.</p></section>
  <section class="tarjeta"><h3>Primer día</h3><ol>
    <li>En <b>Tambores</b>, registra cada tambor con sus kilos (si está empezado, los kilos que le quedan) y abre los que estás usando.</li>
    <li>En <b>Conteo de inventario</b>, escribe cuántas cajas y frascos sueltos hay de cada producto.</li>
    <li>Desde ahí, cada envasado, caja, pedido y retiro se registra en su pantalla.</li></ol></section>
  <section class="tarjeta"><h3>Conectar la pistola</h3>
    <p>La pistola funciona como un teclado: lee el código, lo "escribe" y aprieta Enter. Por eso sirve con cualquier aparato:</p><ul>
    <li><b>Computador</b>: enchúfala por USB y listo.</li>
    <li><b>Celular o tablet Android</b>: si es inalámbrica, emparéjala en Ajustes → Bluetooth (en modo teclado, "HID"; el manual de la pistola trae el código para activarlo). Si es con cable, necesitas un adaptador USB-C a USB (OTG).</li>
    <li>Para probar, abre <b>Envasar</b>. El recuadro "Esperando la pistola" debe estar marcado; pistolea un frasco y debe aparecer la línea con un pitido.</li></ul>
    <p class="chico">El celular no abre su teclado en ese recuadro, para que no tape la pantalla. Para escribir un código o buscar un producto por nombre (por ejemplo, "balde"), usa "Escribir a mano": las opciones aparecen mientras escribes.</p></section>
  <section class="tarjeta"><h3>Si me equivoco</h3><ul>
    <li>Justo después: toca <b>Deshacer</b> en la línea.</li>
    <li>Más tarde: entra al <b>Historial</b> y toca <b>Deshacer</b> en ese registro.</li>
    <li>Un pedido mal cargado: ábrelo en <b>Por retirar</b> y toca <b>Editar pedido</b> (o <b>Anular</b>). Una factura con la cadena equivocada: <b>Corregir cadena</b>.</li>
    <li>Un tambor mal anotado: en <b>Tambores</b>, usa <b>Corregir</b> o <b>Anular</b>.</li></ul></section>
  <section class="tarjeta"><h3>Pedidos de Mercado Libre, web, clientes y encargos de Berni</h3><ol>
    <li>Berni (o quien lo reciba) lo carga en <b>Nuevo pedido</b>, eligiendo a quién va: Mercado Libre, Creado en Chile, Berni (ventas web y lo que ella pida) o un cliente.</li>
    <li>Aparece en <b>Por retirar</b>, con el número de pendientes en el menú. Ahí la Pipa lo abre y lo prepara pistoleando cada frasco o caja; la línea avanza y avisa si sobra o falta.</li>
    <li>Cuando sale de la bodega (lo retira el courier, Berni o el cliente), se aprieta <b>Marcar retirado</b> y recién ahí se descuenta del stock.</li></ol>
    <p class="chico">Las facturas de supermercado siguen el mismo camino, pero se cargan con <b>Subir factura</b>.</p></section>
  <section class="tarjeta"><h3>Varios iguales de una vez</h3>
    <p>En <b>Envasar</b> y al preparar un pedido, toca ×10, ×12 u Otra (la cantidad se escribe ahí mismo) y pistolea un solo frasco o caja: esa lectura cuenta por esa cantidad. Después vuelve sola a ×1.</p>
    <p class="chico">Los frascos de 500 g y 1 kg tienen código y se pistolean igual que los demás. Sus cajas de 10 casi nunca llevan etiqueta: se registran en <b>Encajar</b>, en el recuadro "Encajar sin pistolear".</p></section>
  <section class="tarjeta"><h3>Nombres y avisos</h3>
    <p>Para cambiar el nombre de un producto o de un tambor, o volver a mostrar los avisos que marcaste "No volver a mostrar", entra a <b>Configuración</b>.</p></section>`);
};

iniciar();
