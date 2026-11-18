// Mailemu Bodega · pantalla de Bodega (etapa 2)
// JS sin compilación. Toda escritura va por las funciones de Postgres (03_funciones.sql);
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
// La app sugiere; quien sube la factura decide (Jumbo y Santa Isabel comparten RUT).
const RUT_CADENA = {
  '76042014-K': { sugerida: 'lider', texto: 'RUT de Walmart: sugerencia Líder. Marca también el CD.' },
  '81201000-K': { sugerida: null, texto: 'RUT de Cencosud: Jumbo y Santa Isabel comparten RUT. Márcala tú.' },
};

const E = {
  usuaria: null, nombre: '', productos: new Map(), codigos: new Map(), tambores: [],
  log: [], pantalla: null, ctx: {}, volverA: null, factura: null,
};

const app = document.getElementById('app');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n ?? 0).toLocaleString('es-CL', { maximumFractionDigits: 1 });
const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

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

function aviso(texto, tipo = 'info') {
  const d = document.createElement('div');
  d.className = 'aviso ' + tipo; d.textContent = texto; d.onclick = () => d.remove();
  $('#avisos').appendChild(d);
  setTimeout(() => d.remove(), tipo === 'error' || tipo === 'alerta' ? 8000 : 4500);
}
const avisosDe = (r) => (r?.avisos || []).forEach((a) => aviso(a, 'alerta'));

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

