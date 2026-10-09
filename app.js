/* =====================================================================
 * BINCO | Reto Comercial — app.js
 * Capa de presentación: vistas Asesor y Supervisor, carga de archivos,
 * mapeador de columnas, configuración y publicación segura para el equipo.
 * No contiene reglas de negocio: usa BincoData (KPIs) y BincoGame (gamificación).
 * ===================================================================== */
(function () {
  'use strict';
  const D = window.BincoData, G = window.BincoGame, U = D.U;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = U.esc;

  /* ------------------------------------------------------------------
   * ESTADO
   * ---------------------------------------------------------------- */
  const qs = new URLSearchParams(location.search);
  const S = {
    today: /^\d{4}-\d{2}-\d{2}$/.test(qs.get('hoy') || '') ? qs.get('hoy') : U.today(), // ?hoy=AAAA-MM-DD solo para pruebas
    cfg: null, store: null,
    raw: { funnel: [], icarus: [], cargas: [], snapshots: [], meta: {} },
    ds: null, session: null, viewAs: '', view: null,
    period: { p: 'mes', from: null, to: null }, tipo: 'Todos',
    sort: { key: 'avance', dir: -1 }, search: '', cierresEtapa: 'Todas', cfgTab: 'metas',
    charts: {}, pending: null, lastImport: null, publication: null,
  };

  const ASESOR_TABS = [['inicio', '🏠', 'Inicio'], ['avance', '📈', 'Mi avance'], ['cierres', '🎯', 'Cierres'], ['retos', '🏆', 'Retos'], ['equipo', '👥', 'Equipo']];
  const ADMIN_TABS = [['tablero', '📊', 'Equipo'], ['cargar', '📥', 'Cargar datos'], ['retosAdm', '🏆', 'Retos'], ['premios', '🎁', 'Premios'], ['config', '⚙️', 'Ajustes']];

  /* ------------------------------------------------------------------
   * ARRANQUE
   * ---------------------------------------------------------------- */
  async function boot() {
    S.cfg = D.ConfigStore.load(G.defaultConfig(S.today));
    S.store = await new D.Store().open();
    // Enlace personal del asesor: viene en la URL (#k=…) o quedó guardado en este dispositivo
    // (al recargar, al abrir desde el ícono instalado o desde un marcador sin #k).
    const hashKey = new URLSearchParams(location.hash.slice(1)).get('k');
    if (hashKey) return bootPublication(hashKey, false);
    const savedKey = keyGet();
    if (savedKey && location.protocol !== 'file:' && !salioGet()) return bootPublication(savedKey, true);
    const src = new D.FileSource(S.store);
    const all = await src.loadAll();
    Object.assign(S.raw, all, { meta: (await S.store.get('meta')) || {} });
    rebuild();
    bindGlobal();
    let sess = null;
    try { sess = JSON.parse(window.sessionStorage.getItem('binco_sess') || 'null'); } catch (e) { /* sin sesión */ }
    if (sess && (sess.role === 'admin' || S.cfg.asesores[sess.asesorId])) { S.session = sess; showApp(); } else showLogin();
  }

  function rebuild() {
    S.ds = D.buildDataset(S.raw.funnel, S.raw.icarus, S.cfg);
    let changed = false;
    S.ds.asesores.forEach((nombre, id) => {
      if (S.cfg.asesorAlias[id]) return;
      if (!S.cfg.asesores[id]) { S.cfg.asesores[id] = { nombre: prettyName(nombre), metaBase: 0, activo: true }; changed = true; }
    });
    if (changed) saveCfg();
  }
  function prettyName(s) {
    s = String(s || '').trim();
    if (s && s === s.toUpperCase()) return s.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
    return s;
  }
  function saveCfg(sinMarcar) { if (!sinMarcar && !S.publication) S.cfg.cambiosSinPublicar = true; D.ConfigStore.save(S.cfg); }
  async function saveRaw() {
    if (!S.publication) { S.cfg.cambiosSinPublicar = true; D.ConfigStore.save(S.cfg); }
    await S.store.set('funnel', S.raw.funnel); await S.store.set('icarus', S.raw.icarus);
    await S.store.set('cargas', S.raw.cargas); await S.store.set('snapshots', S.raw.snapshots); await S.store.set('meta', S.raw.meta);
  }

  /* ------------------------------------------------------------------
   * ACCESO
   * ---------------------------------------------------------------- */
  const KEY_STORE = 'binco_reto_enlace';
  function keyGet() { try { return window.localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } }
  function salioGet() { try { return window.sessionStorage.getItem('binco_salio') === '1'; } catch (e) { return false; } }
  function salioSet(v) { try { if (v) window.sessionStorage.setItem('binco_salio', '1'); else window.sessionStorage.removeItem('binco_salio'); } catch (e) { /* sin almacenamiento */ } }
  function nombreGuardado() { try { return window.localStorage.getItem('binco_reto_nombre') || ''; } catch (e) { return ''; } }
  function keySet(v) { try { if (v) window.localStorage.setItem(KEY_STORE, v); else window.localStorage.removeItem(KEY_STORE); } catch (e) { /* sin almacenamiento */ } }

  function showLogin() {
    $('#app').classList.add('d-none'); $('#login').classList.remove('d-none');
    const ids = activeIds();
    const sel = $('#loginAsesor');
    sel.innerHTML = ids.length ? '<option value="">Selecciona tu nombre…</option>' + ids.map((id) => `<option value="${esc(id)}">${esc(name(id))}</option>`).join('')
      : '<option value="">Aún no hay asesores registrados</option>';
    const msg = $('#loginMsg');
    const hosted = location.protocol !== 'file:';
    $('#loginAsesorBox').classList.toggle('d-none', !ids.length && hosted);
    if (!ids.length && hosted && keyGet()) {
      const nom = nombreGuardado();
      msg.innerHTML = `<button class="btn btn-binco btn-lg w-100 mb-2" id="btnReentrar">👤 Entrar como ${esc(nom ? nom.split(' ')[0] : 'asesor')}</button>
        <div class="tiny text-muted">${nom ? esc(nom) + ' · ' : ''}este teléfono recuerda tu enlace. <button class="btn btn-link btn-sm p-0 align-baseline" id="btnOlvidar">No soy yo / olvidar</button></div>`;
      return;
    }
    if (!ids.length && hosted) {
      msg.innerHTML = `<div class="alert alert-info small text-start mb-0"><b>¿Eres asesor?</b> Abre el <b>enlace personal</b> que te envió tu supervisor (WhatsApp o correo). Después de abrirlo una vez, este teléfono lo recuerda y ya puedes entrar desde el ícono o recargar sin problema.</div>`;
      return;
    }
    msg.innerHTML = ids.length ? '' : `<div class="text-muted">El supervisor debe cargar los reportes del Funnel y de colocación oficial.<br><button class="btn btn-link btn-sm p-0 mt-1" id="btnDemoLogin">Explorar con datos de demostración</button></div>`;
    if (S.cfg.adminPin === 'binco2026') msg.innerHTML += `<div class="tiny text-muted mt-2">PIN inicial de supervisor: <b>binco2026</b> (cámbialo en Ajustes → Acceso).</div>`;
  }
  function loginAsesor() {
    const id = $('#loginAsesor').value;
    if (!id) return toast('Selecciona tu nombre.');
    const a = S.cfg.asesores[id];
    const pinBox = $('#loginAsesorPin');
    if (a.pin && pinBox.classList.contains('d-none')) { pinBox.classList.remove('d-none'); pinBox.focus(); return; }
    if (a.pin && pinBox.value !== String(a.pin)) return toast('PIN incorrecto.');
    S.session = { role: 'asesor', asesorId: id };
    sessSet(S.session);
    showApp();
  }
  function loginAdmin() {
    if ($('#loginAdminPin').value !== String(S.cfg.adminPin)) return toast('PIN de administrador incorrecto.');
    S.session = { role: 'admin' };
    sessSet(S.session);
    showApp();
  }
  function sessSet(v) { try { if (v) window.sessionStorage.setItem('binco_sess', JSON.stringify(v)); else window.sessionStorage.removeItem('binco_sess'); } catch (e) { /* almacenamiento no disponible */ } }
  function logout() {
    sessSet(null); S.session = null; S.viewAs = '';
    if (S.publication) {
      salioSet(true); location.replace(location.pathname); return; // el enlace queda recordado: puede volver a entrar con un toque
    }
    showLogin();
  }

  /* ------------------------------------------------------------------
   * SHELL
   * ---------------------------------------------------------------- */
  function isAdmin() { return S.session && S.session.role === 'admin'; }
  function currentAsesor() { return isAdmin() ? S.viewAs : S.session.asesorId; }
  function asesorMode() { return !!currentAsesor(); }
  function activeIds() { return Object.keys(S.cfg.asesores).filter((id) => S.cfg.asesores[id].activo !== false).sort((a, b) => name(a).localeCompare(name(b))); }
  function name(id) { return (S.cfg.asesores[id] && S.cfg.asesores[id].nombre) || prettyName(id); }
  function firstName(id) { return name(id).split(' ')[0]; }

  function showApp() {
    $('#login').classList.add('d-none'); $('#app').classList.remove('d-none');
    const vs = $('#viewAs');
    if (isAdmin()) {
      vs.classList.remove('d-none');
      vs.innerHTML = '<option value="">👔 Vista supervisor</option>' + activeIds().map((id) => `<option value="${esc(id)}" ${S.viewAs === id ? 'selected' : ''}>👤 Ver como ${esc(name(id))}</option>`).join('');
    } else vs.classList.add('d-none');
    if (S.publication) $('#btnLogout').textContent = 'Salir';
    S.view = asesorMode() ? 'inicio' : 'tablero';
    renderNav(); render();
  }

  function renderNav() {
    const tabs = asesorMode() ? ASESOR_TABS : ADMIN_TABS;
    const html = (cls) => tabs.map(([k, i, l]) => `<button data-nav="${k}" class="${S.view === k ? 'active' : ''}">${cls ? `<span class="i">${i}</span>` : i + ' '}${l}</button>`).join('');
    $('#topNav').innerHTML = html(false);
    $('#bottomNav').innerHTML = html(true);
  }

  function range() {
    const t = S.today;
    switch (S.period.p) {
      case 'hoy': return { from: t, to: t };
      case 'semana': return { from: U.weekStart(t), to: U.weekEnd(t) };
      case 'mesAnt': { const p = U.addDays(U.monthStart(t), -1); return { from: U.monthStart(p), to: U.monthEnd(p) }; }
      case 'custom': return { from: S.period.from || U.monthStart(t), to: S.period.to || t };
      default: return { from: U.monthStart(t), to: U.monthEnd(t) };
    }
  }
  function periodTitle() {
    return { hoy: 'de hoy', semana: 'de la semana', mes: 'del mes', mesAnt: 'del mes anterior', custom: 'del periodo' }[S.period.p];
  }
  function periodLabel() {
    const r = range();
    const base = S.period.p === 'mes' || S.period.p === 'mesAnt' ? U.monthName(r.from) : r.from === r.to ? U.fmtDate(r.from) : `${U.fmtDateShort(r.from)} – ${U.fmtDate(r.to)}`;
    return `Periodo: <b>${base}</b>${S.tipo !== 'Todos' ? ` · Tipo: <b>${esc(S.tipo)}</b>` : ''}${S.period.p !== 'mes' && S.period.p !== 'mesAnt' ? ' · La meta se prorratea por días hábiles.' : ''}`;
  }

  function header() {
    const id = currentAsesor();
    const msgs = S.cfg.mensajes && S.cfg.mensajes.length ? S.cfg.mensajes : ['Cada gestión cuenta. Vamos por la meta.'];
    const msg = msgs[(U.fromYmd(S.today).getDate()) % msgs.length];
    $('#helloName').innerHTML = id ? `Hola, ${esc(firstName(id))} 👋` : 'Tablero del equipo';
    $('#helloMsg').textContent = id ? msg : 'Visibilidad para acompañar al equipo, no para presionarlo.';
    if (isAdmin() && !id) {
      const pend = S.cfg.cambiosSinPublicar;
      $('#helloMsg').innerHTML = pend
        ? `<span class="warn-text">⚠️ Hay cambios que los asesores todavía no ven.</span> <button class="btn btn-sm btn-binco ms-1" data-act="publicar">📤 Publicar ahora</button>`
        : `<span class="ok-text">✓ Los asesores ven la información actualizada${S.cfg.ultimaPublicacion ? ' (publicado ' + U.fmtDateTime(S.cfg.ultimaPublicacion) + ')' : ''}.</span>`;
    }
    if (isAdmin() && id) $('#helloMsg').innerHTML = `<span class="badge text-bg-light">Estás viendo como ${esc(name(id))}</span> ${esc(msg)}`;
    // Última actualización (siempre visible)
    const m = S.raw.meta || {};
    const last = [m.funnel, m.icarus].filter(Boolean).sort().pop();
    const el = $('#updateStamp');
    if (!last) { el.className = 'update-stamp stale'; el.innerHTML = '⚠️ Sin datos cargados'; }
    else {
      const hrs = (Date.now() - new Date(last)) / 36e5;
      el.className = 'update-stamp' + (hrs > 36 && !S.publication ? ' stale' : '');
      el.innerHTML = `Última actualización: <b>${U.fmtDateTime(last)}</b>` + `<span class="d-none d-md-inline"> · Funnel ${m.funnel ? U.fmtDateTime(m.funnel) : '—'} · Colocación ${m.icarus ? U.fmtDateTime(m.icarus) : '—'}</span>`;
    }
    $('#periodLabel').innerHTML = periodLabel();
    $$('#periodChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.p === S.period.p));
    $('#customRange').classList.toggle('d-none', S.period.p !== 'custom');
    $('#fTipo').value = S.tipo;
    const showFilters = !['cargar', 'retosAdm', 'premios', 'config'].includes(S.view);
    $('.filters').classList.toggle('d-none', !showFilters);
    $('#periodLabel').classList.toggle('d-none', !showFilters);
  }

  /* ------------------------------------------------------------------
   * RENDER PRINCIPAL
   * ---------------------------------------------------------------- */
  function render() {
    Object.values(S.charts).forEach((c) => c && c.destroy && c.destroy()); S.charts = {};
    header(); renderNav();
    const v = $('#view');
    const fn = VIEWS[S.view] || VIEWS[asesorMode() ? 'inicio' : 'tablero'];
    try { v.innerHTML = `<div class="fade-in">${fn.html()}</div>`; if (fn.after) fn.after(); }
    catch (e) { console.error(e); v.innerHTML = `<div class="cardx"><b>Ocurrió un error al mostrar esta sección.</b><div class="small text-muted">${esc(e.message)}</div></div>`; }
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  const compute = (ids, r, tipo) => D.compute(S.ds, { cfg: S.cfg, range: r || range(), asesorIds: ids, tipo: tipo == null ? S.tipo : tipo, today: S.today });
  const hasData = () => S.ds && (S.ds.funnel.length || S.ds.colocaciones.length);
  const emptyState = () => `<div class="cardx empty"><div class="e">📭</div><h2 class="h5 fw-bold mt-2">Aún no hay información cargada</h2><p class="mb-0">${isAdmin() ? 'Ve a <b>Cargar datos</b> para subir los reportes del Funnel y de colocación oficial.' : 'En cuanto tu supervisor cargue los reportes, aquí verás tu avance.'}</p></div>`;

  /* ------------------------------------------------------------------
   * COMPONENTES
   * ---------------------------------------------------------------- */
  const LVL_EMOJI = { inicio: '🌱', avance: '💪', cerca: '🔥', meta: '🏆' };

  function cKpi(m, title) {
    const av = m.avance;
    const w = av == null ? 0 : Math.min(100, av);
    const marker = m.ritmo && m.meta ? `<i class="marker" style="left:${Math.min(100, m.ritmo.esperado / m.meta * 100)}%" title="Avance esperado a hoy"></i>` : '';
    const ritmo = m.ritmo ? `<span class="ritmo ${m.ritmo.key}">${m.ritmo.key === 'adelantado' ? '⚡' : m.ritmo.key === 'en_ritmo' ? '✅' : '🧭'} ${m.ritmo.label}</span>
      <span class="tiny text-muted ms-1">Esperado a hoy: ${U.money(m.ritmo.esperado)}</span>` : '';
    const falt = m.meta ? (m.faltante > 0 ? U.money(m.faltante) : `<span class="ok-text">+${U.money(m.monto - m.meta)}</span>`) : '—';
    return `<div class="cardx kpi-main lvl-${m.nivel.key}">
      ${m.nivel.key === 'meta' ? '<span class="confetti">🎉</span>' : ''}
      <div class="card-title-x"><span>Colocación ${periodTitle()}</span>${m.meta ? `<span class="level-badge">${LVL_EMOJI[m.nivel.key]} ${m.nivel.label}</span>` : ''}</div>
      <div class="kpi-amount num">${U.money(m.monto)}</div>
      <div class="tiny text-muted mt-1">${m.montoAjuste ? `Real ${U.money(m.montoReal)} + ajuste de cierre ${U.money(m.montoAjuste)} (${m.creditosAjuste} op.)` : (S.ds.fuenteColocacion === 'funnel' ? 'Créditos colocados según el Funnel' : 'Confirmado en colocación oficial')}</div>
      <div class="pbar lg mt-3" role="progressbar" aria-valuenow="${w}" aria-valuemin="0" aria-valuemax="100"><span style="width:${w}%"></span>${marker}</div>
      <div class="pbar-legend"><span>${m.meta ? U.pct(av) + ' de avance' : 'Meta no configurada'}</span><span>${m.meta ? 'Meta ' + U.moneyK(m.meta) : ''}</span></div>
      <div class="kpi-sub">
        <div><div class="lbl">Meta</div><div class="val num">${m.meta ? U.money(m.meta) : '—'}</div></div>
        <div><div class="lbl">Avance</div><div class="val num">${U.pct(av)}</div></div>
        <div><div class="lbl">${m.faltante > 0 || !m.meta ? 'Me falta' : 'Superada'}</div><div class="val num">${falt}</div></div>
      </div>
      <div class="mt-3">${ritmo}</div>
    </div>`;
  }

  const fmtC = (x) => (Math.round(x) === x ? String(x) : x.toFixed(1));
  function cCreditos(m) {
    const tipos = ['Nuevo', 'Renovación', 'Nómina'].concat(m.porTipo.Otros.n ? ['Otros'] : []);
    return `<div class="cardx">
      <div class="card-title-x"><span>Créditos colocados</span><span class="tiny">${m.creditosAjuste ? 'incluye ' + m.creditosAjuste + ' de ajuste' : 'Colocación oficial'}</span></div>
      <div class="d-flex align-items-end gap-3">
        <div><div class="big-num num">${m.creditos}${m.metaCreditos ? `<span class="fs-5 text-muted"> / ${fmtC(m.metaCreditos)}</span>` : ''}</div><div class="small text-muted">${m.metaCreditos ? 'créditos de tu meta' : 'operaciones'}</div></div>
        <div class="ms-auto text-end"><div class="small text-muted">Ticket promedio</div><div class="fw-bold num">${m.ticket ? U.money(m.ticket) : '—'}</div>
        <div class="small text-muted mt-1">Monto total</div><div class="fw-bold num">${U.money(m.monto)}</div></div>
      </div>
      ${m.metaCreditos ? `<div class="lvl-${m.nivelCreditos.key} mt-3"><div class="pbar"><span style="width:${Math.min(100, m.avanceCreditos || 0)}%"></span></div>
        <div class="pbar-legend"><span>${U.pct(m.avanceCreditos, 0)} de la meta de créditos</span><span>${m.faltanteCreditos > 0 ? 'Te faltan ' + m.faltanteCreditos + ' crédito' + (m.faltanteCreditos === 1 ? '' : 's') : '¡Meta de créditos cumplida! 🎉'}</span></div></div>` : ''}
      <div class="mini-stats mt-3">${tipos.map((t) => `<div class="mini-stat tipo-${t.toLowerCase()}"><div class="l">${t}</div><div class="v num">${m.porTipo[t].n}</div><div class="s num">${U.moneyK(m.porTipo[t].monto)}</div></div>`).join('')}</div>
    </div>`;
  }

  function cPipeline(m, compact) {
    const max = Math.max(1, ...m.pipeline.map((p) => p.n));
    const rows = m.pipeline.map((p, i) => `
      ${i > 0 ? `<div class="pipe-arrow">↓ ${p.conv == null ? '' : U.pct(p.conv, 0) + ' conversión'}</div>` : ''}
      <div class="pipe-row">
        <div class="pipe-name">${p.label}</div>
        <div class="pipe-bar"><span class="s-${p.key}" style="width:${Math.max(4, p.n / max * 100)}%"></span><b class="num">${p.n}</b></div>
        <div class="pipe-meta">${p.monto ? `<strong class="num">${U.moneyK(p.monto)}</strong><br>${p.key === 'colocado' ? 'real' : 'potencial'}` : '<span class="tiny">—</span>'}</div>
      </div>`).join('');
    const e = m.estado;
    return `<div class="cardx">
      <div class="card-title-x"><span>Mi pipeline</span><span class="tiny text-muted">${compact ? '' : 'acumulado del periodo'}</span></div>
      <div class="pipe">${rows}</div>
      <div class="state-chips">
        ${e.interes ? `<span class="state-chip"><b>${e.interes}</b>con interés · ${U.moneyK(e.montoInteres)}</span>` : ''}
        <span class="state-chip"><b>${e.enProceso}</b>expedientes en proceso</span>
        <span class="state-chip"><b>${e.mesa}</b>en Mesa · ${U.moneyK(e.montoMesa)}</span>
        <span class="state-chip"><b>${e.autorizados}</b>autorizados · ${U.moneyK(e.montoAutorizados)}</span>
        <span class="state-chip"><b>${e.porDispersar}</b>por dispersar · ${U.moneyK(e.montoPorDispersar)}</span>
        ${e.pendientesValidar ? `<span class="state-chip"><b>${e.pendientesValidar}</b>por confirmar en colocación oficial</span>` : ''}
      </div>
      <div class="tiny text-muted mt-2">Las cifras "hoy" (chips) muestran tu cartera abierta actual, sin importar el periodo.</div>
    </div>`;
  }

  function cReto(ev, opts) {
    opts = opts || {};
    const st = ev.cumplido ? 'ganado' : ev.status;
    const stLbl = ev.cumplido ? '¡Logrado!' : { en_curso: 'En curso', proximo: 'Próximamente', concluido: 'Concluido', borrador: 'Borrador', pausado: 'Pausado' }[ev.status];
    const lvl = D.progressLevel(ev.progreso).key;
    return `<div class="reto lvl-${lvl}">
      <div class="reto-head"><div><div class="reto-name">${esc(ev.reto.nombre)} ${ev.grupal ? '<span class="badge rounded-pill text-bg-light">👥 grupal</span>' : ''}</div>
      <div class="reto-desc">${esc(ev.reto.descripcion || '')}</div></div><span class="status-pill st-${st}">${stLbl}</span></div>
      <div class="d-flex justify-content-between align-items-end mt-2">
        <div><span class="fw-bold fs-5 num">${ev.valorFmt}</span> <span class="text-muted small">/ ${ev.metaFmt}</span></div>
        <div class="fw-bold num">${U.pct(Math.min(ev.progreso, 999), 0)}</div>
      </div>
      <div class="pbar mt-1"><span style="width:${Math.min(100, ev.progreso)}%"></span></div>
      <div class="d-flex justify-content-between tiny text-muted mt-1"><span>${U.fmtDateShort(ev.reto.inicio)} – ${U.fmtDateShort(ev.reto.fin)}</span><span>${ev.cumplido ? '¡Felicidades! 🎉' : ev.status === 'en_curso' ? `Te falta: ${ev.faltanteFmt}` : ''}</span></div>
      ${ev.premio && !opts.noPrize ? `<div class="reto-prize"><span class="emo">${esc(ev.premio.emoji || '🎁')}</span><div><div class="t">Premio</div><div class="n">${esc(ev.premio.nombre)}</div></div></div>` : ''}
    </div>`;
  }

  function cRetoSemanal(id) {
    const retos = G.retosAsesor(S.ds, S.cfg, id, S.today).filter((e) => e.status === 'en_curso');
    const ind = retos.filter((e) => !e.grupal);
    const top = ind[0] || retos[0];
    return `<div class="cardx">
      <div class="card-title-x"><span>Reto de la semana</span><button class="btn btn-sm btn-soft" data-nav="retos">Ver ${retos.length > 1 ? 'los ' + retos.length : ''} retos</button></div>
      ${top ? cReto(top) : '<div class="empty py-3"><div class="e">🎯</div><div class="small">No hay retos activos esta semana.</div></div>'}
    </div>`;
  }

  function cMetaGrupal() {
    const t = compute(null);
    const w = t.avance == null ? 0 : Math.min(100, t.avance);
    const msg = !t.meta ? 'Configura la meta del equipo en Ajustes.' : t.faltante > 0 ? `Nos faltan ${U.money(t.faltante)} para llegar juntos.` : '¡Lo logramos juntos! Gracias, equipo. 🎉';
    return `<div class="cardx team-goal">
      <div class="card-title-x"><span>Meta del equipo</span><span>👥</span></div>
      <div class="d-flex justify-content-between align-items-end"><div><div class="small text-muted">Colocado</div><div class="amount num">${U.money(t.monto)}</div></div>
      <div class="text-end"><div class="small text-muted">Meta</div><div class="fw-bold num">${t.meta ? U.money(t.meta) : '—'}</div></div></div>
      <div class="pbar grad lg mt-2"><span style="width:${w}%"></span></div>
      <div class="pbar-legend"><span>${U.pct(t.avance)} de avance</span><span>Faltante ${U.money(t.faltante)}</span></div>
      ${t.metaCreditos ? `<div class="d-flex justify-content-between align-items-end mt-3"><div><div class="small text-muted">Créditos del equipo</div><div class="fw-bold fs-4 num">${t.creditos} <span class="fs-6 text-muted">/ ${fmtC(t.metaCreditos)}</span></div></div>
        <div class="text-end small">${t.faltanteCreditos > 0 ? `Faltan <b>${t.faltanteCreditos}</b> créditos` : '<b class="ok-text">¡Meta de créditos lograda!</b>'}</div></div>
      <div class="pbar grad mt-1"><span style="width:${Math.min(100, t.avanceCreditos || 0)}%"></span></div>` : ''}
      <div class="team-msg">${msg}</div>
    </div>`;
  }

  function cProyeccion(m) {
    const p = m.proyeccion;
    const meta = m.meta || 1;
    if (!p.proyectable) {
      return `<div class="cardx"><div class="card-title-x"><span>Proyección de cierre</span></div>
        <div class="proj-box proj-real"><span class="proj-tag">REAL</span><div class="proj-line total"><span>Colocación del periodo</span><span class="num">${U.money(p.real)}</span></div></div>
        <div class="tiny text-muted mt-2">La proyección solo aplica a periodos en curso. Este periodo ya cerró: se muestra únicamente lo real.</div></div>`;
    }
    const rw = Math.min(100, p.real / meta * 100), pw = Math.min(100 - rw, p.enCamino / meta * 100);
    return `<div class="cardx">
      <div class="card-title-x"><span>Proyección de cierre</span><span class="tiny">Real ≠ Proyección</span></div>
      <div class="proj">
        <div class="proj-box proj-real"><span class="proj-tag">REAL · COLOCACIÓN OFICIAL</span>
          <div class="proj-line total"><span>Colocación actual</span><span class="num">${U.money(p.real)}</span></div>
          ${m.montoAjuste ? `<div class="proj-line tiny"><span>de la cual: ajuste de cierre</span><span class="num">${U.money(m.montoAjuste)}</span></div>` : ''}
          <div class="proj-line"><span>Faltante real para meta</span><span class="num">${U.money(m.faltante)}</span></div>
        </div>
        <div class="proj-box proj-fore"><span class="proj-tag">PROYECCIÓN · FUNNEL</span>
          <div class="proj-line"><span>Autorizados y por dispersar</span><span class="num">${U.money(p.enCaminoAut)}</span></div>
          <div class="proj-line"><span>Operaciones en Mesa</span><span class="num">${U.money(p.enCaminoMesa)}</span></div>
          <div class="proj-line total"><span>En camino</span><span class="num">${U.money(p.enCamino)}</span></div>
        </div>
      </div>
      <div class="stack-bar" title="Real + En camino vs meta"><span class="r" style="width:${rw}%"></span><span class="p" style="width:${pw}%"></span></div>
      <div class="d-flex justify-content-between flex-wrap gap-2 mt-2 small">
        <span>Potencial ${periodTitle()} (real + en camino): <b class="num">${U.money(p.potencial)}</b></span>
        <span>${p.faltanteProyectado > 0 ? `Faltante aun con lo que viene: <b class="num">${U.money(p.faltanteProyectado)}</b>` : '<b class="ok-text">Con lo que tienes en camino alcanzas la meta 🙌</b>'}</span>
      </div>
      <div class="tiny text-muted mt-2">La proyección no es colocación: depende de que las operaciones se dispersen. Factores aplicados: autorizados ${Math.round(S.cfg.factorAutorizado * 100)}%, Mesa ${Math.round(S.cfg.factorMesa * 100)}%.</div>
    </div>`;
  }

  function cSimulador(m, ids) {
    let ticket = m.ticket, fuente = 'tu ticket promedio del periodo';
    if (!ticket) {
      const r90 = { from: U.addDays(S.today, -90), to: S.today };
      const h = compute(ids, r90); ticket = h.ticket; fuente = 'tu ticket de los últimos 90 días';
      if (!ticket) { ticket = compute(null, r90).ticket; fuente = 'el ticket promedio del equipo'; }
    }
    if (!m.meta) return `<div class="cardx sim"><div class="card-title-x"><span>¿Qué me falta?</span></div><div class="text-muted small">Tu meta aún no está configurada.</div></div>`;
    if (m.faltante <= 0) return `<div class="cardx sim"><div class="card-title-x"><span>¿Qué me falta?</span></div><div class="big">🏆</div><div class="fw-bold">¡Ya cumpliste tu meta ${periodTitle()}!</div><div class="small text-muted">Cada crédito adicional suma a la meta del equipo.</div></div>`;
    const n = ticket ? Math.ceil(m.faltante / ticket) : null;
    const rest = Math.max(0, m.bdTotal - m.bdTrans) + (U.businessDays(S.today, S.today, S.cfg.diasHabiles).length ? 1 : 0);
    const porDia = n && rest ? (n / rest) : null;
    return `<div class="cardx sim">
      <div class="card-title-x"><span>¿Qué me falta?</span><span>🧮</span></div>
      <div class="small text-muted">Para llegar a tu meta te falta</div>
      <div class="big num">${U.money(m.faltante)}</div>
      <div class="sim-steps">
        <div class="box"><div class="l">Ticket promedio</div><div class="v num">${ticket ? U.money(ticket) : '—'}</div></div>
        <div class="fw-bold">→</div>
        <div class="box"><div class="l">Necesitas aprox.</div><div class="v num">${n == null ? '—' : n + ' crédito' + (n === 1 ? '' : 's')}</div></div>
      </div>
      <div class="small mt-3">${porDia && range().to >= S.today ? `Eso es cerca de <b>${porDia < 1 ? '1 crédito cada ' + Math.round(1 / porDia) + ' días hábiles' : porDia.toFixed(1) + ' créditos por día hábil'}</b> en los ${rest} días hábiles que quedan.` : ''}</div>
      <div class="tiny text-muted mt-1">Calculado con ${fuente}. Se actualiza automáticamente.</div>
    </div>`;
  }

  function cContactacion(m, ids) {
    const team = compute(null);
    // promedio personal histórico: últimos 3 meses cerrados
    let hist = [];
    for (let i = 1; i <= 3; i++) {
      const d = U.fromYmd(U.monthStart(S.today)); d.setMonth(d.getMonth() - i);
      const r = { from: U.ymd(d), to: U.monthEnd(U.ymd(d)) };
      const h = compute(ids, r);
      if (h.contactacion.trabajados >= 5) hist.push(h.contactacion.pct);
    }
    const histAvg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : null;
    const c = m.contactacion;
    const lvl = D.progressLevel(c.pct == null ? 0 : c.pct / 0.8).key;
    return `<div class="cardx lvl-${lvl}">
      <div class="card-title-x"><span>Contactación</span><span>📞</span></div>
      <div class="d-flex align-items-end gap-3"><div class="big-num num">${U.pct(c.pct, 0)}</div><div class="small text-muted pb-1">contactados / leads trabajados</div></div>
      <div class="pbar mt-2"><span style="width:${Math.min(100, c.pct || 0)}%"></span></div>
      <div class="mini-stats mt-3">
        <div class="mini-stat"><div class="l">Asignados</div><div class="v num">${c.asignados}</div></div>
        <div class="mini-stat"><div class="l">Trabajados</div><div class="v num">${c.trabajados}</div></div>
        <div class="mini-stat"><div class="l">Contactados</div><div class="v num">${c.contactados}</div></div>
      </div>
      <div class="compare">
        <div class="box me"><div class="l">Tú</div><div class="v num">${U.pct(c.pct, 0)}</div></div>
        <div class="box"><div class="l">Promedio equipo</div><div class="v num">${U.pct(team.contactacion.pct, 0)}</div></div>
        <div class="box"><div class="l">Tu promedio (3 meses)</div><div class="v num">${histAvg == null ? '—' : U.pct(histAvg, 0)}</div></div>
      </div>
    </div>`;
  }

  function cEvolucion() {
    return `<div class="cardx"><div class="card-title-x"><span>Evolución ${periodTitle()}</span><span id="ritmoChip"></span></div>
      <div style="position:relative;height:260px"><canvas id="chEvol" aria-label="Colocación acumulada vs avance esperado"></canvas></div>
      <div class="tiny text-muted mt-2">Línea sólida: colocación acumulada real (colocación oficial; incluye ajustes de cierre si los hay). Línea punteada: avance esperado para llegar a la meta.</div></div>`;
  }
  function drawEvolucion(ids, m) {
    const cv = $('#chEvol'); if (!cv || !window.Chart) return;
    const s = D.dailySeries(S.ds, { cfg: S.cfg, range: range(), asesorIds: ids, tipo: S.tipo, today: S.today, meta: m.meta });
    if (m.ritmo) $('#ritmoChip').innerHTML = `<span class="ritmo ${m.ritmo.key}">${m.ritmo.label}</span>`;
    const css = getComputedStyle(document.documentElement);
    S.charts.evol = new Chart(cv, {
      type: 'line',
      data: {
        labels: s.map((x) => U.fmtDateShort(x.fecha)),
        datasets: [
          { label: 'Real', data: s.map((x) => x.real), borderColor: css.getPropertyValue('--b-azul').trim(), backgroundColor: 'rgba(30,91,216,.10)', fill: true, tension: .25, pointRadius: 0, borderWidth: 3 },
          { label: 'Esperado', data: s.map((x) => x.esperado), borderColor: css.getPropertyValue('--b-morado').trim(), borderDash: [6, 5], pointRadius: 0, borderWidth: 2, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${U.money(c.parsed.y)}` } } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => U.moneyK(v) }, grid: { color: '#EEF1F7' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } },
      },
    });
  }

  function cCierres(ids, limit, withFilter) {
    const list = D.nearClosings(S.ds, { asesorIds: ids, tipo: S.tipo, etapa: S.cierresEtapa, limit: limit || 30 });
    const chips = ['Todas', 'por_dispersar', 'autorizado', 'mesa', 'expediente'].map((k) => `<button class="chip sm ${S.cierresEtapa === k ? 'active' : ''}" data-cierre="${k}">${k === 'Todas' ? 'Todas' : D.STAGE_LABEL[k]}</button>`).join('');
    return `<div class="cardx">
      <div class="card-title-x"><span>Clientes más cercanos a colocarse</span><span>🎯</span></div>
      ${withFilter ? `<div class="chip-group mb-2">${chips}</div>` : ''}
      ${list.length ? list.map((c) => `<div class="close-item">
          <div><div class="close-name">${esc(c.cliente)} <span class="stage-pill sp-${c.etapaKey}">${esc(c.etapa)}</span>${c.pendienteValidar ? ' <span class="stage-pill st-borrador">por confirmar en colocación oficial</span>' : ''}${c.cierrePeriodo ? ` <span class="stage-pill st-concluido" title="Ya se contó en el cierre de ${esc(c.cierrePeriodo)}; no suma en meses posteriores">ya contado en cierre ${esc(U.monthName(c.cierrePeriodo + '-01').split(' ')[0])}</span>` : ''}</div>
          <div class="tiny text-muted">${esc(c.tipo)}${isAdmin() && !S.viewAs ? ' · ' + esc(prettyName(c.asesor)) : ''}${c.ultima ? ' · últ. gestión ' + U.fmtDateShort(c.ultima) : ''}</div></div>
          <div class="fw-bold num text-end">${c.monto ? U.money(c.monto) : '—'}</div>
          <div class="close-action">${esc(c.accion)}</div></div>`).join('')
        : '<div class="empty py-3"><div class="e">🌱</div><div class="small">No hay operaciones en estas etapas. ¡Es buen momento para integrar expedientes!</div></div>'}
      <div class="tiny text-muted mt-2">🔒 Solo se muestran nombre abreviado, etapa, monto y próxima acción. Sin CURP, teléfonos ni datos bancarios.</div>
    </div>`;
  }

  function cRetoDia(id) {
    const rd = G.evalRetoDia(S.ds, S.cfg, id, S.today);
    if (!rd) return '';
    return `<div class="cardx reto-dia">
      <div class="card-title-x"><span>⚡ Reto de hoy</span>${rd.cumplido ? '<span>✅ ¡Logrado!</span>' : ''}</div>
      <div class="fs-5 fw-bold">${esc(rd.texto)}</div>
      ${rd.valor != null ? `<div class="d-flex justify-content-between mt-2 small"><span>Llevas <b>${rd.valorFmt}</b> de ${rd.metaFmt}</span><span class="fw-bold">${U.pct(Math.min(100, rd.progreso), 0)}</span></div>
      <div class="pbar mt-1"><span style="width:${Math.min(100, rd.progreso)}%"></span></div>` : ''}
    </div>`;
  }

  function cPuntos(id) {
    const p = G.points(S.ds, S.cfg, id, range(), S.today);
    return `<div class="cardx">
      <div class="card-title-x"><span>Puntos BINCO ${periodTitle()}</span><span>⭐</span></div>
      <div class="big-num num" style="color:var(--b-morado)">${U.int(p.total)} <span class="fs-6 text-muted">pts</span></div>
      <table class="table table-sm small mt-2 mb-1"><tbody>${p.detalle.map((d) => `<tr><td>${d.concepto}</td><td class="text-end text-muted num">${d.n} × ${d.pts}</td><td class="text-end fw-bold num">${U.int(d.total)}</td></tr>`).join('')}</tbody></table>
      <div class="tiny text-muted">Los puntos son una herramienta de gamificación. No sustituyen los KPIs comerciales oficiales.</div>
    </div>`;
  }

  function cLogros(id) {
    const rows = G.teamRows(S.ds, S.cfg, { from: U.monthStart(S.today), to: U.monthEnd(S.today) }, S.today);
    const a = G.achievements(S.ds, S.cfg, id, S.today, rows);
    return `<div class="cardx">
      <div class="card-title-x"><span>Mis logros</span><span>${a.ganados} / ${a.list.length}</span></div>
      <div class="ach-grid">${a.list.map((x) => `<div class="ach ${x.ok ? 'ok' : ''}" title="${esc(x.desc)}"><div class="e">${x.emoji}</div><div class="n">${esc(x.nombre)}</div><div class="d">${esc(x.detalle)}</div>
        ${x.ok ? '' : `<div class="pbar sm mt-2"><span style="width:${x.prog}%"></span></div>`}</div>`).join('')}</div>
    </div>`;
  }

  function cPremios() {
    const ps = (S.cfg.premios || []).filter((p) => p.activo !== false);
    return `<div class="cardx"><div class="card-title-x"><span>Premios que puedes ganar</span><span>🎁</span></div>
      <div class="prize-grid">${ps.map((p) => `<div class="prize"><div class="e">${esc(p.emoji)}</div><div class="n">${esc(p.nombre)}</div><div class="d">${esc(p.descripcion || '')}</div></div>`).join('') || '<div class="text-muted small">Sin premios configurados.</div>'}</div></div>`;
  }

  function cReconocimiento() {
    if (!G.showRecognition(S.cfg, S.today)) return '';
    const r = G.weeklyRecognition(S.ds, S.cfg, S.today);
    return `<div class="cardx"><div class="card-title-x"><span>🏅 Reconocimiento de la semana</span><span class="tiny">${U.fmtDateShort(r.week.from)} – ${U.fmtDateShort(U.addDays(r.week.from, 4))}</span></div>
      <div class="recog">${r.categorias.map((c) => `<div class="recog-item"><div class="e">${c.emoji}</div><div class="t">${c.titulo}</div>
        <div class="w">${c.r ? c.r.ganadores.map((n) => esc(prettyName(S.cfg.asesores[n] ? S.cfg.asesores[n].nombre : n))).join(', ') : '—'}</div><div class="v">${c.r ? c.fmt(c.r.valor) : 'Aún sin datos'}</div></div>`).join('')}</div>
      <div class="tiny text-muted mt-2">¡Gracias por el esfuerzo de toda la semana! 👏</div></div>`;
  }

  function cRanking(me) {
    const rows = G.ranking(G.teamRows(S.ds, S.cfg, range(), S.today, S.tipo), S.cfg.rankingCriterio);
    const showMoney = S.cfg.privacidad.mostrarRankingMontos || isAdmin();
    const crit = S.cfg.rankingCriterio;
    const val = (r) => crit === 'puntos' ? U.int(r.puntos) + ' pts' : crit === 'avance' ? U.pct(r.m.avance, 0) : (showMoney || r.id === me ? U.moneyK(r.m.monto) : U.pct(r.m.avance, 0));
    const mine = rows.find((r) => r.id === me);
    return `${mine ? `<div class="next-goal mb-3"><div class="t">Tu siguiente objetivo</div><div class="mt-1">${esc(mine.siguiente)}</div></div>` : ''}
      <div class="cardx"><div class="card-title-x"><span>Ranking del equipo</span><span class="tiny">por ${crit === 'monto' ? 'monto colocado' : crit === 'avance' ? '% de meta' : 'puntos BINCO'}</span></div>
      ${rows.map((r) => `<div class="rank-item ${r.id === me ? 'me' : ''}">
        <div class="rank-pos ${r.pos <= 3 ? 'p' + r.pos : ''}">${r.pos}</div>
        <div><div class="rank-name">${esc(r.nombre)}${r.id === me ? ' <span class="badge text-bg-primary">Tú</span>' : ''}</div>
        <div class="rank-sub">${r.m.creditos} créditos · ${U.pct(r.m.avance, 0)} meta · contactación ${U.pct(r.m.contactacion.pct, 0)} · ${U.int(r.puntos)} pts</div></div>
        <div class="rank-val num">${val(r)}</div></div>`).join('') || '<div class="text-muted small">Sin asesores.</div>'}
      </div>`;
  }

  /* ------------------------------------------------------------------
   * VISTAS — ASESOR
   * ---------------------------------------------------------------- */
  const VIEWS = {};
  VIEWS.inicio = {
    html() {
      if (!hasData()) return emptyState();
      const id = currentAsesor(); const m = compute([id]);
      return `<div class="grid home">
        ${cKpi(m)}
        ${cCreditos(m)}
        ${cRetoSemanal(id)}
        <div class="span2">${cPipeline(m, true)}</div>
        ${cMetaGrupal()}
      </div>`;
    },
  };
  VIEWS.avance = {
    html() {
      if (!hasData()) return emptyState();
      const id = currentAsesor(); const m = compute([id]);
      return `<div class="grid g2">${cProyeccion(m)}${cSimulador(m, [id])}</div>
        <div class="grid mt-3">${cEvolucion()}</div>
        <div class="grid g2 mt-3">${cContactacion(m, [id])}${cCreditos(m)}</div>`;
    },
    after() { const id = currentAsesor(); drawEvolucion([id], compute([id])); },
  };
  VIEWS.cierres = { html() { if (!hasData()) return emptyState(); return cCierres([currentAsesor()], 30, true); } };
  VIEWS.retos = {
    html() {
      const id = currentAsesor();
      const retos = G.retosAsesor(S.ds, S.cfg, id, S.today);
      return `<div class="grid g2">${cRetoDia(id) || ''}${cPuntos(id)}</div>
        <div class="cardx mt-3"><div class="card-title-x"><span>Retos de la semana</span><span>🏆</span></div>${retos.length ? retos.map((e) => cReto(e)).join('') : '<div class="text-muted small">No hay retos activos en este momento.</div>'}</div>
        <div class="mt-3">${cLogros(id)}</div>
        <div class="mt-3">${cPremios()}</div>`;
    },
  };
  VIEWS.equipo = {
    html() {
      if (!hasData()) return emptyState();
      return `${cReconocimiento() ? cReconocimiento() + '<div class="mt-3"></div>' : ''}
        <div class="grid g2"><div>${cRanking(currentAsesor())}</div><div>${cMetaGrupal()}</div></div>`;
    },
  };

  /* ------------------------------------------------------------------
   * VISTAS — SUPERVISOR
   * ---------------------------------------------------------------- */
  const COLS = [
    ['nombre', 'Asesor'], ['meta', 'Meta'], ['monto', 'Colocado'], ['avance', '% Avance'], ['creditos', 'Créditos'], ['avCred', '% Meta créditos'], ['ticket', 'Ticket prom.'],
    ['contact', 'Contactación'], ['exped', 'Expedientes'], ['mesa', 'Mesa'], ['aut', 'Autorizados'], ['proy', 'Proyección'], ['puntos', 'Puntos'],
  ];
  function adminRows() {
    return G.teamRows(S.ds, S.cfg, range(), S.today, S.tipo).map((r) => ({
      id: r.id, nombre: r.nombre, m: r.m, meta: r.m.meta, monto: r.m.monto, avance: r.m.avance || 0, creditos: r.m.creditos, avCred: r.m.avanceCreditos || 0, ticket: r.m.ticket || 0,
      contact: r.m.contactacion.pct || 0, exped: r.m.pipeline.find((p) => p.key === 'expediente').n, mesa: r.m.estado.mesa, aut: r.m.estado.autorizados + r.m.estado.porDispersar, proy: r.m.proyeccion.potencial, puntos: r.puntos,
    }));
  }
  VIEWS.tablero = {
    html() {
      if (!hasData()) return emptyState();
      const t = compute(null);
      let rows = adminRows();
      const q = U.norm(S.search);
      if (q) rows = rows.filter((r) => U.norm(r.nombre).includes(q));
      const k = S.sort.key, d = S.sort.dir;
      rows.sort((a, b) => (k === 'nombre' ? a.nombre.localeCompare(b.nombre) : (a[k] - b[k])) * d);
      const pend = S.ds.matchStats.pendientes;
      return `<div class="grid g3">
        ${cMetaGrupal()}
        <div class="cardx"><div class="card-title-x"><span>Equipo ${periodTitle()}</span></div>
          <div class="mini-stats"><div class="mini-stat"><div class="l">Créditos</div><div class="v num">${t.creditos}</div></div><div class="mini-stat"><div class="l">Ticket prom.</div><div class="v num">${U.moneyK(t.ticket)}</div></div><div class="mini-stat"><div class="l">Contactación</div><div class="v num">${U.pct(t.contactacion.pct, 0)}</div></div></div>
          <div class="mini-stats mt-2"><div class="mini-stat"><div class="l">En Mesa</div><div class="v num">${t.estado.mesa}</div></div><div class="mini-stat"><div class="l">Autorizados</div><div class="v num">${t.estado.autorizados}</div></div><div class="mini-stat"><div class="l">Por dispersar</div><div class="v num">${t.estado.porDispersar}</div></div></div>
        </div>
        <div class="cardx"><div class="card-title-x"><span>Proyección del equipo</span></div>
          <div class="proj-line"><span><span class="proj-tag" style="background:var(--b-azul);color:#fff">REAL</span></span><b class="num">${U.money(t.proyeccion.real)}</b></div>
          <div class="proj-line"><span><span class="proj-tag" style="background:var(--b-morado);color:#fff">EN CAMINO</span></span><b class="num">${U.money(t.proyeccion.enCamino)}</b></div>
          <div class="proj-line total"><span>Potencial</span><span class="num">${U.money(t.proyeccion.potencial)}</span></div>
          ${pend ? `<button class="btn btn-sm btn-soft mt-2 w-100" data-act="pendientes">⚠️ ${pend} registros por validar</button>` : '<div class="tiny ok-text mt-2">✓ Sin registros pendientes de validar</div>'}
        </div>
      </div>
      <div class="cardx mt-3">
        <div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><div class="card-title-x mb-0"><span>Asesores · toca una fila para ver el detalle</span></div>
          <input id="tblSearch" class="form-control form-control-sm" style="max-width:220px" placeholder="Buscar asesor…" value="${esc(S.search)}"></div>
        <div class="table-wrap"><table class="table table-x table-hover mb-0"><thead><tr>${COLS.map(([c, l]) => `<th data-sort="${c}" class="${k === c ? 'sorted' : ''}">${l}${k === c ? (d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr data-asesor="${esc(r.id)}">
          <td class="fw-bold">${esc(r.nombre)}</td><td class="num">${r.meta ? U.moneyK(r.meta) : '<span class="text-muted">sin meta</span>'}</td><td class="num fw-bold">${U.money(r.monto)}</td>
          <td class="num lvl-${D.progressLevel(r.m.avance).key}">${U.pct(r.m.avance, 0)}<span class="pbar sm mini-bar"><span style="width:${Math.min(100, r.avance)}%"></span></span></td>
          <td class="num">${r.creditos}${r.m.metaCreditos ? ' <span class="text-muted">/ ' + fmtC(r.m.metaCreditos) + '</span>' : ''}</td><td class="num lvl-${r.m.nivelCreditos.key}">${r.m.metaCreditos ? U.pct(r.m.avanceCreditos, 0) + `<span class="pbar sm mini-bar"><span style="width:${Math.min(100, r.avCred)}%"></span></span>` : '<span class="text-muted">sin meta</span>'}</td><td class="num">${r.ticket ? U.moneyK(r.ticket) : '—'}</td><td class="num">${U.pct(r.m.contactacion.pct, 0)}</td>
          <td class="num">${r.exped}</td><td class="num">${r.mesa}</td><td class="num">${r.aut}</td><td class="num">${U.moneyK(r.proy)}</td><td class="num">${U.int(r.puntos)}</td></tr>`).join('')}</tbody></table></div>
        <div class="tiny text-muted mt-2">Expedientes = alcanzados en el periodo. Mesa / Autorizados (incluye por dispersar) = cartera abierta hoy. Proyección = real + en camino.</div>
      </div>
      <div class="mt-3">${cReconocimiento()}</div>`;
    },
  };

  function openAsesorDetail(id) {
    const m = compute([id]);
    const ops = m.colocacionesList.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    const retos = G.retosAsesor(S.ds, S.cfg, id, S.today, { incluirConcluidos: true }).filter((e) => U.inRange(e.reto.fin, { from: U.addDays(range().from, -7), to: U.addDays(range().to, 7) }) || e.status === 'en_curso');
    const ganados = retos.filter((e) => e.cumplido && e.premio);
    const body = `<div class="grid g2">${cKpi(m)}${cPipeline(m)}</div>
      <div class="grid g2 mt-3">${cContactacion(m, [id])}${cProyeccion(m)}</div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Evolución semanal (últimas 8 semanas)</span></div><div style="height:200px;position:relative"><canvas id="chWeek"></canvas></div></div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Operaciones colocadas ${periodTitle()} (colocación oficial)</span><span>${ops.length}</span></div>
        <div class="table-responsive"><table class="table table-sm small mb-0"><thead><tr><th>Fecha</th><th>Contrato</th><th>Cliente</th><th>Tipo</th><th class="text-end">Monto</th><th>Cruce</th></tr></thead>
        <tbody>${ops.map((c) => `<tr><td>${U.fmtDateShort(c.fecha)}</td><td>${esc(c.contrato)}</td><td>${esc(U.shortName(c.nombre))}</td><td>${esc(c.tipo)}</td><td class="text-end num">${U.money(c.monto)}</td><td class="tiny">${c.ajuste ? `<span class="stage-pill st-concluido">Ajuste cierre · ${esc(c.ajusteFuente || '')}</span>` : c.matchVia ? { clienteId: 'ID cliente', contrato: 'Contrato', telHash: 'Teléfono', curpHash: 'CURP', nombreNorm: 'Nombre', funnel: 'Funnel' + (c.fechaEstimada ? ' (fecha últ. gestión)' : '') }[c.matchVia] : '<span class="warn-text">sin Funnel</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="text-muted">Sin colocaciones en el periodo.</td></tr>'}</tbody></table></div></div>
      <div class="grid g2 mt-3"><div class="cardx"><div class="card-title-x"><span>Retos</span></div>${retos.map((e) => cReto(e, { noPrize: true })).join('') || '<div class="small text-muted">Sin retos en el periodo.</div>'}</div>
      <div class="cardx"><div class="card-title-x"><span>Premios ganados</span></div>${ganados.map((e) => `<div class="reto-prize"><span class="emo">${esc(e.premio.emoji)}</span><div><div class="t">${esc(e.reto.nombre)}</div><div class="n">${esc(e.premio.nombre)}</div></div></div>`).join('') || '<div class="small text-muted">Aún sin premios en este periodo.</div>'}
      <div class="mt-3">${cPuntos(id)}</div></div></div>
      <div class="mt-3">${cCierres([id], 10, false)}</div>`;
    openModal(name(id), body, `<button class="btn btn-soft" data-viewas="${esc(id)}">👤 Ver su pantalla</button><button class="btn btn-light" data-bs-dismiss="modal">Cerrar</button>`, () => {
      const cv = $('#chWeek'); if (!cv || !window.Chart) return;
      const w = D.weeklySeries(S.ds, { asesorIds: [id], today: S.today, weeks: 8 });
      S.charts.week = new Chart(cv, { type: 'bar', data: { labels: w.map((x) => U.fmtDateShort(x.from)), datasets: [{ label: 'Colocación semanal', data: w.map((x) => x.monto), backgroundColor: '#8EABEE', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => U.money(c.parsed.y) + ` · ${w[c.dataIndex].n} créditos` } } }, scales: { y: { ticks: { callback: (v) => U.moneyK(v) } }, x: { grid: { display: false } } } } });
    });
  }

  /* ------------------------------------------------------------------
   * CARGA DE ARCHIVOS + MAPEADOR
   * ---------------------------------------------------------------- */
  VIEWS.cargar = {
    html() {
      const ms = S.ds.matchStats;
      return `<div class="grid g2">
        <label class="drop" data-drop="funnel"><input type="file" accept=".xlsx,.xls,.csv" hidden data-file="funnel"><div class="e">📋</div><div class="t">Excel / CSV del Funnel BINCO</div><div class="small text-muted">Arrastra aquí o toca para elegir · leads, gestiones, contactación, expedientes, Mesa, autorizaciones</div></label>
        <label class="drop" data-drop="icarus"><input type="file" accept=".xlsx,.xls,.csv" hidden data-file="icarus"><div class="e">🏦</div><div class="t">Colocación oficial (ICARUS o sistema nuevo)</div><div class="small text-muted">Arrastra aquí o toca para elegir · colocación oficial: contrato, fecha, monto</div></label>
      </div>
      <div id="mapPanel" class="mt-3">${S.pending ? mapPanelHtml() : ''}</div>
      <div id="importResult" class="mt-3">${S.lastImport ? importResultHtml() : ''}</div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Estado actual de la información</span></div>
        <div class="result-grid">
          <div class="result-box"><div class="v num">${U.int(S.raw.funnel.length)}</div><div class="l">registros Funnel</div></div>
          <div class="result-box"><div class="v num">${U.int(S.raw.icarus.length)}</div><div class="l">registros de colocación</div></div>
          <div class="result-box"><div class="v num">${U.int(ms.coincidencias)}</div><div class="l">coincidencias Funnel ↔ colocación</div></div>
          <div class="result-box"><div class="v num">${U.int(ms.pendientes)}</div><div class="l">pendientes de validar</div></div>
        </div>
        <div class="small text-muted mt-2">Cruce por: ID cliente ${ms.clienteId} · contrato ${ms.contrato} · teléfono ${ms.telHash} · CURP ${ms.curpHash} · nombre ${ms.nombreNorm} · sin cruce ${ms.sinCruce} (cuentan como colocación porque el reporte de colocación es la fuente oficial) · cancelados excluidos ${ms.canceladosExcluidos} · clientes únicos ${U.int(ms.clientesUnicos)}</div>
        <div class="d-flex flex-wrap gap-2 mt-3">
          ${ms.pendientes ? '<button class="btn btn-sm btn-soft" data-act="pendientes">Ver pendientes de validar</button>' : ''}
          <button class="btn btn-sm btn-outline-binco" data-act="plantillas">⬇️ Descargar plantillas de ejemplo</button>
          <button class="btn btn-sm btn-outline-binco" data-act="demo">🧪 Cargar datos de demostración</button>
          <button class="btn btn-sm btn-outline-binco" data-act="goCierres">📌 Ajuste de cierre de mes${(S.cfg.cierres || []).length ? ' (' + S.cfg.cierres.length + ')' : ''}</button>
          <button class="btn btn-sm btn-binco" data-act="publicar">📤 Publicar para el equipo</button>
        </div>
        <div class="tiny text-muted mt-2">La información nunca se reemplaza: cada carga actualiza los registros existentes y agrega los nuevos, guardando el histórico de etapas y una foto diaria por asesor.</div>
      </div>`;
    },
    after() { bindDrops(); },
  };

  function bindDrops() {
    $$('[data-drop]').forEach((z) => {
      ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
      z.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f, z.dataset.drop); });
    });
    $$('[data-file]').forEach((i) => i.addEventListener('change', () => { if (i.files[0]) handleFile(i.files[0], i.dataset.file); i.value = ''; }));
  }

  async function handleFile(file, zone) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return toast('Formato no válido. Usa .xlsx, .xls o .csv');
    try {
      const t = await D.readFile(file);
      if (!t.rows.length) return toast('El archivo no tiene registros.');
      const guessed = D.guessSource(t.headers);
      S.pending = { fileName: file.name, source: zone, guessed, table: t, mapping: D.suggestMapping(zone, t.headers, S.cfg.mappings[zone]), stageOverrides: {} };
      S.lastImport = null;
      $('#mapPanel').innerHTML = mapPanelHtml(); $('#importResult').innerHTML = '';
      $('#mapPanel').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { console.error(e); toast('No se pudo leer el archivo: ' + e.message); }
  }

  function pendingCfg() { return Object.assign({}, S.cfg, { stageMap: Object.assign({}, S.cfg.stageMap, S.pending.stageOverrides) }); }

  function mapPanelHtml() {
    const P = S.pending; const src = P.source; const t = P.table;
    const sample = (col) => { const r = t.rows.find((x) => String(x[col] == null ? '' : x[col]).trim() !== ''); let v = r ? r[col] : ''; if (v instanceof Date) v = U.ymd(v); return String(v).slice(0, 28); };
    const errs = D.validateMapping(src, P.mapping);
    const an = errs.length ? null : D.analyze(src, t.rows, P.mapping, pendingCfg());
    const unk = an && src === 'funnel' ? Object.entries(an.etapasNoReconocidas) : [];
    const stageOpts = D.STAGES.map((s) => `<option value="${s.key}">${s.label}</option>`).join('');
    return `<div class="cardx">
      <div class="card-title-x"><span>Asistente de columnas · ${src === 'funnel' ? 'Funnel BINCO' : 'Colocación oficial'}</span><button class="btn-close" data-act="cancelImport" aria-label="Cancelar"></button></div>
      <div class="small mb-2">📄 <b>${esc(P.fileName)}</b> · hoja "${esc(t.sheetName)}" · ${U.int(t.rows.length)} filas · ${t.headers.length} columnas</div>
      ${P.guessed !== src ? `<div class="alert alert-warning py-2 small">Este archivo parece de <b>${P.guessed === 'funnel' ? 'Funnel' : 'colocación oficial'}</b>. <button class="btn btn-sm btn-link p-0" data-act="switchSource">Tratarlo como ${P.guessed === 'funnel' ? 'Funnel' : 'colocación oficial'}</button></div>` : ''}
      <div class="small text-muted mb-2">Relacionamos automáticamente las columnas. Revisa y corrige si algo no coincide; el mapeo se guarda para futuras cargas.</div>
      ${D.FIELDS[src].map((f) => `<div class="map-row"><div class="small"><b>${f.label}</b> ${f.req ? '<span class="req">*</span>' : ''}<div class="tiny text-muted">${P.mapping[f.key] ? 'ej. ' + esc(sample(P.mapping[f.key])) : 'opcional'}</div></div>
        <select class="form-select form-select-sm" data-map="${f.key}"><option value="">— No aplica —</option>${t.headers.map((h) => `<option ${P.mapping[f.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}
      ${unk.length ? `<div class="mt-3"><div class="fw-bold small">Estatus no reconocidos — ¿a qué etapa corresponden?</div>${unk.map(([n, raw]) => `<div class="map-row"><div class="small">"${esc(raw)}"</div><select class="form-select form-select-sm" data-stage="${esc(n)}"><option value="">Elegir etapa…</option>${stageOpts}</select></div>`).join('')}</div>` : ''}
      ${an && src === 'funnel' ? `<details class="mt-2 small"><summary>Ver cómo se interpretan los estatus (${Object.keys(an.etapasDetectadas).length})</summary>${Object.entries(an.etapasDetectadas).map(([k, v]) => `<div>${esc(k)} → <b>${D.STAGE_LABEL[v]}</b></div>`).join('')}</details>` : ''}
      <div class="mt-3">${errs.length ? errs.map((e) => `<div class="warn-text small">⚠️ ${esc(e)}</div>`).join('') : `
        <div class="result-grid">
          <div class="result-box"><div class="v num">${U.int(an.validos)}</div><div class="l">registros válidos</div></div>
          <div class="result-box"><div class="v num">${U.int(an.duplicados)}</div><div class="l">duplicados (se consolidan)</div></div>
          <div class="result-box"><div class="v num">${U.int(an.invalidos)}</div><div class="l">filas inválidas</div></div>
          <div class="result-box"><div class="v" style="font-size:.95rem">${an.periodo ? U.fmtDateShort(an.periodo.from) + ' – ' + U.fmtDate(an.periodo.to) : '—'}</div><div class="l">periodo detectado</div></div>
        </div>
        ${an.issues.length ? `<details class="mt-2 small"><summary class="warn-text">${an.issues.length} observaciones</summary>${an.issues.slice(0, 50).map((i) => `<div>• ${esc(i)}</div>`).join('')}</details>` : ''}
        ${an.periodo && an.periodo.to > S.today ? '<div class="warn-text small mt-1">El archivo contiene fechas futuras; revisa el formato de fecha (se asume dd/mm/aaaa).</div>' : ''}`}
      </div>
      <div class="d-flex gap-2 mt-3"><button class="btn btn-binco" data-act="doImport" ${errs.length ? 'disabled' : ''}>Guardar mapeo e importar</button><button class="btn btn-light" data-act="cancelImport">Cancelar</button></div>
    </div>`;
  }

  async function doImport() {
    const P = S.pending; if (!P) return;
    const src = P.source;
    // guardar mapeo y estatus para futuras cargas
    Object.entries(P.mapping).forEach(([field, header]) => { if (header) S.cfg.mappings[src][U.norm(header)] = field; });
    Object.assign(S.cfg.stageMap, P.stageOverrides);
    const an = D.analyze(src, P.table.rows, P.mapping, S.cfg);
    const cargaId = U.uid(); const now = new Date().toISOString();
    let res;
    if (src === 'funnel') { res = D.mergeFunnel(S.raw.funnel, an.records, cargaId, S.today); S.raw.funnel = res.records; }
    else { res = D.mergeIcarus(S.raw.icarus, an.records, cargaId); S.raw.icarus = res.records; }
    S.raw.cargas.unshift({ id: cargaId, fecha: now, fuente: src, archivo: P.fileName, filas: P.table.rows.length, validos: an.validos, duplicados: an.duplicados, invalidos: an.invalidos, nuevos: res.nuevos, actualizados: res.actualizados, periodo: an.periodo });
    S.raw.meta[src] = now;
    saveCfg(); rebuild(); takeSnapshot();
    await saveRaw();
    S.lastImport = { src, an, res, fileName: P.fileName };
    S.pending = null;
    render();
    toast('Archivo cargado correctamente.');
  }

  function importResultHtml() {
    const L = S.lastImport, ms = S.ds.matchStats;
    return `<div class="cardx" style="border:1.5px solid #BDE9EA">
      <div class="card-title-x"><span class="ok-text">✓ Archivo cargado correctamente</span><span class="tiny">${esc(L.fileName)}</span></div>
      <div class="result-grid">
        <div class="result-box"><div class="v num">${U.int(S.raw.funnel.length)}</div><div class="l">registros Funnel</div></div>
        <div class="result-box"><div class="v num">${U.int(S.raw.icarus.length)}</div><div class="l">registros de colocación</div></div>
        <div class="result-box"><div class="v num">${U.int(ms.coincidencias)}</div><div class="l">coincidencias</div></div>
        <div class="result-box"><div class="v num">${U.int(ms.pendientes)}</div><div class="l">pendientes de validar</div></div>
      </div>
      <div class="small text-muted mt-2">De esta carga: ${L.res.nuevos} nuevos · ${L.res.actualizados} actualizados · ${L.an.duplicados} duplicados consolidados · ${L.an.invalidos} inválidos.</div>
    </div>`;
  }

  function takeSnapshot() {
    const mr = { from: U.monthStart(S.today), to: U.monthEnd(S.today) };
    S.raw.snapshots = S.raw.snapshots.filter((s) => s.fecha !== S.today);
    activeIds().forEach((id) => {
      const m = compute([id], mr, 'Todos');
      S.raw.snapshots.push({ fecha: S.today, semana: U.weekStart(S.today), mes: U.monthKey(S.today), asesorId: id, colocadoMes: m.monto, creditosMes: m.creditos, meta: m.meta, avance: m.avance, contactacion: m.contactacion.pct, trabajados: m.contactacion.trabajados, mesa: m.estado.mesa, autorizados: m.estado.autorizados, porDispersar: m.estado.porDispersar, enCamino: m.proyeccion.enCamino });
    });
  }

  function showPendientes() {
    const f = S.ds.funnel.filter((x) => x.pendienteValidar);
    const c = S.ds.colocaciones.filter((x) => x.asesorId === 'SIN ASESOR');
    openModal('Pendientes de validar', `
      <p class="small text-muted">Estos registros no se cuentan como colocación hasta que la colocación oficial los confirme (o hasta asignar asesor).</p>
      <h3 class="h6 fw-bold">Marcados como colocados en Funnel sin confirmación en colocación oficial (${f.length})</h3>
      <div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Asesor</th><th>Cliente</th><th>Estatus Funnel</th><th class="text-end">Monto</th><th>Últ. gestión</th></tr></thead><tbody>
      ${f.map((x) => `<tr><td>${esc(prettyName(x.asesorNombre))}</td><td>${esc(U.shortName(x.nombre))}</td><td>${esc(x.etapaRaw)}</td><td class="text-end">${U.money(x.monto)}</td><td>${U.fmtDateShort(x.fUlt)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">Ninguno</td></tr>'}</tbody></table></div>
      <h3 class="h6 fw-bold mt-3">Colocaciones oficiales sin asesor identificado (${c.length})</h3>
      <div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Contrato</th><th>Fecha</th><th class="text-end">Monto</th></tr></thead><tbody>
      ${c.map((x) => `<tr><td>${esc(x.contrato)}</td><td>${U.fmtDateShort(x.fecha)}</td><td class="text-end">${U.money(x.monto)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-muted">Ninguna</td></tr>'}</tbody></table></div>`);
  }

  async function loadDemo() {
    const demo = D.demoData(S.today);
    const fm = D.suggestMapping('funnel', Object.keys(demo.funnel[0]), S.cfg.mappings.funnel);
    const im = D.suggestMapping('icarus', Object.keys(demo.icarus[0]), S.cfg.mappings.icarus);
    const fa = D.analyze('funnel', demo.funnel, fm, S.cfg), ia = D.analyze('icarus', demo.icarus, im, S.cfg);
    const id = U.uid(), now = new Date().toISOString();
    S.raw.funnel = D.mergeFunnel(S.raw.funnel, fa.records, id, S.today).records;
    S.raw.icarus = D.mergeIcarus(S.raw.icarus, ia.records, id).records;
    S.raw.cargas.unshift({ id, fecha: now, fuente: 'demo', archivo: 'Datos de demostración', filas: demo.funnel.length + demo.icarus.length, validos: fa.validos + ia.validos, duplicados: fa.duplicados + ia.duplicados, invalidos: 0, nuevos: fa.validos + ia.validos, actualizados: 0, periodo: fa.periodo });
    S.raw.meta.funnel = now; S.raw.meta.icarus = now;
    rebuild();
    Object.entries(demo.metas).forEach(([n, meta]) => { const aid = U.normName(n); if (S.cfg.asesores[aid] && !S.cfg.asesores[aid].metaBase) S.cfg.asesores[aid].metaBase = meta; });
    saveCfg(); takeSnapshot(); await saveRaw();
    toast('Datos de demostración cargados.');
  }

  function downloadTemplates() {
    const demo = D.demoData(S.today);
    dlCsv('plantilla_funnel.csv', demo.funnel.slice(0, 15));
    setTimeout(() => dlCsv('plantilla_icarus.csv', demo.icarus.slice(0, 10)), 400);
  }
  function dlCsv(fname, rows) {
    const h = Object.keys(rows[0]);
    const csv = [h.join(',')].concat(rows.map((r) => h.map((k) => `"${String(r[k] == null ? '' : r[k]).replace(/"/g, '""')}"`).join(','))).join('\r\n');
    dlBlob(fname, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  }
  function dlBlob(fname, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  /* ------------------------------------------------------------------
   * RETOS (ADMIN)
   * ---------------------------------------------------------------- */
  VIEWS.retosAdm = {
    html() {
      const rd = S.cfg.retoDia;
      const indOpts = (sel) => Object.entries(G.INDICADORES).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.label}</option>`).join('');
      const list = (S.cfg.retos || []).slice().sort((a, b) => b.inicio.localeCompare(a.inicio));
      return `<div class="cardx">
        <div class="card-title-x"><span>⚡ Reto de hoy</span><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="rdActivo" ${rd.activo ? 'checked' : ''}><label class="form-check-label small" for="rdActivo">Activo</label></div></div>
        <div class="row g-2"><div class="col-12 col-md-6"><label class="form-label small">Texto</label><input class="form-control" id="rdTexto" value="${esc(rd.texto)}"></div>
        <div class="col-7 col-md-4"><label class="form-label small">Indicador para medir</label><select class="form-select" id="rdInd">${indOpts(rd.indicador)}</select></div>
        <div class="col-5 col-md-2"><label class="form-label small">Meta del día</label><input type="number" class="form-control" id="rdMeta" value="${esc(rd.meta)}"></div></div>
        <button class="btn btn-sm btn-binco mt-2" data-act="saveRetoDia">Guardar reto de hoy</button>
      </div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Retos configurados</span><button class="btn btn-sm btn-binco" data-act="newReto">+ Nuevo reto</button></div>
        ${list.map((r) => {
          const st = G.retoStatus(r, S.today);
          const ids = G.participantIds(r, S.cfg);
          let resumen = '';
          if (r.modo === 'grupal' || (G.INDICADORES[r.indicador] || {}).grupal) { const e = G.evalReto(S.ds, S.cfg, r, ids[0], S.today); if (e) resumen = `Equipo: <b>${e.valorFmt}</b> de ${e.metaFmt} (${U.pct(e.progreso, 0)})`; }
          else { const evs = ids.map((id) => G.evalReto(S.ds, S.cfg, r, id, S.today)).filter(Boolean); resumen = `<b>${evs.filter((e) => e.cumplido).length}</b> de ${evs.length} participantes lo han logrado`; }
          const p = S.cfg.premios.find((x) => x.id === r.premioId);
          return `<div class="reto"><div class="reto-head"><div><div class="reto-name">${esc(r.nombre)}</div><div class="reto-desc">${esc(r.descripcion || '')}</div>
            <div class="tiny text-muted mt-1">${U.fmtDateShort(r.inicio)} – ${U.fmtDate(r.fin)} · ${esc((G.INDICADORES[r.indicador] || {}).label || r.indicador)} · meta ${G.fmtInd(r.indicador, r.meta)} · ${r.modo === 'grupal' ? 'grupal' : 'individual'} · ${r.participantes === 'todos' ? 'todo el equipo' : ids.length + ' participantes'}${r.tipo && r.tipo !== 'Todos' ? ' · solo ' + esc(r.tipo) : ''}</div>
            <div class="small mt-1">${resumen} ${p ? ' · Premio: ' + esc(p.emoji + ' ' + p.nombre) : ''}</div></div>
            <span class="status-pill st-${st}">${{ en_curso: 'En curso', proximo: 'Próximo', concluido: 'Concluido', borrador: 'Borrador', pausado: 'Pausado' }[st]}</span></div>
            <div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-soft" data-edit-reto="${r.id}">Editar</button><button class="btn btn-sm btn-light" data-dup-reto="${r.id}">Duplicar</button><button class="btn btn-sm btn-light text-danger" data-del-reto="${r.id}">Eliminar</button></div></div>`;
        }).join('') || '<div class="text-muted small">Aún no hay retos.</div>'}
      </div>`;
    },
  };

  function retoForm(r) {
    const isNew = !r;
    const ws = U.weekStart(S.today);
    r = r || { id: 'r' + U.uid(), nombre: '', descripcion: '', inicio: ws, fin: U.addDays(ws, 4), indicador: 'contactos', meta: 10, premioId: (S.cfg.premios[0] || {}).id, participantes: 'todos', modo: 'individual', tipo: 'Todos', estado: 'activo' };
    const ids = activeIds();
    const body = `<form id="retoForm" class="row g-2">
      <div class="col-12"><label class="form-label small">Nombre</label><input class="form-control" name="nombre" required value="${esc(r.nombre)}" placeholder="Ej. Reto Contactación"></div>
      <div class="col-12"><label class="form-label small">Descripción</label><input class="form-control" name="descripcion" value="${esc(r.descripcion)}" placeholder="Ej. Logra 50 contactos efectivos esta semana"></div>
      <div class="col-6"><label class="form-label small">Fecha de inicio</label><input type="date" class="form-control" name="inicio" required value="${r.inicio}"></div>
      <div class="col-6"><label class="form-label small">Fecha de término</label><input type="date" class="form-control" name="fin" required value="${r.fin}"></div>
      <div class="col-12 col-md-6"><label class="form-label small">Indicador</label><select class="form-select" name="indicador">${Object.entries(G.INDICADORES).map(([k, v]) => `<option value="${k}" ${r.indicador === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label small">Meta</label><input type="number" step="any" min="0" class="form-control" name="meta" required value="${esc(r.meta)}"></div>
      <div class="col-6 col-md-3"><label class="form-label small">Tipo de crédito</label><select class="form-select" name="tipo">${['Todos'].concat(D.TIPOS).map((t) => `<option ${r.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="col-12 col-md-6"><label class="form-label small">Premio</label><select class="form-select" name="premioId"><option value="">Sin premio</option>${S.cfg.premios.map((p) => `<option value="${p.id}" ${r.premioId === p.id ? 'selected' : ''}>${esc(p.emoji + ' ' + p.nombre)}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label small">Modalidad</label><select class="form-select" name="modo"><option value="individual" ${r.modo === 'individual' ? 'selected' : ''}>Individual</option><option value="grupal" ${r.modo === 'grupal' ? 'selected' : ''}>Grupal</option></select></div>
      <div class="col-6 col-md-3"><label class="form-label small">Estado</label><select class="form-select" name="estado">${['activo', 'pausado', 'borrador'].map((s) => `<option ${r.estado === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label small">Participantes</label>
        <div class="form-check"><input class="form-check-input" type="checkbox" name="todos" id="pTodos" ${r.participantes === 'todos' ? 'checked' : ''}><label class="form-check-label small" for="pTodos">Todo el equipo</label></div>
        <div id="pList" class="row g-1 ${r.participantes === 'todos' ? 'd-none' : ''}">${ids.map((id) => `<div class="col-6"><div class="form-check"><input class="form-check-input" type="checkbox" name="p" value="${esc(id)}" id="p_${esc(id)}" ${Array.isArray(r.participantes) && r.participantes.includes(id) ? 'checked' : ''}><label class="form-check-label small" for="p_${esc(id)}">${esc(name(id))}</label></div></div>`).join('')}</div></div>
      <div class="col-12 tiny text-muted">Los porcentajes (contactación, conversión) se capturan como número: 80 = 80%. En retos grupales, el avance suma a todos los participantes.</div>
    </form>`;
    openModal(isNew ? 'Nuevo reto' : 'Editar reto', body, `<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-binco" id="saveReto">Guardar reto</button>`, () => {
      $('#pTodos').addEventListener('change', (e) => $('#pList').classList.toggle('d-none', e.target.checked));
      $('#saveReto').addEventListener('click', () => {
        const f = $('#retoForm'); if (!f.reportValidity()) return;
        const fd = new FormData(f);
        const nr = { id: r.id, nombre: fd.get('nombre').trim(), descripcion: fd.get('descripcion').trim(), inicio: fd.get('inicio'), fin: fd.get('fin'), indicador: fd.get('indicador'), meta: Number(fd.get('meta')), tipo: fd.get('tipo'), premioId: fd.get('premioId'), modo: fd.get('modo'), estado: fd.get('estado'), participantes: fd.get('todos') ? 'todos' : fd.getAll('p') };
        if (nr.fin < nr.inicio) return toast('La fecha de término debe ser posterior al inicio.');
        if (Array.isArray(nr.participantes) && !nr.participantes.length) return toast('Elige al menos un participante.');
        const i = S.cfg.retos.findIndex((x) => x.id === r.id);
        if (i >= 0) S.cfg.retos[i] = nr; else S.cfg.retos.push(nr);
        saveCfg(); closeModal(); render(); toast('Reto guardado.');
      });
    });
  }

  /* ------------------------------------------------------------------
   * PREMIOS (ADMIN)
   * ---------------------------------------------------------------- */
  VIEWS.premios = {
    html() {
      return `<div class="cardx"><div class="card-title-x"><span>Catálogo de premios</span><button class="btn btn-sm btn-binco" data-act="newPremio">+ Nuevo premio</button></div>
        <div class="small text-muted mb-2">Cambia nombre, ícono, descripción o desactiva premios sin tocar código. Los retos usan este catálogo.</div>
        ${S.cfg.premios.map((p) => {
          const usos = S.cfg.retos.filter((r) => r.premioId === p.id).length;
          return `<div class="d-flex align-items-center gap-3 py-2 border-bottom"><div class="fs-2">${esc(p.emoji)}</div>
            <div class="flex-grow-1"><div class="fw-bold">${esc(p.nombre)} ${p.activo === false ? '<span class="status-pill st-pausado">inactivo</span>' : ''}</div><div class="small text-muted">${esc(p.descripcion || '')}</div><div class="tiny text-muted">Usado en ${usos} reto(s)</div></div>
            <button class="btn btn-sm btn-soft" data-edit-premio="${p.id}">Editar</button><button class="btn btn-sm btn-light text-danger" data-del-premio="${p.id}">Eliminar</button></div>`;
        }).join('')}
      </div>`;
    },
  };
  function premioForm(p) {
    const isNew = !p;
    p = p || { id: 'p' + U.uid(), emoji: '🎁', nombre: '', descripcion: '', activo: true };
    openModal(isNew ? 'Nuevo premio' : 'Editar premio', `<form id="premioForm" class="row g-2">
      <div class="col-3"><label class="form-label small">Ícono</label><input class="form-control text-center fs-4" name="emoji" maxlength="4" value="${esc(p.emoji)}"></div>
      <div class="col-9"><label class="form-label small">Nombre</label><input class="form-control" name="nombre" required value="${esc(p.nombre)}"></div>
      <div class="col-12"><label class="form-label small">Descripción / reglas</label><textarea class="form-control" name="descripcion" rows="2">${esc(p.descripcion)}</textarea></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="activo" id="pActivo" ${p.activo !== false ? 'checked' : ''}><label class="form-check-label" for="pActivo">Activo (visible para el equipo)</label></div></div>
      <div class="col-12 tiny text-muted">Sugeridos: 🏠 ⏰ 🍽️ 🎁 ⛽ ⭐ 🏆 🎟️ ☕ 🎬</div></form>`,
      `<button class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-binco" id="savePremio">Guardar</button>`, () => {
        $('#savePremio').addEventListener('click', () => {
          const f = $('#premioForm'); if (!f.reportValidity()) return;
          const fd = new FormData(f);
          const np = { id: p.id, emoji: fd.get('emoji') || '🎁', nombre: fd.get('nombre').trim(), descripcion: fd.get('descripcion').trim(), activo: !!fd.get('activo') };
          const i = S.cfg.premios.findIndex((x) => x.id === p.id);
          if (i >= 0) S.cfg.premios[i] = np; else S.cfg.premios.push(np);
          saveCfg(); closeModal(); render(); toast('Premio guardado.');
        });
      });
  }

  /* ------------------------------------------------------------------
   * AJUSTES (ADMIN)
   * ---------------------------------------------------------------- */
  VIEWS.config = {
    html() {
      const tabs = [['metas', 'Metas y asesores'], ['cierres', 'Cierres de mes'], ['puntos', 'Puntos y logros'], ['reglas', 'Reglas'], ['acceso', 'Acceso y publicación'], ['api', 'API (Fase 2)'], ['historico', 'Histórico y respaldo']];
      return `<div class="sub-tabs chip-group">${tabs.map(([k, l]) => `<button class="chip ${S.cfgTab === k ? 'active' : ''}" data-cfgtab="${k}">${l}</button>`).join('')}</div>${CFG[S.cfgTab]()}`;
    },
  };
  const CFG = {};
  CFG.metas = () => {
    const mk = S.cfgMonth || U.monthKey(S.today);
    const allIds = Object.keys(S.cfg.asesores).sort((a, b) => name(a).localeCompare(name(b)));
    const me = (S.cfg.metas[mk] || {});
    S.cfg.metasCreditos = S.cfg.metasCreditos || {}; S.cfg.metaEquipoCreditos = S.cfg.metaEquipoCreditos || {};
    const mc = (S.cfg.metasCreditos[mk] || {});
    return `<div class="cardx"><div class="card-title-x"><span>Metas mensuales</span><input type="month" id="cfgMonth" class="form-control form-control-sm" style="max-width:170px" value="${mk}"></div>
      <div class="small text-muted mb-2">La meta del mes sustituye a la meta base. Deja vacío para usar la meta base. Para periodos parciales (hoy, semana) se prorratea por días hábiles.</div>
      <div class="table-responsive"><table class="table table-sm align-middle small"><thead><tr><th>Asesor</th><th>Meta $ ${esc(U.monthName(mk + '-01'))}</th><th>Meta $ base</th><th>Meta créditos ${esc(U.monthName(mk + '-01').split(' ')[0])}</th><th>Meta créditos base</th><th>Activo</th><th>Unir con (duplicado)</th></tr></thead><tbody>
      ${allIds.map((id) => { const a = S.cfg.asesores[id]; return `<tr><td><input class="form-control form-control-sm" data-an="${esc(id)}" value="${esc(a.nombre)}"></td>
        <td><input type="number" min="0" step="1000" class="form-control form-control-sm" data-mm="${esc(id)}" value="${me[id] != null ? esc(me[id]) : ''}" placeholder="${esc(a.metaBase || 0)}"></td>
        <td><input type="number" min="0" step="1000" class="form-control form-control-sm" data-mb="${esc(id)}" value="${esc(a.metaBase || 0)}"></td>
        <td><input type="number" min="0" step="1" class="form-control form-control-sm" style="min-width:80px" data-mcm="${esc(id)}" value="${mc[id] != null ? esc(mc[id]) : ''}" placeholder="${esc(a.metaCreditosBase || 0)}"></td>
        <td><input type="number" min="0" step="1" class="form-control form-control-sm" style="min-width:80px" data-mcb="${esc(id)}" value="${esc(a.metaCreditosBase || 0)}"></td>
        <td><input type="checkbox" class="form-check-input" data-aa="${esc(id)}" ${a.activo !== false ? 'checked' : ''}></td>
        <td><select class="form-select form-select-sm" data-alias="${esc(id)}"><option value="">—</option>${allIds.filter((x) => x !== id).map((x) => `<option value="${esc(x)}">${esc(name(x))}</option>`).join('')}</select></td></tr>`; }).join('') || '<tr><td colspan="5" class="text-muted">Los asesores se registran automáticamente al cargar el Funnel o la colocación oficial.</td></tr>'}
      </tbody></table></div>
      <div class="row g-2 align-items-end"><div class="col-12 col-md-5"><label class="form-label small">Meta del equipo ${esc(U.monthName(mk + '-01'))} (vacío = suma de metas individuales activas)</label><input type="number" min="0" step="10000" class="form-control" id="metaEquipo" value="${esc(S.cfg.metaEquipo[mk] || '')}"></div>
      <div class="col-12 col-md-4"><label class="form-label small">Meta de créditos del equipo ${esc(U.monthName(mk + '-01'))} (vacío = suma)</label><input type="number" min="0" step="1" class="form-control" id="metaEquipoCreditos" value="${esc(S.cfg.metaEquipoCreditos[mk] || '')}"></div>
      <div class="col-12 col-md-3"><button class="btn btn-binco w-100" data-act="saveMetas">Guardar metas</button></div></div></div>`;
  };
  CFG.puntos = () => {
    const p = S.cfg.puntos, l = S.cfg.logros;
    const inp = (k, lbl, o, step) => `<div class="col-6 col-md-4"><label class="form-label small">${lbl}</label><input type="number" min="0" step="${step || 1}" class="form-control" data-${o}="${k}" value="${esc((o === 'pt' ? p : l)[k])}"></div>`;
    return `<div class="cardx"><div class="card-title-x"><span>Puntos BINCO</span></div>
      <div class="row g-2">${inp('contacto', 'Contacto efectivo', 'pt')}${inp('expediente', 'Expediente completo', 'pt')}${inp('mesa', 'Envío a Mesa', 'pt')}${inp('autorizado', 'Autorizado', 'pt')}${inp('colocado', 'Crédito colocado', 'pt')}${inp('metaSemanal', 'Meta semanal cumplida (bono)', 'pt')}</div>
      <div class="tiny text-muted mt-2">Los puntos son únicamente gamificación; no sustituyen los KPIs comerciales oficiales.</div></div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Logros automáticos</span></div>
      <div class="row g-2">${inp('rachaDias', 'Días de racha comercial', 'lg')}${inp('contactacionMin', '% contactación para logro', 'lg')}${inp('minTrabajados', 'Mín. leads trabajados', 'lg')}${inp('hito1', 'Hito de colocación 1 ($)', 'lg', 10000)}${inp('hito2', 'Hito de colocación 2 ($)', 'lg', 10000)}</div>
      <button class="btn btn-binco mt-3" data-act="savePuntos">Guardar</button></div>`;
  };
  CFG.reglas = () => {
    const c = S.cfg; const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return `<div class="cardx"><div class="card-title-x"><span>Reglas de cálculo y visualización</span></div><div class="row g-3">
      <div class="col-12 col-md-6"><label class="form-label small">Fuente de la colocación (monto y créditos colocados)</label><select class="form-select" id="fuenteCol">${[['funnel', 'Funnel (créditos con estatus Colocado) — recomendado'], ['oficial', 'Reporte oficial (ICARUS o sistema nuevo)']].map(([k, l]) => `<option value="${k}" ${(c.fuenteColocacion === 'oficial' ? 'oficial' : 'funnel') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="tiny text-muted mt-1">Con "Funnel", la fecha de colocación es la columna "Fecha de colocación / dispersión" si el reporte la trae; si no, la fecha de última gestión.</div></div>
      <div class="col-6 col-md-3"><label class="form-label small">% de autorizados en proyección</label><input type="number" min="0" max="100" class="form-control" id="fAut" value="${Math.round(c.factorAutorizado * 100)}"></div>
      <div class="col-6 col-md-3"><label class="form-label small">% de Mesa en proyección</label><input type="number" min="0" max="100" class="form-control" id="fMesa" value="${Math.round(c.factorMesa * 100)}"></div>
      <div class="col-12 col-md-6"><label class="form-label small d-block">Días hábiles (ritmo y prorrateo de metas)</label>${dias.map((d, i) => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" data-dia="${i}" id="d${i}" ${c.diasHabiles.includes(i) ? 'checked' : ''}><label class="form-check-label small" for="d${i}">${d}</label></div>`).join('')}</div>
      <div class="col-6 col-md-3"><label class="form-label small">Ranking por</label><select class="form-select" id="rkCrit">${[['monto', 'Monto colocado'], ['avance', '% de meta'], ['puntos', 'Puntos BINCO']].map(([k, l]) => `<option value="${k}" ${c.rankingCriterio === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="col-6 col-md-3"><label class="form-label small">Reconocimiento semanal</label><select class="form-select" id="recMode">${[['viernes', 'Viernes (automático)'], ['siempre', 'Siempre visible'], ['nunca', 'Oculto']].map(([k, l]) => `<option value="${k}" ${c.reconocimientoModo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="col-12 col-md-6"><div class="form-check form-switch mt-4"><input class="form-check-input" type="checkbox" id="rkMoney" ${c.privacidad.mostrarRankingMontos ? 'checked' : ''}><label class="form-check-label small" for="rkMoney">Mostrar montos de compañeros en el ranking (si se desactiva, el asesor ve solo % de meta de los demás)</label></div></div>
      <div class="col-12"><label class="form-label small">Mensajes motivacionales (uno por línea; rotan por día)</label><textarea class="form-control" id="msgs" rows="4">${esc(c.mensajes.join('\n'))}</textarea></div>
    </div><button class="btn btn-binco mt-3" data-act="saveReglas">Guardar reglas</button></div>`;
  };
  CFG.acceso = () => {
    const ids = activeIds();
    return `<div class="cardx"><div class="card-title-x"><span>PIN de supervisor</span></div>
      <div class="row g-2"><div class="col-8 col-md-4"><input type="password" class="form-control" id="newPin" placeholder="Nuevo PIN (mín. 6 caracteres)" autocomplete="new-password"></div><div class="col-4"><button class="btn btn-binco" data-act="savePin">Cambiar</button></div></div></div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Publicación para el equipo (celular)</span></div>
      ${location.protocol === 'file:' ? `<div class="alert alert-warning small"><b>Estás usando la app desde tu computadora (archivo local).</b> Los enlaces de los asesores solo funcionan cuando la carpeta de la app y el archivo <b>publicacion.json</b> están subidos a un servidor web (https). Pasos: 1) sube la carpeta completa al servidor, 2) escribe abajo la dirección donde quedó, 3) genera publicacion.json, súbelo a la misma carpeta del servidor y 4) copia los enlaces.</div>` : ''}
      ${!pubBase() ? '<div class="warn-text small mb-2">⚠️ Falta la URL donde estará publicada la app; sin ella los enlaces no abren en el celular.</div>' : ''}
      <p class="small">Genera un archivo <b>publicacion.json</b> cifrado y súbelo junto a la app (intranet, SharePoint con sitio web, servidor interno). Cada asesor recibe un enlace personal: <b>solo puede descifrar sus propios clientes</b>; del equipo solo ve indicadores agregados (sin nombres de clientes).</p>
      <label class="form-label small">URL donde estará publicada la app</label>
      <input class="form-control mb-2" id="pubUrl" placeholder="https://intranet.binco.mx/reto/index.html" value="${esc(S.cfg.publicUrl || '')}">${!S.cfg.publicUrl && pubBase() ? `<div class="tiny text-muted mb-2">Si la dejas vacía se usa la dirección actual: <b>${esc(pubBase())}</b></div>` : ''}
      <div class="table-responsive"><table class="table table-sm small align-middle"><thead><tr><th>Asesor</th><th>PIN local (opcional)</th><th>Enlace personal</th></tr></thead><tbody>
      ${ids.map((id) => { const a = S.cfg.asesores[id]; const link = a.token && pubBase() ? `${pubBase()}#k=${a.token}` : ''; return `<tr><td>${esc(a.nombre)}</td><td><input class="form-control form-control-sm" style="max-width:110px" data-pin="${esc(id)}" value="${esc(a.pin || '')}"></td>
        <td>${link ? `<div class="input-group input-group-sm"><input class="form-control" readonly value="${esc(link)}"><button class="btn btn-soft" data-copy="${esc(link)}">Copiar</button></div>` : '<span class="text-muted">Se genera al publicar</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${enGithub() || (S.cfg.github && S.cfg.github.token) ? `<div class="border rounded-3 p-2 mb-3 small" style="background:var(--b-azul-soft)">
        <b>Publicación automática (GitHub Pages · gratis)</b> — ${publicador() === 'github' ? '<span class="ok-text">✓ activa: el botón publica directo. Los asesores ven los cambios en 1–2 minutos.</span>' : 'pega aquí tu token de GitHub para que el botón publique solo.'}
        <div class="row g-2 mt-1"><div class="col-12 col-md-6"><input type="password" class="form-control form-control-sm" id="ghToken" placeholder="Token de GitHub (github_pat_…)" value="${esc((S.cfg.github && S.cfg.github.token) || '')}" autocomplete="off"></div>
        <div class="col-8 col-md-4"><input class="form-control form-control-sm" id="ghRepo" placeholder="usuario/repositorio" value="${esc(githubDestino() ? githubDestino().owner + '/' + githubDestino().repo : '')}"></div>
        <div class="col-4 col-md-2"><button class="btn btn-sm btn-soft w-100" data-act="saveGithub">Guardar</button></div></div>
        <div class="tiny text-muted mt-1">Cómo obtenerlo: en GitHub, tu foto → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: solo este repositorio; Permissions → Contents: Read and write. Se guarda solo en este navegador y nunca se publica.</div>
      </div>` : ''}
      ${enGithub() ? '' : `<div class="border rounded-3 p-2 mb-3 small" style="background:var(--b-azul-soft)">
        <b>Publicación automática (Netlify)</b> — ${puedeAutoPublicar() ? '<span class="ok-text">✓ activa: el botón publica directo, sin descargar ni subir archivos.</span>' : 'pega aquí tu token personal de Netlify para que el botón publique solo.'}
        <div class="row g-2 mt-1"><div class="col-12 col-md-7"><input type="password" class="form-control form-control-sm" id="nlToken" placeholder="Token personal de Netlify" value="${esc((S.cfg.netlify && S.cfg.netlify.token) || '')}" autocomplete="off"></div>
        <div class="col-8 col-md-3"><input class="form-control form-control-sm" id="nlSitio" placeholder="sitio.netlify.app" value="${esc((S.cfg.netlify && S.cfg.netlify.sitio) || netlifySitio())}"></div>
        <div class="col-4 col-md-2"><button class="btn btn-sm btn-soft w-100" data-act="saveNetlify">Guardar</button></div></div>
        <div class="tiny text-muted mt-1">Cómo obtenerlo: en Netlify, tu foto (abajo a la izquierda) → User settings → Applications → Personal access tokens → New access token. El token solo se guarda en este navegador y nunca se publica.</div>
      </div>`}
      <div class="d-flex flex-wrap gap-2"><button class="btn btn-light" data-act="savePins">Guardar PINs y URL</button><button class="btn btn-binco" data-act="publicar">📤 ${puedeAutoPublicar() ? 'Publicar para el equipo' : 'Generar publicacion.json'}</button><button class="btn btn-light text-danger" data-act="rotar">Regenerar todos los enlaces</button></div>
      <div class="tiny text-muted mt-2">El PIN local solo aplica cuando el asesor entra en este mismo equipo. Para seguridad completa por usuario (inicio de sesión corporativo) ver README §12–13.</div></div>`;
  };
  CFG.api = () => {
    const a = S.cfg.api;
    return `<div class="cardx"><div class="card-title-x"><span>Conexión directa (Fase 2) — preparada, no activa</span></div>
      <div class="alert alert-info small">Hoy no tenemos confirmada una API del Funnel BINCO ni de ICARUS. La app ya separa la capa de datos (<code>ApiSource</code> en data-manager.js): cuando el proveedor entregue acceso, solo se configuran estos campos. Revisa en el README la lista de información a solicitar.</div>
      <div class="row g-2"><div class="col-12 col-md-6"><label class="form-label small">Endpoint Funnel (JSON)</label><input class="form-control" id="apiF" value="${esc(a.funnelUrl)}" placeholder="https://…/leads?desde=AAAA-MM-DD"></div>
      <div class="col-12 col-md-6"><label class="form-label small">Endpoint colocación oficial (JSON)</label><input class="form-control" id="apiI" value="${esc(a.icarusUrl)}" placeholder="https://…/colocaciones?desde=AAAA-MM-DD"></div>
      <div class="col-12 col-md-6"><label class="form-label small">Token (Bearer)</label><input type="password" class="form-control" id="apiT" value="${esc(a.token)}" autocomplete="off"></div></div>
      <div class="d-flex gap-2 mt-3"><button class="btn btn-light" data-act="saveApi">Guardar</button><button class="btn btn-binco" data-act="testApi">Probar y sincronizar</button></div>
      <div class="tiny text-muted mt-2">⚠️ No guardes tokens productivos en un navegador compartido. En producción, la conexión debe hacerse desde un servidor intermedio (ver README).</div></div>`;
  };
  CFG.cierres = () => {
    const P = S.pendingCierre;
    const prevMonth = U.monthKey(U.addDays(U.monthStart(S.today), -1));
    const resumen = (items) => {
      const by = {};
      items.forEach((it) => {
        const k = it.asesorId || 'SIN ASESOR';
        const b = by[k] = by[k] || { nombre: prettyName(it.asesorNombre || k), n: 0, total: 0, fuentes: {} };
        b.n++; b.total += it.monto; b.fuentes[it.fuente || 'Sin fuente'] = (b.fuentes[it.fuente || 'Sin fuente'] || 0) + it.monto;
      });
      const fuentes = [...new Set(items.map((i) => i.fuente || 'Sin fuente'))];
      const rows = Object.values(by);
      return `<div class="table-responsive"><table class="table table-sm small align-middle mb-1"><thead><tr><th>Asesor</th>${fuentes.map((f) => `<th class="text-end">${esc(f)}</th>`).join('')}<th class="text-end">Créditos</th><th class="text-end">Total</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="fw-bold">${esc(r.nombre)}</td>${fuentes.map((f) => `<td class="text-end num">${r.fuentes[f] ? U.money(r.fuentes[f]) : '—'}</td>`).join('')}<td class="text-end num">${r.n}</td><td class="text-end num fw-bold">${U.money(r.total)}</td></tr>`).join('')}
        <tr class="table-light"><td class="fw-bold">Total</td>${fuentes.map((f) => `<td class="text-end num">${U.money(items.filter((i) => (i.fuente || 'Sin fuente') === f).reduce((s, i) => s + i.monto, 0))}</td>`).join('')}<td class="text-end num">${items.length}</td><td class="text-end num fw-bold">${U.money(items.reduce((s, i) => s + i.monto, 0))}</td></tr></tbody></table></div>`;
    };
    const preview = P ? `<div class="cardx mt-3" style="border:1.5px solid #C8B8F1">
        <div class="card-title-x"><span>Vista previa · ${esc(P.fileName)}</span><button class="btn-close" data-act="cancelCierre" aria-label="Cancelar"></button></div>
        <div class="small mb-2">Se leyeron <b>${P.items.length} operaciones</b> de la hoja "${esc(P.sheetName)}". Revisa que coincida con tu calculadora antes de registrar.</div>
        ${resumen(P.items)}
        <div class="row g-2 mt-2">
          <div class="col-6 col-md-3"><label class="form-label small">Mes al que se atribuyen</label><input type="month" class="form-control" id="ciPeriodo" value="${esc(P.periodo || prevMonth)}"></div>
          <div class="col-6 col-md-5"><label class="form-label small">Nombre del cierre</label><input class="form-control" id="ciNombre" value="${esc(P.nombre || 'Cierre ' + U.monthName(prevMonth + '-01'))}"></div>
          ${P.metas && Object.keys(P.metas.asesores).length ? `<div class="col-12 col-md-4"><div class="form-check mt-md-4"><input class="form-check-input" type="checkbox" id="ciMetas" checked><label class="form-check-label small" for="ciMetas">Usar las metas de la calculadora para ese mes (${Object.values(P.metas.asesores).map((a) => esc(a.nombre.split(' ')[0]) + ' ' + U.moneyK(a.meta)).join(', ')}${P.metas.equipo ? ' · equipo ' + U.moneyK(P.metas.equipo) : ''})</label></div></div>` : ''}
        </div>
        <details class="mt-2 small"><summary>Ver las ${P.items.length} operaciones</summary>
          <div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Asesor</th><th>Cliente</th><th>Tipo</th><th>Fuente</th><th>Fecha</th><th class="text-end">Monto</th></tr></thead><tbody>
          ${P.items.map((i) => `<tr><td>${esc(prettyName(i.asesorNombre))}</td><td>${esc(i.cliente)}</td><td>${esc(i.tipo)}</td><td>${esc(i.fuente)}</td><td>${i.fecha ? U.fmtDateShort(i.fecha) : 'N/D'}</td><td class="text-end num">${U.money(i.monto)}</td></tr>`).join('')}</tbody></table></div></details>
        <div class="d-flex gap-2 mt-3"><button class="btn btn-binco" data-act="saveCierre">Registrar cierre</button><button class="btn btn-light" data-act="cancelCierre">Cancelar</button></div>
      </div>` : '';
    const list = (S.cfg.cierres || []).map((ci) => {
      const aj = (S.ds.ajustes || []).filter((a) => a.cierreId === ci.id);
      const cnt = (k) => aj.filter((a) => a.estado.key === k).length;
      return `<div class="cardx mt-3">
        <div class="card-title-x"><span>📌 ${esc(ci.nombre)} · atribuido a ${esc(U.monthName(ci.periodo + '-01'))}</span>
          <div class="d-flex gap-2"><div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-toggle-cierre="${esc(ci.id)}" ${ci.activo !== false ? 'checked' : ''} title="Activo"></div><button class="btn btn-sm btn-light text-danger" data-del-cierre="${esc(ci.id)}">Eliminar</button></div></div>
        <div class="tiny text-muted mb-2">Registrado ${U.fmtDateTime(ci.creado)} · archivo ${esc(ci.archivo || '—')}${ci.activo === false ? ' · <b>INACTIVO (no se aplica)</b>' : ''}</div>
        ${resumen(ci.items)}
        <div class="state-chips mb-2">
          <span class="state-chip"><b>${cnt('dispersado')}</b>ya colocados (no suman en el mes de dispersión)</span>
          <span class="state-chip"><b>${cnt('proceso')}</b>siguen en proceso</span>
          <span class="state-chip"><b>${cnt('sin')}</b>pendientes de vincular</span>
          ${cnt('perdido') ? `<span class="state-chip" style="background:var(--amber-soft)"><b>${cnt('perdido')}</b>no prosperaron · revisar</span>` : ''}
        </div>
        <details class="small"><summary>Seguimiento operación por operación</summary>
          <div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Asesor</th><th>Cliente</th><th>Fuente</th><th class="text-end">Monto (bono)</th><th>Seguimiento</th></tr></thead><tbody>
          ${aj.map((a) => `<tr><td>${esc(prettyName(a.asesorNombre))}</td><td>${esc(a.cliente)}</td><td>${esc(a.fuente)}</td><td class="text-end num">${U.money(a.monto)}</td><td class="${a.estado.key === 'perdido' ? 'warn-text' : a.estado.key === 'dispersado' ? 'ok-text' : ''}">${esc(a.estado.label)}</td></tr>`).join('')}</tbody></table></div></details>
      </div>`;
    }).join('');
    const H = S.cfg.historialColocacion;
    const histHtml = H && H.items && H.items.length ? `<div class="cardx mt-3"><div class="card-title-x"><span>Historial de colocación (Tablero comercial BINCO BI)</span><button class="btn btn-sm btn-light text-danger" data-act="borrarHistorial">Quitar historial</button></div>
      <p class="small mb-2">En estos meses la colocación es exactamente la del Tablero comercial (mes y monto), sin depender de la fecha de última gestión del Funnel. ${H.fuente ? 'Fuente: ' + esc(H.fuente) + '.' : ''}</p>
      <div class="table-responsive"><table class="table table-sm small mb-0"><thead><tr><th>Mes</th><th class="text-end">Créditos</th><th class="text-end">Monto</th></tr></thead><tbody>
      ${H.meses.map((m) => { const it = H.items.filter((x) => x.mes === m); return `<tr><td>${esc(U.monthName(m + '-01'))}</td><td class="text-end">${it.length}</td><td class="text-end num">${U.money(it.reduce((a, x) => a + x.monto, 0))}</td></tr>`; }).join('')}</tbody></table></div></div>` : '';
    const PT = S.pendingTablero;
    const porA = PT ? PT.items.reduce((o, it) => { const k = it.asesorNombre || 'Sin asesor reconocido'; o[k] = o[k] || { n: 0, m: 0 }; o[k].n++; o[k].m += it.monto; return o; }, {}) : null;
    const tableroHtml = `<div class="cardx"><div class="card-title-x"><span>Actualizar colocación desde el Tablero comercial</span><span>📋</span></div>
      <ol class="small mb-2 ps-3"><li>En BINCO BI abre <b>Tablero comercial</b> y elige el mes.</li><li>Da clic en la página, presiona <b>Ctrl + A</b> y luego <b>Ctrl + C</b>.</li><li>Pega aquí (<b>Ctrl + V</b>) y presiona <b>Leer</b>.</li></ol>
      <textarea class="form-control form-control-sm mb-2" id="tabTexto" rows="3" placeholder="Pega aquí el contenido del Tablero comercial…"></textarea>
      <div class="d-flex flex-wrap gap-2 align-items-end"><div><label class="form-label small mb-0">Mes (si no se detecta)</label><input type="month" class="form-control form-control-sm" id="tabMes" value="${esc((PT && PT.mes) || U.monthKey(S.today))}"></div><button class="btn btn-sm btn-binco" data-act="leerTablero">Leer</button></div>
      ${PT ? `<div class="mt-3 p-2 rounded-3" style="background:var(--b-azul-soft)"><div class="small"><b>${esc(U.monthName((PT.mes || '') + '-01'))}</b>: ${PT.items.length} créditos colocados · <b>${U.money(PT.items.reduce((a, x) => a + x.monto, 0))}</b></div>
        <div class="tiny mt-1">${Object.entries(porA).map(([k, v]) => `${esc(k)}: ${v.n} · ${U.money(v.m)}`).join(' &nbsp;|&nbsp; ')}</div>
        ${PT.items.some((x) => !x.asesorId) ? '<div class="warn-text tiny mt-1">⚠️ Hay créditos sin asesor reconocido; revisa los nombres en Ajustes → Metas y asesores.</div>' : ''}
        <div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-binco" data-act="guardarTablero">Guardar como colocación de ${esc(U.monthName((PT.mes || '') + '-01'))}</button><button class="btn btn-sm btn-light" data-act="cancelarTablero">Cancelar</button></div>
        <div class="tiny text-muted mt-1">Reemplaza la colocación de ese mes por exactamente esta lista (mes y monto del Tablero). Lo ya pagado en un cierre anterior no se vuelve a sumar.</div></div>` : ''}
    </div>`;
    return tableroHtml + histHtml + `<div class="cardx mt-3"><div class="card-title-x"><span>Ajuste de cierre de mes</span><span>📌</span></div>
      <p class="small mb-2">Registra aquí las operaciones que se tomaron para el bono de un mes aunque se hayan dispersado después o sigan en Mesa / Expediente. La app las <b>suma a ese mes</b> (etiquetadas como "ajuste de cierre", aparte de lo real) y las <b>excluye de los meses siguientes</b>: si se dispersan después no vuelven a sumar, y salen del pipeline, la proyección, los puntos y los retos. Todo lo demás se mide por su fecha real.</p>
      <p class="small text-muted mb-2">Acepta la calculadora de bonos (.xlsx) o cualquier lista con columnas Asesor, Cliente, Monto (opcionales: Tipo, Estatus, Fuente, Fecha, Folio, Contrato, Considerada). Si una operación nunca se dispersa, se queda en el mes del cierre y se marca "No prosperó" para seguimiento.</p>
      <label class="btn btn-binco mb-0">📂 Cargar calculadora / lista de cierre<input type="file" accept=".xlsx,.xls,.csv" hidden id="cierreFile"></label>
    </div>${preview}${list}`;
  };

  CFG.historico = () => {
    const snaps = S.raw.snapshots.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || name(a.asesorId).localeCompare(name(b.asesorId))).slice(0, 60);
    return `<div class="cardx"><div class="card-title-x"><span>Cargas realizadas</span><span>${S.raw.cargas.length}</span></div>
      <div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Fecha</th><th>Fuente</th><th>Archivo</th><th>Filas</th><th>Nuevos</th><th>Actualizados</th><th>Duplicados</th></tr></thead><tbody>
      ${S.raw.cargas.slice(0, 50).map((c) => `<tr><td>${U.fmtDateTime(c.fecha)}</td><td>${esc(c.fuente)}</td><td>${esc(c.archivo)}</td><td>${c.filas}</td><td>${c.nuevos}</td><td>${c.actualizados}</td><td>${c.duplicados}</td></tr>`).join('') || '<tr><td colspan="7" class="text-muted">Sin cargas.</td></tr>'}</tbody></table></div></div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Fotos diarias por asesor (histórico)</span><button class="btn btn-sm btn-soft" data-act="exportHist">⬇️ Exportar histórico (Excel)</button></div>
      <div class="table-responsive"><table class="table table-sm small"><thead><tr><th>Fecha</th><th>Asesor</th><th>Colocado mes</th><th>Créditos</th><th>% meta</th><th>Contactación</th><th>Mesa</th><th>Autorizados</th><th>En camino</th></tr></thead><tbody>
      ${snaps.map((s) => `<tr><td>${U.fmtDateShort(s.fecha)}</td><td>${esc(name(s.asesorId))}</td><td>${U.money(s.colocadoMes)}</td><td>${s.creditosMes}</td><td>${U.pct(s.avance, 0)}</td><td>${U.pct(s.contactacion, 0)}</td><td>${s.mesa}</td><td>${s.autorizados}</td><td>${U.moneyK(s.enCamino)}</td></tr>`).join('') || '<tr><td colspan="9" class="text-muted">Se genera una foto por día en cada carga.</td></tr>'}</tbody></table></div>
      <div class="tiny text-muted">Las tendencias por día/semana/mes también se calculan directamente de los registros históricos (nunca se borran al cargar).</div></div>
      <div class="cardx mt-3"><div class="card-title-x"><span>Respaldo</span></div>
      <div class="d-flex flex-wrap gap-2"><button class="btn btn-soft" data-act="backup">⬇️ Descargar respaldo completo (.json)</button>
      <label class="btn btn-light mb-0">⬆️ Restaurar respaldo<input type="file" accept=".json" hidden id="restoreFile"></label>
      <button class="btn btn-light text-danger" data-act="wipe">Borrar todos los datos</button></div>
      <div class="tiny text-muted mt-2">La información vive en este navegador (IndexedDB). Descarga un respaldo periódicamente.</div></div>`;
  };

  /* ------------------------------------------------------------------
   * PUBLICACIÓN CIFRADA (Fase 1 para celulares sin servidor de aplicación)
   * ---------------------------------------------------------------- */
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function aesKey(token) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('binco-reto|' + token)); return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  async function encrypt(token, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(token), new TextEncoder().encode(JSON.stringify(obj))); return { iv: b64(iv), ct: b64(new Uint8Array(ct)) }; }
  async function decrypt(token, box) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await aesKey(token), unb64(box.ct)); return JSON.parse(new TextDecoder().decode(pt)); }
  const newToken = () => b64(crypto.getRandomValues(new Uint8Array(18))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));

  /* ---- Publicación automática en Netlify (API) ----
   * Requiere un token personal de Netlify (lo captura el supervisor en Ajustes → Acceso).
   * Sube SOLO publicacion.json: conserva el resto de los archivos del sitio tal como están. */
  function netlifySitio() { return (S.cfg.netlify && S.cfg.netlify.sitio) || (/\.netlify\.app$/.test(location.hostname) ? location.hostname : ''); }
  const enGithub = () => /\.github\.io$/i.test(location.hostname);
  function githubDestino() {
    const g = S.cfg.github || {};
    let owner = g.owner, repo = g.repo;
    if ((!owner || !repo) && enGithub()) { owner = location.hostname.split('.')[0]; repo = location.pathname.split('/').filter(Boolean)[0] || (owner + '.github.io'); }
    return owner && repo ? { owner, repo, branch: g.branch || 'main' } : null;
  }
  function publicador() {
    if (enGithub()) return S.cfg.github && S.cfg.github.token && githubDestino() ? 'github' : '';
    if (S.cfg.netlify && S.cfg.netlify.token && netlifySitio()) return 'netlify';
    if (S.cfg.github && S.cfg.github.token && githubDestino()) return 'github';
    return '';
  }
  function puedeAutoPublicar() { return !!publicador(); }

  /* ---- Publicación automática en GitHub Pages (gratis, sin créditos) ----
   * Actualiza SOLO publicacion.json en el repositorio; GitHub Pages lo publica en 1–2 minutos. */
  async function githubPublicar(json) {
    const d = githubDestino();
    const api = `https://api.github.com/repos/${encodeURIComponent(d.owner)}/${encodeURIComponent(d.repo)}/contents/publicacion.json`;
    const H = { Authorization: 'Bearer ' + S.cfg.github.token, Accept: 'application/vnd.github+json' };
    let sha;
    const g = await fetch(`${api}?ref=${encodeURIComponent(d.branch)}&t=${Date.now()}`, { headers: H, cache: 'no-store' });
    if (g.status === 401) throw new Error('El token de GitHub no es válido o expiró.');
    if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error('GitHub respondió ' + g.status);
    const b64 = (() => { const u8 = new TextEncoder().encode(json); let s2 = ''; for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s2); })();
    const r = await fetch(api, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ message: 'Publicación Reto BINCO ' + new Date().toISOString(), content: b64, sha, branch: d.branch }) });
    if (r.status === 401 || r.status === 403) throw new Error('El token de GitHub no tiene permiso de escritura (Contents: Read and write) sobre ' + d.repo + '.');
    if (!r.ok) throw new Error('GitHub respondió ' + r.status);
    return true;
  }
  async function netlifyPublicar(json) {
    const api = 'https://api.netlify.com/api/v1';
    const H = { Authorization: 'Bearer ' + S.cfg.netlify.token };
    const sitio = encodeURIComponent(netlifySitio());
    const req = async (url, opt) => {
      const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({}, H, (opt && opt.headers) || {}) }));
      if (r.status === 401) throw new Error('El token de Netlify no es válido o expiró.');
      if (!r.ok) throw new Error('Netlify respondió ' + r.status);
      return r.json();
    };
    const sha1 = async (txt) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(txt)))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const actuales = await req(`${api}/sites/${sitio}/files`);
    const files = {};
    actuales.forEach((f) => { if (f.id && f.sha && f.id !== '/publicacion.json') files[f.id] = f.sha; });
    if (!files['/index.html']) throw new Error('No encontré la app en el sitio ' + netlifySitio() + '.');
    const shaPub = await sha1(json);
    files['/publicacion.json'] = shaPub;
    const dep = await req(`${api}/sites/${sitio}/deploys`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
    if ((dep.required || []).includes(shaPub)) {
      await req(`${api}/deploys/${dep.id}/files/publicacion.json`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: json });
    }
    // esperar a que el sitio publique la nueva versión
    for (let i = 0; i < 20; i++) {
      const st = await req(`${api}/deploys/${dep.id}`);
      if (st.state === 'ready') return true;
      if (st.state === 'error') throw new Error('Netlify marcó error al publicar.');
      await new Promise((r) => setTimeout(r, 1500));
    }
    return true;
  }

  /** Dirección base de los enlaces: la capturada o, si la app ya está en un servidor, la dirección actual. */
  function pubBase() {
    let u = (S.cfg.publicUrl || '').trim();
    if (u && enGithub() && /netlify\.app/i.test(u)) u = '';
    if (!u && location.protocol !== 'file:') u = location.origin + location.pathname;
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.split('#')[0];
  }
  function publicCfg() {
    const c = JSON.parse(JSON.stringify(S.cfg));
    ['adminPin', 'mappings', 'api', 'asesorAlias', 'stageMap', 'publicUrl', 'teamKey', 'cierres', 'netlify', 'github', 'cambiosSinPublicar', 'ultimaPublicacion', 'historialColocacion'].forEach((k) => delete c[k]);
    Object.values(c.asesores).forEach((a) => { delete a.pin; delete a.token; });
    return c;
  }
  async function publish() {
    if (!window.crypto || !crypto.subtle) return toast('Este navegador no permite cifrar (abre la app desde https o localhost).');
    if (!hasData()) return toast('Primero carga información.');
    if (!pubBase() && !confirm('Aún no capturas la URL donde estará publicada la app (Ajustes → Acceso y publicación). Los enlaces no funcionarán en el celular hasta que la captures y la app esté en un servidor. ¿Generar publicacion.json de todos modos?')) return;
    let changed = false;
    if (!S.cfg.teamKey) { S.cfg.teamKey = newToken(); changed = true; }
    activeIds().forEach((id) => { if (!S.cfg.asesores[id].token) { S.cfg.asesores[id].token = newToken(); changed = true; } });
    if (changed) saveCfg();
    const H = (s) => s ? U.hash('k|' + s) : s;
    const anonF = S.ds.funnel.map((f) => ({ key: H(f.key), asesorId: f.asesorId, asesorNombre: f.asesorNombre, tipo: f.tipo, recuperado: f.recuperado, etapa: f.etapa, etapaEf: f.etapaEf, etapaRaw: f.etapaRaw, monto: f.monto, fAsig: f.fAsig, fUlt: f.fUlt, fContacto: f.fContacto, contactado: f.contactado, gestiones: f.gestiones, fExp: f.fExp, fMesa: f.fMesa, fAut: f.fAut, historial: f.historial, cierrePeriodo: f.cierrePeriodo || null, cierreHasta: f.cierreHasta || null, pendienteValidar: f.pendienteValidar, contratos: f.contratos.map(H), nombre: '', proximaAccion: '' }));
    const anonC = S.ds.colocaciones.map((c) => ({ contrato: H(c.contrato), funnelKey: c.funnelKey ? H(c.funnelKey) : null, asesorId: c.asesorId, asesorNombre: c.asesorNombre, tipo: c.tipo, recuperado: c.recuperado, monto: c.monto, fecha: c.fecha, nombre: '', ajuste: !!c.ajuste, ajusteFuente: c.ajuste ? c.ajusteFuente : undefined }));
    const strip = (f) => Object.assign({}, f, { telHash: '', curpHash: '' });
    const team = { cfg: publicCfg(), meta: S.raw.meta, fuenteColocacion: S.ds.fuenteColocacion, generado: new Date().toISOString(), funnel: anonF, colocaciones: anonC, matchStats: S.ds.matchStats };
    const pub = { formato: 'binco-reto-publicacion', version: 1, generado: team.generado, equipo: await encrypt(S.cfg.teamKey, team), asesores: {} };
    for (const id of activeIds()) {
      const tok = S.cfg.asesores[id].token;
      pub.asesores[U.hash('id|' + tok)] = await encrypt(tok, {
        asesorId: id, teamKey: S.cfg.teamKey,
        funnel: S.ds.funnel.filter((f) => f.asesorId === id).map(strip),
        colocaciones: S.ds.colocaciones.filter((c) => c.asesorId === id).map(strip),
      });
    }
    const json = JSON.stringify(pub);
    if (puedeAutoPublicar()) {
      try {
        toast('Publicando para el equipo…');
        if (publicador() === 'github') await githubPublicar(json); else await netlifyPublicar(json);
        S.cfg.cambiosSinPublicar = false; S.cfg.ultimaPublicacion = new Date().toISOString(); saveCfg(true);
        toast(publicador() === 'github' ? '✓ Publicado. Los asesores lo verán en 1–2 minutos al recargar su enlace.' : '✓ Publicado. Los asesores ya ven la información actualizada (recargando su enlace).');
        render(); return;
      } catch (er) {
        console.error(er);
        alert('No se pudo publicar automáticamente: ' + er.message + '\n\nSe descargará publicacion.json para que lo subas manualmente.');
      }
    }
    dlBlob('publicacion.json', new Blob([json], { type: 'application/json' }));
    S.cfg.cambiosSinPublicar = false; S.cfg.ultimaPublicacion = new Date().toISOString(); saveCfg(true);
    toast('publicacion.json descargado. Súbelo junto a index.html para que los asesores lo vean.');
    render();
  }

  async function bootPublication(token, fromStorage) {
    bindGlobal();
    try {
      let pub = null;
      try { const r = await fetch('publicacion.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) pub = await r.json(); } catch (e) { /* sin servidor */ }
      if (!pub) throw new Error('No se encontró publicacion.json junto a la app.');
      const box = pub.asesores[U.hash('id|' + token)];
      if (!box) throw Object.assign(new Error('Este enlace todavía no está activo o ya no es válido. Si tu supervisor acaba de generar enlaces nuevos, pídele que presione "Publicar para el equipo" y vuelve a abrirlo.'), { sinLlave: true });
      const mine = await decrypt(token, box);
      const team = await decrypt(mine.teamKey, pub.equipo);
      S.cfg = D.deepMerge(G.defaultConfig(S.today), team.cfg);
      S.raw.meta = team.meta || {};
      const funnel = team.funnel.filter((f) => f.asesorId !== mine.asesorId).concat(mine.funnel);
      const coloc = team.colocaciones.filter((c) => c.asesorId !== mine.asesorId).concat(mine.colocaciones);
      const asesores = new Map(Object.keys(S.cfg.asesores).map((id) => [id, S.cfg.asesores[id].nombre]));
      S.ds = { funnel, colocaciones: coloc, asesores, matchStats: team.matchStats, fuenteColocacion: team.fuenteColocacion };
      S.publication = true;
      S.session = { role: 'asesor', asesorId: mine.asesorId };
      keySet(token); salioSet(false); // recordar el enlace en este dispositivo
      try { window.localStorage.setItem('binco_reto_nombre', (S.cfg.asesores[mine.asesorId] || {}).nombre || ''); } catch (e) { /* sin almacenamiento */ }
      if (!new URLSearchParams(location.hash.slice(1)).get('k')) history.replaceState(null, '', location.pathname + location.search + '#k=' + token);
      showApp();
    } catch (e) {
      console.error(e);
      // Solo se olvida el enlace guardado si la publicación ya no lo reconoce (enlaces regenerados).
      // Si falló la red o la publicación se está actualizando, se conserva para reintentar.
      if (fromStorage && e.sinLlave) { keySet(''); location.replace(location.pathname); return; }
      if (fromStorage) { $('#login').classList.remove('d-none'); $('#loginAsesorBox').classList.remove('d-none'); $('#loginAsesorBox').innerHTML = `<div class="alert alert-warning small">No se pudo cargar tu información en este momento (${esc(e.message)}). <button class="btn btn-sm btn-link p-0" onclick="location.reload()">Reintentar</button></div>`; $('#loginMsg').innerHTML = ''; return; } // enlace guardado ya no válido: volver al acceso normal
      S.cfg = S.cfg || G.defaultConfig(S.today);
      $('#login').classList.remove('d-none');
      $('#loginAsesorBox').classList.remove('d-none');
      $('#loginAsesorBox').innerHTML = `<div class="alert alert-warning small">${esc(e.message)}</div>`;
      $('#loginMsg').innerHTML = '';
    }
  }

  /* ------------------------------------------------------------------
   * EVENTOS
   * ---------------------------------------------------------------- */
  function bindGlobal() {
    if (bindGlobal.done) return; bindGlobal.done = true;
    $('#btnLoginAsesor').addEventListener('click', loginAsesor);
    $('#btnLoginAdmin').addEventListener('click', loginAdmin);
    $('#loginAdminPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginAdmin(); });
    $('#loginAsesorPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginAsesor(); });
    $('#loginAsesor').addEventListener('change', () => { const a = S.cfg.asesores[$('#loginAsesor').value]; $('#loginAsesorPin').classList.toggle('d-none', !(a && a.pin)); $('#loginAsesorPin').value = ''; });
    $('#btnLogout').addEventListener('click', logout);
    $('#viewAs').addEventListener('change', (e) => { S.viewAs = e.target.value; S.view = S.viewAs ? 'inicio' : 'tablero'; render(); });
    $('#periodChips').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; S.period.p = b.dataset.p; if (b.dataset.p === 'custom') { S.period.from = S.period.from || U.monthStart(S.today); S.period.to = S.period.to || S.today; $('#fFrom').value = S.period.from; $('#fTo').value = S.period.to; } render(); });
    $('#fFrom').addEventListener('change', (e) => { S.period.from = e.target.value; if (S.period.to && S.period.from > S.period.to) S.period.to = S.period.from; render(); });
    $('#fTo').addEventListener('change', (e) => { S.period.to = e.target.value; render(); });
    $('#fTipo').addEventListener('change', (e) => { S.tipo = e.target.value; render(); });
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', (e) => { if (e.target.id === 'tblSearch') { S.search = e.target.value; const pos = e.target.selectionStart; render(); const s = $('#tblSearch'); if (s) { s.focus(); s.setSelectionRange(pos, pos); } } });
  }

  async function onClick(e) {
    const t = e.target.closest('[data-del-cierre],[data-nav],[data-act],[data-sort],[data-asesor],[data-cierre],[data-cfgtab],[data-edit-reto],[data-dup-reto],[data-del-reto],[data-edit-premio],[data-del-premio],[data-viewas],[data-copy],#btnDemoLogin,#btnReentrar,#btnOlvidar');
    if (!t) return;
    if (t.id === 'btnDemoLogin') { await loadDemo(); showLogin(); return; }
    if (t.id === 'btnReentrar') { salioSet(false); location.replace(location.pathname); return; }
    if (t.id === 'btnOlvidar') { if (confirm('¿Olvidar el enlace guardado en este teléfono? Para volver a entrar tendrás que abrir de nuevo tu enlace personal.')) { keySet(''); salioSet(false); try { window.localStorage.removeItem('binco_reto_nombre'); } catch (e) { /* */ } showLogin(); } return; }
    const d = t.dataset;
    if (d.nav) { S.view = d.nav; render(); return; }
    if (d.sort) { S.sort = { key: d.sort, dir: S.sort.key === d.sort ? -S.sort.dir : (d.sort === 'nombre' ? 1 : -1) }; render(); return; }
    if (d.asesor && t.tagName === 'TR') { openAsesorDetail(d.asesor); return; }
    if (d.cierre) { S.cierresEtapa = d.cierre; render(); return; }
    if (d.cfgtab) { S.cfgTab = d.cfgtab; render(); return; }
    if (d.viewas) { closeModal(); S.viewAs = d.viewas; $('#viewAs').value = d.viewas; S.view = 'inicio'; render(); return; }
    if (d.copy) { try { await navigator.clipboard.writeText(d.copy); toast('Enlace copiado.'); } catch (er) { toast('Copia manualmente el enlace.'); } return; }
    if (d.delCierre) { if (confirm('¿Eliminar este cierre? Sus operaciones volverán a contarse por su fecha real.')) { S.cfg.cierres = S.cfg.cierres.filter((c) => c.id !== d.delCierre); saveCfg(); rebuild(); render(); } return; }
    if (d.editReto) return retoForm(JSON.parse(JSON.stringify(S.cfg.retos.find((r) => r.id === d.editReto))));
    if (d.dupReto) { const r = JSON.parse(JSON.stringify(S.cfg.retos.find((x) => x.id === d.dupReto))); r.id = 'r' + U.uid(); r.nombre += ' (copia)'; r.estado = 'borrador'; return retoForm(r); }
    if (d.delReto) { if (confirm('¿Eliminar este reto?')) { S.cfg.retos = S.cfg.retos.filter((r) => r.id !== d.delReto); saveCfg(); render(); } return; }
    if (d.editPremio) return premioForm(JSON.parse(JSON.stringify(S.cfg.premios.find((p) => p.id === d.editPremio))));
    if (d.delPremio) {
      const usos = S.cfg.retos.filter((r) => r.premioId === d.delPremio).length;
      if (confirm(usos ? `Este premio se usa en ${usos} reto(s). ¿Eliminarlo de todas formas? Los retos quedarán sin premio.` : '¿Eliminar este premio?')) {
        S.cfg.premios = S.cfg.premios.filter((p) => p.id !== d.delPremio); S.cfg.retos.forEach((r) => { if (r.premioId === d.delPremio) r.premioId = ''; }); saveCfg(); render();
      }
      return;
    }
    switch (d.act) {
      case 'pendientes': return showPendientes();
      case 'leerTablero': {
        const txt = $('#tabTexto').value;
        const r = D.parseTableroTexto(txt, S.cfg);
        if (!r.mes) r.mes = $('#tabMes').value;
        r.items.forEach((it) => { it.mes = r.mes; });
        if (!r.items.length) return toast('No encontré créditos "Colocado" en el texto. Copia toda la página del Tablero comercial (Ctrl + A, Ctrl + C).');
        S.pendingTablero = r; render(); return;
      }
      case 'cancelarTablero': S.pendingTablero = null; render(); return;
      case 'guardarTablero': {
        const PT = S.pendingTablero; if (!PT) return;
        const H = S.cfg.historialColocacion || { meses: [], items: [] };
        H.items = H.items.filter((x) => x.mes !== PT.mes).concat(PT.items);
        if (!H.meses.includes(PT.mes)) H.meses.push(PT.mes);
        H.meses.sort(); H.fuente = 'Tablero comercial BINCO BI (actualizado ' + U.fmtDate(S.today) + ')';
        S.cfg.historialColocacion = H; S.pendingTablero = null;
        saveCfg(); rebuild(); render(); toast('Colocación de ' + U.monthName(PT.mes + '-01') + ' actualizada con el Tablero comercial.'); return;
      }
      case 'borrarHistorial': if (confirm('¿Quitar el historial de colocación? Esos meses volverán a calcularse con las fechas del Funnel.')) { delete S.cfg.historialColocacion; saveCfg(); rebuild(); render(); } return;
      case 'goCierres': S.view = 'config'; S.cfgTab = 'cierres'; render(); return;
      case 'cancelCierre': S.pendingCierre = null; render(); return;
      case 'saveCierre': {
        const P = S.pendingCierre; if (!P) return;
        const periodo = $('#ciPeriodo').value; if (!periodo) return toast('Elige el mes al que se atribuyen.');
        const overlap = (S.cfg.cierres || []).filter((c) => c.activo !== false && c.items.some((i) => P.items.some((p) => p.id === i.id)));
        if (overlap.length && !confirm(`Algunas operaciones ya están en "${overlap[0].nombre}". Si continúas se desactivará ese cierre para no contarlas dos veces. ¿Continuar?`)) return;
        overlap.forEach((c) => { c.activo = false; });
        S.cfg.cierres = S.cfg.cierres || [];
        S.cfg.cierres.push({ id: 'ci' + U.uid(), periodo, nombre: $('#ciNombre').value.trim() || 'Cierre ' + U.monthName(periodo + '-01'), archivo: P.fileName, hoja: P.sheetName, creado: new Date().toISOString(), activo: true, items: P.items });
        // asesores y metas del mes
        const ensure = (id, nombre) => { if (id && !S.cfg.asesores[id] && !S.cfg.asesorAlias[id]) S.cfg.asesores[id] = { nombre: prettyName(nombre), metaBase: 0, activo: true }; };
        P.items.forEach((i) => ensure(i.asesorId, i.asesorNombre));
        if (P.metas) Object.entries(P.metas.asesores).forEach(([id, a]) => ensure(id, a.nombre));
        if (P.metas && $('#ciMetas') && $('#ciMetas').checked) {
          S.cfg.metas[periodo] = S.cfg.metas[periodo] || {};
          Object.entries(P.metas.asesores).forEach(([id, a]) => {
            const rid = S.cfg.asesorAlias[id] || id;
            S.cfg.metas[periodo][rid] = a.meta;
            if (S.cfg.asesores[rid] && !S.cfg.asesores[rid].metaBase) S.cfg.asesores[rid].metaBase = a.meta; // meta base para los meses siguientes (editable)
          });
          if (P.metas.equipo) S.cfg.metaEquipo[periodo] = P.metas.equipo;
        }
        S.pendingCierre = null; saveCfg(); rebuild(); render();
        toast('Cierre registrado: ' + P.items.length + ' operaciones atribuidas a ' + U.monthName(periodo + '-01') + '.');
        return;
      }
      case 'plantillas': return downloadTemplates();
      case 'demo': if (!S.raw.funnel.length || confirm('Se agregarán datos ficticios a la información actual. ¿Continuar?')) { await loadDemo(); render(); } return;
      case 'publicar': return publish();
      case 'cancelImport': S.pending = null; $('#mapPanel').innerHTML = ''; return;
      case 'switchSource': { const P = S.pending; P.source = P.guessed; P.mapping = D.suggestMapping(P.source, P.table.headers, S.cfg.mappings[P.source]); $('#mapPanel').innerHTML = mapPanelHtml(); return; }
      case 'doImport': return doImport();
      case 'newReto': return retoForm(null);
      case 'newPremio': return premioForm(null);
      case 'saveRetoDia':
        Object.assign(S.cfg.retoDia, { activo: $('#rdActivo').checked, texto: $('#rdTexto').value.trim(), indicador: $('#rdInd').value, meta: Number($('#rdMeta').value) || 0 });
        saveCfg(); toast('Reto de hoy guardado.'); return;
      case 'saveMetas': {
        const mk = $('#cfgMonth').value || U.monthKey(S.today);
        S.cfg.metas[mk] = S.cfg.metas[mk] || {};
        $$('[data-mm]').forEach((i) => { const v = i.value.trim(); if (v === '') delete S.cfg.metas[mk][i.dataset.mm]; else S.cfg.metas[mk][i.dataset.mm] = Math.max(0, Number(v)); });
        $$('[data-mb]').forEach((i) => { S.cfg.asesores[i.dataset.mb].metaBase = Math.max(0, Number(i.value) || 0); });
        $$('[data-aa]').forEach((i) => { S.cfg.asesores[i.dataset.aa].activo = i.checked; });
        $$('[data-an]').forEach((i) => { if (i.value.trim()) S.cfg.asesores[i.dataset.an].nombre = i.value.trim(); });
        const me = $('#metaEquipo').value.trim(); if (me) S.cfg.metaEquipo[mk] = Number(me); else delete S.cfg.metaEquipo[mk];
        S.cfg.metasCreditos = S.cfg.metasCreditos || {}; S.cfg.metaEquipoCreditos = S.cfg.metaEquipoCreditos || {};
        S.cfg.metasCreditos[mk] = S.cfg.metasCreditos[mk] || {};
        $$('[data-mcm]').forEach((i) => { const v = i.value.trim(); if (v === '') delete S.cfg.metasCreditos[mk][i.dataset.mcm]; else S.cfg.metasCreditos[mk][i.dataset.mcm] = Math.max(0, Number(v)); });
        $$('[data-mcb]').forEach((i) => { S.cfg.asesores[i.dataset.mcb].metaCreditosBase = Math.max(0, Number(i.value) || 0); });
        const mce = $('#metaEquipoCreditos').value.trim(); if (mce) S.cfg.metaEquipoCreditos[mk] = Number(mce); else delete S.cfg.metaEquipoCreditos[mk];
        let merged = 0;
        $$('[data-alias]').forEach((s) => { if (s.value) { S.cfg.asesorAlias[s.dataset.alias] = s.value; delete S.cfg.asesores[s.dataset.alias]; merged++; } });
        saveCfg(); rebuild(); render(); toast(merged ? `Metas guardadas y ${merged} asesor(es) unificados.` : 'Metas guardadas.'); return;
      }
      case 'savePuntos':
        $$('[data-pt]').forEach((i) => { S.cfg.puntos[i.dataset.pt] = Math.max(0, Number(i.value) || 0); });
        $$('[data-lg]').forEach((i) => { S.cfg.logros[i.dataset.lg] = Math.max(0, Number(i.value) || 0); });
        saveCfg(); toast('Puntos y logros guardados.'); return;
      case 'saveReglas': {
        const dias = $$('[data-dia]').filter((i) => i.checked).map((i) => Number(i.dataset.dia));
        if (!dias.length) return toast('Selecciona al menos un día hábil.');
        Object.assign(S.cfg, { factorAutorizado: Math.min(100, Math.max(0, Number($('#fAut').value))) / 100, factorMesa: Math.min(100, Math.max(0, Number($('#fMesa').value))) / 100, diasHabiles: dias, rankingCriterio: $('#rkCrit').value, reconocimientoModo: $('#recMode').value, mensajes: $('#msgs').value.split('\n').map((x) => x.trim()).filter(Boolean) });
        S.cfg.privacidad.mostrarRankingMontos = $('#rkMoney').checked;
        S.cfg.fuenteColocacion = $('#fuenteCol').value; rebuild();
        saveCfg(); toast('Reglas guardadas.'); return;
      }
      case 'savePin': { const p = $('#newPin').value; if (p.length < 6) return toast('El PIN debe tener al menos 6 caracteres.'); S.cfg.adminPin = p; saveCfg(); $('#newPin').value = ''; toast('PIN actualizado.'); return; }
      case 'savePins': $$('[data-pin]').forEach((i) => { S.cfg.asesores[i.dataset.pin].pin = i.value.trim(); }); S.cfg.publicUrl = $('#pubUrl').value.trim(); saveCfg(); render(); toast('Guardado.'); return;
      case 'rotar': if (confirm('Los enlaces actuales dejarán de funcionar y tendrás que mandar los nuevos a cada asesor. Solo hazlo si un enlace se compartió por error. ¿Continuar?')) { activeIds().forEach((id) => { S.cfg.asesores[id].token = newToken(); }); S.cfg.teamKey = newToken(); saveCfg(); render(); if (puedeAutoPublicar()) publish(); else toast('Enlaces regenerados. Ahora publica y manda los nuevos enlaces.'); } return;
      case 'saveGithub': {
        const [owner, repo] = $('#ghRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').split('/');
        S.cfg.github = { token: $('#ghToken').value.trim(), owner: owner || '', repo: (repo || '').replace(/\.git$/, ''), branch: 'main' };
        saveCfg(true); render(); toast(puedeAutoPublicar() ? 'Publicación automática con GitHub activada.' : 'Guardado.'); return;
      }
      case 'saveNetlify': S.cfg.netlify = { token: $('#nlToken').value.trim(), sitio: $('#nlSitio').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') }; saveCfg(true); render(); toast(puedeAutoPublicar() ? 'Publicación automática activada.' : 'Guardado.'); return;
      case 'saveApi': Object.assign(S.cfg.api, { funnelUrl: $('#apiF').value.trim(), icarusUrl: $('#apiI').value.trim(), token: $('#apiT').value }); saveCfg(); toast('Configuración API guardada.'); return;
      case 'testApi': {
        const src = new D.ApiSource(S.cfg.api, S.cfg);
        if (!src.isConfigured()) return toast('Captura al menos un endpoint.');
        try {
          const r = await src.loadAll();
          const id = U.uid();
          if (r.funnel.length) { S.raw.funnel = D.mergeFunnel(S.raw.funnel, r.funnel, id, S.today).records; S.raw.meta.funnel = new Date().toISOString(); }
          if (r.icarus.length) { S.raw.icarus = D.mergeIcarus(S.raw.icarus, r.icarus, id).records; S.raw.meta.icarus = new Date().toISOString(); }
          rebuild(); takeSnapshot(); await saveRaw(); render(); toast(`API: ${r.funnel.length} Funnel / ${r.icarus.length} colocaciones sincronizadas.`);
        } catch (er) { toast('No fue posible conectar: ' + er.message); }
        return;
      }
      case 'exportHist': {
        if (!window.XLSX) return;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(S.raw.snapshots.map((s) => Object.assign({ asesor: name(s.asesorId) }, s))), 'Fotos diarias');
        const months = [...new Set(S.ds.colocaciones.map((c) => U.monthKey(c.fecha)))].sort();
        const rows = [];
        months.forEach((mk) => activeIds().forEach((id) => { const m = compute([id], { from: mk + '-01', to: U.monthEnd(mk + '-01') }, 'Todos'); rows.push({ mes: mk, asesor: name(id), meta: m.meta, colocado: m.monto, creditos: m.creditos, avance: m.avance == null ? null : U.round2(m.avance), contactacion: m.contactacion.pct == null ? null : U.round2(m.contactacion.pct) }); }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Mensual por asesor');
        XLSX.writeFile(wb, `binco_historico_${S.today}.xlsx`);
        return;
      }
      case 'backup': dlBlob(`binco_respaldo_${S.today}.json`, new Blob([JSON.stringify({ formato: 'binco-reto-respaldo', version: 1, cfg: S.cfg, raw: S.raw })], { type: 'application/json' })); return;
      case 'wipe': if (confirm('Esto borra TODA la información cargada y el histórico de este navegador. ¿Continuar?') && confirm('¿Seguro? Esta acción no se puede deshacer.')) { await S.store.clear(); S.raw = { funnel: [], icarus: [], cargas: [], snapshots: [], meta: {} }; rebuild(); render(); toast('Datos borrados.'); } return;
      default:
    }
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.map && S.pending) { S.pending.mapping[t.dataset.map] = t.value || undefined; if (!t.value) delete S.pending.mapping[t.dataset.map]; $('#mapPanel').innerHTML = mapPanelHtml(); return; }
    if (t.dataset.stage && S.pending) { if (t.value) S.pending.stageOverrides[t.dataset.stage] = t.value; $('#mapPanel').innerHTML = mapPanelHtml(); return; }
    if (t.id === 'cfgMonth') { S.cfgMonth = t.value; render(); return; }
    if (t.dataset.toggleCierre) { const c = S.cfg.cierres.find((x) => x.id === t.dataset.toggleCierre); if (c) { c.activo = t.checked; saveCfg(); rebuild(); render(); } return; }
    if (t.id === 'cierreFile' && t.files[0]) {
      const file = t.files[0];
      file.arrayBuffer().then((buf) => {
        const wb = XLSX.read(buf, { type: 'array', cellDates: false });
        const r = D.parseCierreWorkbook(wb, S.cfg);
        if (!r.tabla) return toast('No encontré una tabla con columnas Asesor, Cliente y Monto en el archivo.');
        S.pendingCierre = { fileName: file.name, sheetName: r.tabla.sheetName, items: r.tabla.items, metas: r.metas };
        render();
      }).catch((er) => toast('No se pudo leer el archivo: ' + er.message));
      return;
    }
    if (t.id === 'restoreFile' && t.files[0]) {
      t.files[0].text().then(async (txt) => {
        try {
          const b = JSON.parse(txt); if (b.formato !== 'binco-reto-respaldo') throw new Error('Archivo no reconocido');
          S.cfg = D.deepMerge(G.defaultConfig(S.today), b.cfg); S.raw = Object.assign({ funnel: [], icarus: [], cargas: [], snapshots: [], meta: {} }, b.raw);
          saveCfg(); await saveRaw(); rebuild(); render(); toast('Respaldo restaurado.');
        } catch (er) { toast('No se pudo restaurar: ' + er.message); }
      });
    }
  }

  /* ------------------------------------------------------------------
   * UTILIDADES UI
   * ---------------------------------------------------------------- */
  let modalObj = null;
  function openModal(title, body, footer, onShown) {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = body;
    const f = $('#modalFooter'); f.innerHTML = footer || ''; f.classList.toggle('d-none', !footer);
    modalObj = modalObj || new bootstrap.Modal($('#modal'));
    const el = $('#modal');
    const h = () => { el.removeEventListener('shown.bs.modal', h); if (onShown) onShown(); };
    el.addEventListener('shown.bs.modal', h);
    modalObj.show();
  }
  function closeModal() { if (modalObj) modalObj.hide(); }
  let toastObj = null;
  function toast(msg) {
    $('#toastBody').textContent = msg;
    if (window.bootstrap) { toastObj = toastObj || new bootstrap.Toast($('#toast'), { delay: 3500 }); toastObj.show(); } else alert(msg);
  }

  /* ------------------------------------------------------------------
   * APP INSTALABLE (PWA): solo aplica cuando se sirve por https/localhost
   * ---------------------------------------------------------------- */
  let installEvt = null;
  if (location.protocol !== 'file:' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker no registrado', e)); });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); installEvt = e;
    const b = $('#btnInstall'); if (b) b.classList.remove('d-none');
  });
  window.addEventListener('appinstalled', () => { installEvt = null; const b = $('#btnInstall'); if (b) b.classList.add('d-none'); toast('App instalada. Ábrela desde tu escritorio o pantalla de inicio.'); });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#btnInstall') || !installEvt) return;
    installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btnInstall').classList.add('d-none');
  });

  document.addEventListener('DOMContentLoaded', () => { boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('afterbegin', `<div class="alert alert-danger m-3">Error al iniciar: ${esc(e.message)}</div>`); }); });
  window.BincoApp = { S, render, loadDemo, showApp, rebuild };
})();