function resumenCant(cj, u) {
  return [cj ? `${cj} caja${cj === 1 ? '' : 's'}` : '', u ? `${u} unidad${u === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' + ') || 'sin productos';
}
const textoStock = (s) => (!s ? '' : s.caja_controlada ? `${num(s.cajas)} cj + ${num(s.sueltas)} u` : `${num(s.sueltas)} u`);
const nombreTambor = (t) => (t.identificacion ? t.identificacion : `N.º ${t.id}`);

// Cola: cada pistoleo se graba en orden, uno tras otro.
let cola = Promise.resolve();
function encolar(fn) {
  cola = cola.then(fn).catch((e) => {
    registrar(false, mensaje(e));
    if (e.desconocido) pintarDesconocido(e.desconocido);
  });
}

// ───────── Pistola ─────────

function htmlPistola(texto) {
  return `<div class="pistola">
    <label for="scan">${esc(texto)}</label>
    <div class="fila">
      <input id="scan" inputmode="none" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Esperando la pistola…">
      <button type="button" class="sec" id="manual">Escribir a mano</button>
    </div>
  </div>
  <div id="desc"></div>
  <ul id="log" class="log"></ul>`;
}

function activarPistola(alLeer) {
  const inp = $('#scan'); if (!inp) return;
  let manual = false;
  const enfocar = () => {
    if ($('#scan') !== inp) return; // ya se cambió de pantalla
    const a = document.activeElement;
    if (a && a !== inp && a.matches('input, select, textarea')) return; // no robar el foco a otro campo
    inp.focus({ preventScroll: true });
  };
  inp.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== 'Tab') return;
    ev.preventDefault();
    const v = inp.value.trim(); inp.value = '';
    if (v) encolar(() => alLeer(v));
    if (manual) { manual = false; inp.setAttribute('inputmode', 'none'); inp.blur(); }
  });
  inp.addEventListener('blur', () => setTimeout(enfocar, 150));
  $('#manual').onclick = () => { manual = true; inp.setAttribute('inputmode', 'numeric'); inp.blur(); setTimeout(() => inp.focus(), 30); };
  enfocar(); pintarLog();
}

function registrar(ok, texto) {
  E.log.unshift({ ok, texto, hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) });
  E.log = E.log.slice(0, 8);
  pitido(ok); pintarLog();
  if (ok) { const d = $('#desc'); if (d) d.innerHTML = ''; }
}
function pintarLog() {
  const ul = $('#log'); if (!ul) return;
  ul.innerHTML = E.log.map((l) => `<li class="${l.ok ? 'ok' : 'mal'}"><span>${esc(l.hora)}</span>${esc(l.texto)}</li>`).join('')
    || '<li class="vacio">Todavía no hay registros en esta pantalla.</li>';
}
function pintarDesconocido(cod) {
  const d = $('#desc'); if (!d) return;
  E.volverA = { p: E.pantalla, id: E.ctx.id };
  d.innerHTML = `<button type="button" class="sec ancho" data-ir="codigo" data-codigo="${esc(cod)}">Registrar el código ${esc(cod)}</button>`;
}

function buscarCodigo(cod) {
  const c = E.codigos.get(cod);
  if (!c) { const e = new Error(`Código desconocido: ${cod}`); e.desconocido = cod; throw e; }
  return { tipo: c.tipo, p: E.productos.get(c.producto_id) };
}

// ───────── Datos base ─────────

async function cargarBase() {
  const [p, c] = await Promise.all([
    sb.from('productos').select('*').order('orden'),
    sb.from('codigos').select('*'),
  ]);
  if (p.error || c.error) throw new Error((p.error || c.error).message);
  E.productos = new Map(p.data.map((x) => [x.id, x]));
  E.codigos = new Map(c.data.map((x) => [x.codigo, x]));
  await cargarTambores();
}
async function cargarTambores() {
  const { data, error } = await sb.from('v_tambores').select('*').eq('estado', 'abierto').order('abierto_en', { ascending: false });
  if (error) throw new Error(error.message);
  E.tambores = data;
}
function tamborDe(variedad) {
  const abiertos = E.tambores.filter((t) => t.variedad === variedad);
  if (!abiertos.length) return null;
  const elegido = Number(leer('tambor_' + variedad));
  return abiertos.find((t) => t.id === elegido) || abiertos[0]; // por defecto, el abierto más reciente
}

// ───────── Navegación ─────────

const PANTALLAS = {};
function ir(p, ctx = {}) {
  if (p === 'codigo' && !ctx.codigo) E.volverA = null; // entrada desde el menú: no volver a otra pantalla
  E.pantalla = p; E.ctx = ctx; E.log = [];
  window.scrollTo(0, 0); pintarCabecera();
  Promise.resolve(PANTALLAS[p](ctx)).catch((e) => aviso(mensaje(e), 'error'));
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ir]'); if (!b || !E.usuaria) return;
  ev.preventDefault();
  ir(b.dataset.ir, { id: b.dataset.id ? Number(b.dataset.id) : undefined, codigo: b.dataset.codigo });
});

function pintarCabecera() {
  $('#cab').innerHTML = `<button class="marca" ${E.usuaria ? 'data-ir="inicio"' : ''}>Mailemu<span>Bodega</span></button>
    ${E.usuaria ? `<div class="quien"><span>${esc(E.nombre)}</span><button class="enlace" id="salir">Salir</button></div>` : ''}`;
  const s = $('#salir');
  if (s) s.onclick = async () => { if (confirm('¿Cerrar sesión en este aparato?')) await sb.auth.signOut(); };
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
    const { data } = await sb.from('usuarias').select('nombre').eq('email', E.usuaria).maybeSingle();
    E.nombre = data?.nombre || E.usuaria;
    await cargarBase();
    ir('inicio');
  } catch (e) {
    pintarCabecera();
    app.innerHTML = `<div class="tarjeta"><p class="error">${esc(mensaje(e))}</p><button onclick="location.reload()">Reintentar</button></div>`;
  }
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') pantallaLogin(); });

function pantallaLogin() {
  E.usuaria = null; pintarCabecera();
  app.innerHTML = `<form class="tarjeta login" id="fLogin">
    <h1>Bodega Mailemu</h1>
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

// ───────── Inicio ─────────

PANTALLAS.inicio = async () => {
  app.innerHTML = `<p class="saludo">Hola, ${esc(E.nombre)}. ¿Qué vas a hacer?</p>
  <div class="menu">
    <button class="grande" data-ir="envasar"><b>Envasar</b><span>Frascos y cajas desde el tambor</span></button>
    <button class="grande" data-ir="encajar"><b>Encajar</b><span>12 frascos sueltos a una caja</span></button>
    <button class="grande" data-ir="pack"><b>Armar pack</b><span>Pack Variedades 3 × 300 g</span></button>
    <button class="grande" data-ir="pedidos"><b>Por retirar <span class="contador oculto" id="nPend"></span></b><span>Preparar pedidos y facturas, marcar retirado</span></button>
    <button class="grande" data-ir="factura"><b>Subir factura</b><span>XML de Defontana</span></button>
    <button class="grande sec" data-ir="codigo"><b>Registrar código</b><span>Etiqueta que la app no conoce</span></button>
  </div>`;
  const { count } = await sb.from('pedidos').select('id', { count: 'exact', head: true }).eq('estado', 'por_retirar');
  const n = $('#nPend'); if (n && count) { n.textContent = count; n.classList.remove('oculto'); }
};

// ───────── Envasar ─────────

PANTALLAS.envasar = () => {
  app.innerHTML = `<h2>Envasar</h2>
  ${htmlPistola('Pistolea el frasco (+1 suelto) o la caja (+1 caja de 12)')}
  <h3>Tambores abiertos</h3>
  <section class="tambores" id="tambores"></section>
  <p><button type="button" class="sec" id="btnTambor">Abrir tambor nuevo</button></p>
  <form id="fTambor" class="tarjeta oculto">
    <h3>Abrir tambor nuevo</h3>
    <label>Variedad<select name="variedad" required>${Object.entries(VARIEDADES).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
    <label>Kilos (los anotados por fuera)<input name="kg" type="number" inputmode="decimal" min="1" step="0.1" required></label>
    <label>Identificación (opcional)<input name="ident" placeholder="Ej.: T-U4 o lo que diga el tambor"></label>
    <div class="botonera"><button type="submit">Abrir tambor</button><button type="button" class="sec" id="cancTambor">Cancelar</button></div>
  </form>
  <section class="tarjeta"><h3>Sin código</h3>
    <p class="nota">500 g y 1 kg: el botón suma una caja de 10 unidades (los frascos sueltos se pistolean). Baldes: se registran aquí.</p>
    <div class="botonera" id="sinCodigo"></div>
  </section>`;
  pintarTambores();
  const f = $('#fTambor');
  $('#btnTambor').onclick = () => { f.classList.remove('oculto'); f.kg.focus(); };
  $('#cancTambor').onclick = () => { f.reset(); f.classList.add('oculto'); };
  f.onsubmit = (ev) => { ev.preventDefault(); encolar(() => abrirTambor(f)); };
  $('#sinCodigo').innerHTML = [...E.productos.values()]
    .filter((p) => p.activo && p.variedad && !p.caja_controlada)
    .map((p) => `<button type="button" class="sec" data-envasar="${p.id}">${esc(p.nombre)} · ${p.uds_por_caja ? `+1 caja (${p.uds_por_caja} u)` : '+1 balde'}</button>`)
    .join('');
  $('#sinCodigo').querySelectorAll('[data-envasar]').forEach((b) => {
    b.onclick = () => { const p = E.productos.get(b.dataset.envasar); encolar(() => envasar(p, p.uds_por_caja || 1, 0)); };
  });
  activarPistola(async (cod) => {
    const { p, tipo } = buscarCodigo(cod);
    await envasar(p, tipo === 'caja' ? 0 : 1, tipo === 'caja' ? 1 : 0);
  });
};

function pintarTambores() {
  const s = $('#tambores'); if (!s) return;
  s.innerHTML = Object.entries(VARIEDADES).map(([v, nombre]) => {
    const abiertos = E.tambores.filter((t) => t.variedad === v);
    const t = tamborDe(v);
    if (!t) return `<div class="tambor falta"><b>${nombre}</b><span>Sin tambor abierto</span></div>`;
    const sel = abiertos.length > 1
      ? `<select data-variedad="${v}" aria-label="Tambor de ${nombre}">${abiertos.map((a) => `<option value="${a.id}" ${a.id === t.id ? 'selected' : ''}>${esc(nombreTambor(a))} · quedan ${num(a.kg_restantes)} kg</option>`).join('')}</select>`
      : '';
    return `<div class="tambor"><b>${nombre}</b><span>Envasando del tambor ${esc(nombreTambor(t))}</span><small>Quedan ${num(t.kg_restantes)} de ${num(t.kg_iniciales)} kg</small>${sel}</div>`;
  }).join('');
  s.querySelectorAll('select[data-variedad]').forEach((x) => {
    x.onchange = () => { guardar('tambor_' + x.dataset.variedad, x.value); pintarTambores(); x.blur(); };
  });
}

async function abrirTambor(f) {
  const v = f.variedad.value; const kg = Number(String(f.kg.value).replace(',', '.'));
  if (!(kg > 0)) throw new Error('Escribe los kilos del tambor');
  const abiertos = E.tambores.filter((t) => t.variedad === v);
  if (abiertos.length && confirm(`Ya hay ${abiertos.length === 1 ? 'un tambor' : abiertos.length + ' tambores'} de ${VARIEDADES[v]} abierto${abiertos.length === 1 ? '' : 's'} (${abiertos.map(nombreTambor).join(', ')}).\n\n¿Cerrarlo ahora? Aceptar = cerrar · Cancelar = dejarlo abierto`)) {
    for (const t of abiertos) await rpc('tambor_cerrar', { p_id: t.id });
  }
  const r = await rpc('tambor_alta', { p_variedad: v, p_kg: kg, p_identificacion: f.ident.value.trim() || null, p_abrir: true });
  guardar('tambor_' + v, r.tambor.id);
  await cargarTambores(); pintarTambores();
  f.reset(); f.classList.add('oculto');
  registrar(true, `Tambor ${nombreTambor(r.tambor)} de ${VARIEDADES[v]} abierto (${num(kg)} kg)`);
}

async function envasar(p, sueltas, cajas) {
  if (!p.variedad) throw new Error('El pack se registra en "Armar pack"');
  const t = tamborDe(p.variedad);
  if (!t) throw new Error(`No hay tambor abierto de ${VARIEDADES[p.variedad]}: ábrelo arriba antes de envasar.`);
  const r = await rpc('op_envasar', { p_producto: p.id, p_tambor: t.id, p_sueltas: sueltas, p_cajas: cajas });
  const i = E.tambores.findIndex((x) => x.id === r.tambor.id); if (i >= 0) E.tambores[i] = r.tambor;
  pintarTambores(); avisosDe(r);
  const que = cajas ? `+${cajas} caja de 12` : !p.uds_por_caja ? '+1 balde' : sueltas === 1 ? '+1 frasco' : `+${sueltas} u`;
  registrar(true, `${p.nombre} ${que} · stock ${textoStock(r.stock)} · tambor ${nombreTambor(r.tambor)}: quedan ${num(r.tambor.kg_restantes)} kg`);
}

// ───────── Encajar y armar pack ─────────

PANTALLAS.encajar = () => {
  app.innerHTML = `<h2>Encajar</h2>
  <p class="nota">Pistolea el código de la caja: suma 1 caja y resta 12 frascos sueltos. Solo 300 g y 550 g.</p>
  ${htmlPistola('Pistolea la caja')}`;
  activarPistola(async (cod) => {
    const { p, tipo } = buscarCodigo(cod);
    if (tipo !== 'caja') throw new Error(`${p.nombre}: ese es el código del frasco. Pistolea el de la caja.`);
    const r = await rpc('op_encajar', { p_producto: p.id, p_cajas: 1 });
    avisosDe(r); registrar(true, `${p.nombre} +1 caja · stock ${textoStock(r.stock)}`);
  });
};

PANTALLAS.pack = () => {
  app.innerHTML = `<h2>Armar pack</h2>
  <p class="nota">Pistolea la cajita del Pack Variedades: suma 1 pack y resta 1 frasco suelto de Ulmo, Bosque Nativo y Quillay 300 g.</p>
  ${htmlPistola('Pistolea la cajita del pack')}
  <button type="button" class="sec" id="packManual">+1 pack sin pistolear</button>`;
  const armar = async () => {
    const r = await rpc('op_armar_pack', { p_cantidad: 1 });
    avisosDe(r); registrar(true, `+1 pack · ${num(r.stock?.sueltas)} armados · resta 1 frasco de cada 300 g`);
  };
  $('#packManual').onclick = () => encolar(armar);
  activarPistola(async (cod) => {
    const { p } = buscarCodigo(cod);
    if (p.id !== 'pack') throw new Error(`Ese código es de ${p.nombre}, no del pack.`);
    await armar();
  });
};

// ───────── Por retirar ─────────

PANTALLAS.pedidos = async () => {
  app.innerHTML = `<h2>Por retirar</h2><p class="nota">Pedidos y facturas comprometidos. Tócalos para prepararlos pistoleando o marcarlos retirados.</p><div id="lista" class="lista"><p class="nota">Cargando…</p></div>`;
  const { data, error } = await sb.from('v_pedidos').select('*').eq('estado', 'por_retirar').order('creado_en');
  if (error) throw new Error(error.message);
  const l = $('#lista'); if (!l) return;
  l.innerHTML = data.length ? data.map((p) => {
    const total = p.cajas + p.unidades; const prep = p.cajas_prep + p.unidades_prep;
    return `<button class="pedido ${p.completo ? 'listo' : ''}" data-ir="preparar" data-id="${p.id}">
      <b>${esc(p.etiqueta)}</b>
      <span>${resumenCant(p.cajas, p.unidades)}${p.oc ? ` · OC ${esc(p.oc)}` : ''}${p.nota ? ` · ${esc(p.nota)}` : ''}</span>
      <span class="progreso">${p.completo ? 'Listo para retirar' : `Pistoleado ${prep} de ${total}`}</span></button>`;
  }).join('') : '<p class="nota">No hay pedidos ni facturas por retirar.</p>';
};

PANTALLAS.preparar = async ({ id }) => {
  app.innerHTML = `<button type="button" class="volver sec" data-ir="pedidos">← Por retirar</button>
  <h2 id="titPed">Cargando…</h2><p id="resPed" class="nota"></p>
  ${htmlPistola('Pistolea cada frasco o caja de este pedido')}
  <section class="tarjeta"><table class="lineas" id="lineas"></table></section>
  <button type="button" class="grande" id="btnRetirar"><b>Marcar retirado</b><span>Sale del stock lo que dice el pedido</span></button>`;
  activarPistola(async (cod) => { const { p, tipo } = buscarCodigo(cod); await preparar(id, p, tipo); });
  $('#btnRetirar').onclick = () => encolar(() => retirar(id));
  const [p, l] = await Promise.all([
    sb.from('v_pedidos').select('*').eq('id', id).single(),
    sb.from('v_pedido_lineas').select('*').eq('pedido_id', id).order('orden'),
  ]);
  if (p.error || l.error) throw new Error((p.error || l.error).message);
  if (E.pantalla !== 'preparar' || E.ctx.id !== id) return;
  E.ctx.pedido = p.data; E.ctx.lineas = l.data;
  pintarPedido();
};

const tieneCodigo = (prod, unidad) => [...E.codigos.values()].some((c) => c.producto_id === prod && c.tipo === unidad);

function pintarPedido() {
  const p = E.ctx.pedido; const ls = E.ctx.lineas; if (!p || !$('#lineas')) return;
  const total = p.cajas + p.unidades; const prep = p.cajas_prep + p.unidades_prep;
  $('#titPed').textContent = p.etiqueta;
  $('#resPed').textContent = `${resumenCant(p.cajas, p.unidades)}${p.oc ? ` · OC ${p.oc}` : ''} · pistoleado ${prep} de ${total}`
    + (p.estado !== 'por_retirar' ? ` · ${p.estado.replace('_', ' ')}` : '');
  $('#lineas').innerHTML = '<tr><th>Producto</th><th>Pide</th><th>Listo</th><th></th></tr>' + ls.map((l) =>
    `<tr class="${l.faltan === 0 ? 'ok' : ''}"><td>${esc(l.producto)}</td><td>${l.cantidad} ${l.unidad === 'caja' ? 'cj' : 'u'}</td><td>${l.preparado}</td>
     <td>${!tieneCodigo(l.producto_id, l.unidad) && l.faltan > 0 ? `<button type="button" class="mini" data-linea="${l.id}">+1</button>` : ''}</td></tr>`).join('');
  $('#lineas').querySelectorAll('[data-linea]').forEach((b) => {
    const l = ls.find((x) => x.id === Number(b.dataset.linea));
    b.onclick = () => encolar(() => preparar(p.id, E.productos.get(l.producto_id), l.unidad));
  });
}

async function preparar(id, p, unidad, desarmar = false) {
  let r;
  try {
    r = await rpc('op_preparar', { p_pedido: id, p_producto: p.id, p_unidad: unidad, p_cantidad: 1, p_desarmar: desarmar });
  } catch (e) {
    if (e.codigo === 'FALTAN_SUELTAS' && !desarmar) {
      pitido(false);
      if (confirm(e.message)) return preparar(id, p, unidad, true);
      throw new Error(`${p.nombre}: no se pistoleó (no se desarmó la caja)`);
    }
    throw e;
  }
  avisosDe(r);
  if (E.pantalla === 'preparar' && E.ctx.id === id && E.ctx.lineas) {
    const i = E.ctx.lineas.findIndex((x) => x.id === r.linea.id); if (i >= 0) E.ctx.lineas[i] = r.linea;
    E.ctx.pedido = r.pedido; pintarPedido();
  }
  registrar(true, `${p.nombre} (${unidad === 'caja' ? 'caja' : 'unidad'}) · ${r.linea.faltan ? `faltan ${r.linea.faltan}` : 'línea completa'}`);
  if (r.pedido.completo) aviso('Pedido completo: ya puedes marcarlo retirado.', 'ok');
}

async function retirar(id) {
  const p = E.ctx.pedido; if (!p) return;
  const faltan = (p.cajas + p.unidades) - (p.cajas_prep + p.unidades_prep);
  const msg = faltan > 0
    ? `Faltan ${faltan} por pistolear. ¿Marcar retirado igual? Sale del stock lo que dice el pedido.`
    : `¿Confirmas que retiraron ${p.etiqueta}?`;
  if (!confirm(msg)) return;
  const r = await rpc('op_retirar', { p_pedido: id });
  avisosDe(r); pitido(true);
  aviso(`${p.etiqueta}: retirado`, 'ok');
  ir('pedidos');
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
  app.innerHTML = `<h2>Subir factura</h2>
  <section class="tarjeta"><label class="archivo">Elige el XML de la factura (lo descargas de Defontana)
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
      <dt>Fecha</dt><dd>${esc(f.fecha_emision || '—')}</dd>
      <dt>Cliente</dt><dd>${esc(f.razon_social || '—')} (${esc(f.rut_receptor || 's/RUT')})</dd>
      <dt>OC</dt><dd>${esc(f.oc || '—')}</dd>
    </dl>
    <table class="lineas"><tr><th>Producto</th><th>Cant.</th></tr>
      ${f.lineas.map((l) => {
        const c = E.codigos.get(l.codigo);
        if (!c) return `<tr class="mal"><td>${esc(l.nombre)}<br><small>Código ${esc(l.codigo || 'sin código')} no registrado</small>
          ${l.codigo ? `<br><button type="button" class="mini sec" data-ir="codigo" data-codigo="${esc(l.codigo)}">Registrar código</button>` : ''}</td><td>${num(l.cantidad)}</td></tr>`;
        return `<tr><td>${esc(E.productos.get(c.producto_id).nombre)}</td><td>${num(l.cantidad)} ${c.tipo === 'caja' ? 'cj' : 'u'}</td></tr>`;
      }).join('')}
    </table>
    <p class="${cuadra ? 'cuadra' : 'no-cuadra'}">Suma ${num(suma)} cajas${f.cajas_control != null ? ` · la OC dice ${f.cajas_control}` : ''}${cuadra ? (f.cajas_control != null ? ' ✓' : '') : ': no coincide'}</p>
  </section>
  <section class="tarjeta">
    <h3>Cadena (obligatoria)</h3>
    ${sug ? `<p class="nota">${esc(sug.texto)}</p>` : ''}
    <div class="opciones">${Object.entries(CADENAS).map(([k, n]) => `<button type="button" data-cadena="${k}" class="${f.cadena === k ? 'elegida' : ''} ${sug?.sugerida === k ? 'sugerida' : ''}">${n}</button>`).join('')}</div>
    ${f.cadena === 'lider' ? `<h3>CD de Líder</h3><div class="opciones">${Object.entries(CDS).map(([k, n]) => `<button type="button" data-cd="${k}" class="${f.cd === k ? 'elegida' : ''}">${n}</button>`).join('')}</div>` : ''}
  </section>
  <button type="button" class="grande" id="btnCargar" ${listo ? '' : 'disabled'}><b>Cargar factura</b><span>Queda por retirar; el stock se descuenta al marcarla retirada</span></button>
  <p class="error" id="errFac"></p>`;
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
      pitido(true); aviso(`Factura ${f.folio} cargada: ${resumenCant(r.pedido.cajas, r.pedido.unidades)} por retirar`, 'ok');
      E.factura = null; E.volverA = null;
      ir('pedidos');
    } catch (e) { b.disabled = false; pitido(false); $('#errFac').textContent = mensaje(e); }
  };
}

// ───────── Registrar código ─────────

PANTALLAS.codigo = ({ codigo }) => {
  app.innerHTML = `<h2>Registrar código</h2>
  <p class="nota">Para una etiqueta que la app no reconoce: pistoléala y elige a qué producto corresponde.</p>
  ${htmlPistola('Pistolea la etiqueta nueva')}
  <form id="fCod" class="tarjeta">
    <label>Código<input name="codigo" inputmode="numeric" required value="${esc(codigo || '')}"></label>
    <label>Producto<select name="producto" required><option value="">Elige…</option>
      ${[...E.productos.values()].filter((p) => p.activo).map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
    <fieldset><legend>Es el código de…</legend>
      <label class="radio"><input type="radio" name="tipo" value="unidad" checked> un frasco o cajita (unidad)</label>
      <label class="radio"><input type="radio" name="tipo" value="caja"> una caja de 12 (solo 300 y 550 g)</label>
    </fieldset>
    <button type="submit">Registrar</button>
  </form>`;
  const f = $('#fCod');
  activarPistola(async (cod) => {
    const c = E.codigos.get(cod);
    if (c) throw new Error(`Ese código ya es de ${E.productos.get(c.producto_id).nombre} (${c.tipo})`);
    f.codigo.value = cod; registrar(true, `Código ${cod} leído: elige el producto y registra`);
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

iniciar();
