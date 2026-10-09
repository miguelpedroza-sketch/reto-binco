/* =====================================================================
 * BINCO | Reto Comercial — gamification.js
 * ---------------------------------------------------------------------
 * Retos, premios, puntos BINCO, logros, ranking y reconocimiento semanal.
 * IMPORTANTE: los puntos son SOLO gamificación; no sustituyen KPIs oficiales.
 * Todo es configurable desde la vista de administrador (sin tocar código).
 * ===================================================================== */
(function (root) {
  'use strict';
  const D = root.BincoData;
  const U = D.U;

  /* ---------------------------------------------------------------
   * CONFIGURACIÓN POR DEFECTO (editable desde la app)
   * ------------------------------------------------------------- */
  function defaultConfig(today) {
    today = today || U.today();
    const ws = U.weekStart(today);
    return {
      version: 1,
      adminPin: 'binco2026',
      mensajes: [
        'Cada gestión cuenta. Vamos por la meta.',
        'Lo que hoy siembras, mañana se coloca.',
        'Un cliente bien atendido es una renovación segura.',
        'Paso a paso se llega lejos. ¡Tú puedes!',
        'Tu esfuerzo se ve. Sigamos sumando.',
      ],
      diasHabiles: [1, 2, 3, 4, 5],         // 0=Dom ... 6=Sáb
      factorAutorizado: 1,                  // % del monto autorizado/por dispersar que entra en proyección
      factorMesa: 1,                        // % del monto en Mesa que entra en proyección
      rankingCriterio: 'monto',             // monto | avance | puntos
      reconocimientoModo: 'viernes',        // viernes | siempre | nunca
      privacidad: { mostrarRankingMontos: true },
      asesores: {},                         // id → {nombre, metaBase, activo, pin}
      asesorAlias: {},                      // id duplicado → id principal
      metas: {},                            // 'YYYY-MM' → {asesorId: meta}
      metaEquipo: {},                       // 'YYYY-MM' → meta fija del equipo (vacío = suma de metas individuales)
      stageMap: {},                         // texto de estatus normalizado → etapa canónica
      cierres: [],                          // ajustes de cierre de mes (operaciones atribuidas a un mes para bono)
      mappings: { funnel: {}, icarus: {} }, // encabezado normalizado → campo canónico
      api: { funnelUrl: '', icarusUrl: '', token: '', activo: false },
      puntos: { contacto: 1, expediente: 5, mesa: 8, autorizado: 15, colocado: 30, metaSemanal: 50 },
      logros: { rachaDias: 5, contactacionMin: 80, minTrabajados: 10, hito1: 250000, hito2: 500000 },
      premios: [
        { id: 'p1', emoji: '🏠', nombre: 'Home Office', descripcion: 'Un día de home office (viernes).', activo: true },
        { id: 'p2', emoji: '⏰', nombre: 'Salida anticipada', descripcion: 'Salida 2 horas antes.', activo: true },
        { id: 'p3', emoji: '🍽️', nombre: 'Comida pagada', descripcion: 'Comida para ti y un acompañante.', activo: true },
        { id: 'p4', emoji: '🎁', nombre: 'Tarjeta de regalo', descripcion: 'Tarjeta de regalo de $500.', activo: true },
        { id: 'p5', emoji: '⛽', nombre: 'Vale de gasolina', descripcion: 'Vale de gasolina de $500.', activo: true },
        { id: 'p6', emoji: '⭐', nombre: 'Reconocimiento BINCO', descripcion: 'Reconocimiento público en junta mensual.', activo: true },
        { id: 'p7', emoji: '🏆', nombre: 'Premio especial mensual', descripcion: 'Premio sorpresa para quien cumpla la meta mensual.', activo: true },
      ],
      retos: [
        { id: 'r1', nombre: 'Reto Contactación', descripcion: 'Logra 50 contactos efectivos esta semana.', inicio: ws, fin: U.addDays(ws, 4), indicador: 'contactos', meta: 50, premioId: 'p1', participantes: 'todos', modo: 'individual', tipo: 'Todos', estado: 'activo' },
        { id: 'r2', nombre: 'Mesa en movimiento', descripcion: 'Envía 6 expedientes completos a Mesa.', inicio: ws, fin: U.addDays(ws, 4), indicador: 'mesa', meta: 6, premioId: 'p2', participantes: 'todos', modo: 'individual', tipo: 'Todos', estado: 'activo' },
        { id: 'r3', nombre: 'Juntos al millón', descripcion: 'Colocación grupal de la semana: si llegamos, comida para todo el equipo.', inicio: ws, fin: U.addDays(ws, 4), indicador: 'colocacion_grupal', meta: 1000000, premioId: 'p3', participantes: 'todos', modo: 'grupal', tipo: 'Todos', estado: 'activo' },
      ],
      retoDia: { activo: true, texto: 'Logra 8 contactos efectivos antes de las 2 PM.', indicador: 'contactos', meta: 8 },
    };
  }

  /* ---------------------------------------------------------------
   * INDICADORES DISPONIBLES PARA RETOS
   * ------------------------------------------------------------- */
  const INDICADORES = {
    contactos: { label: 'Número de contactos efectivos', unidad: 'contactos', fmt: 'int', get: (m) => m.eventos.contactos },
    pct_contactacion: { label: '% Contactación', unidad: '%', fmt: 'pct', get: (m) => m.contactacion.pct || 0 },
    expedientes: { label: 'Expedientes integrados', unidad: 'expedientes', fmt: 'int', get: (m) => m.eventos.expedientes },
    mesa: { label: 'Expedientes enviados a Mesa', unidad: 'envíos a Mesa', fmt: 'int', get: (m) => m.eventos.mesa },
    autorizados: { label: 'Autorizados', unidad: 'autorizados', fmt: 'int', get: (m) => m.eventos.autorizados },
    creditos: { label: 'Créditos colocados', unidad: 'créditos', fmt: 'int', get: (m) => m.creditos },
    monto: { label: 'Monto colocado', unidad: 'MXN', fmt: 'money', get: (m) => m.monto },
    renovaciones: { label: 'Renovaciones colocadas', unidad: 'renovaciones', fmt: 'int', get: (m) => m.porTipo['Renovación'].n },
    recuperados: { label: 'Clientes recuperados', unidad: 'clientes', fmt: 'int', get: (m) => m.recuperados },
    conversion: { label: 'Conversión (colocados / leads trabajados)', unidad: '%', fmt: 'pct', get: (m) => m.conversion || 0 },
    colocacion_grupal: { label: 'Colocación grupal (monto del equipo)', unidad: 'MXN', fmt: 'money', grupal: true, get: (m) => m.monto },
  };
  function fmtInd(ind, v) {
    const f = (INDICADORES[ind] || {}).fmt;
    if (f === 'money') return U.money(v);
    if (f === 'pct') return U.pct(v);
    return U.int(v);
  }

  /* ---------------------------------------------------------------
   * RETOS
   * ------------------------------------------------------------- */
  function isParticipant(reto, asesorId) {
    return reto.participantes === 'todos' || (Array.isArray(reto.participantes) && reto.participantes.includes(asesorId));
  }
  function participantIds(reto, cfg) {
    const activos = Object.keys(cfg.asesores).filter((id) => cfg.asesores[id].activo !== false);
    return reto.participantes === 'todos' ? activos : activos.filter((id) => reto.participantes.includes(id));
  }
  function retoStatus(reto, today) {
    if (reto.estado !== 'activo') return reto.estado; // borrador | pausado
    if (today < reto.inicio) return 'proximo';
    if (today > reto.fin) return 'concluido';
    return 'en_curso';
  }
  /** Evalúa un reto para un asesor (individual) o para el grupo (grupal). */
  function evalReto(ds, cfg, reto, asesorId, today) {
    const ind = INDICADORES[reto.indicador];
    if (!ind) return null;
    const grupal = reto.modo === 'grupal' || ind.grupal;
    const ids = grupal ? participantIds(reto, cfg) : [asesorId];
    const m = D.compute(ds, { cfg, range: { from: reto.inicio, to: reto.fin }, asesorIds: ids, tipo: reto.tipo || 'Todos', today });
    const valor = ind.get(m);
    const meta = Number(reto.meta) || 0;
    const progreso = meta ? (valor / meta) * 100 : 0;
    const premio = (cfg.premios || []).find((p) => p.id === reto.premioId) || null;
    const status = retoStatus(reto, today);
    return {
      reto, valor, meta, progreso, cumplido: meta > 0 && valor >= meta, grupal, premio, status,
      faltante: Math.max(0, meta - valor), valorFmt: fmtInd(reto.indicador, valor), metaFmt: fmtInd(reto.indicador, meta), faltanteFmt: fmtInd(reto.indicador, Math.max(0, meta - valor)),
    };
  }
  /** Retos visibles para un asesor (activos y que se cruzan con el periodo/hoy). */
  function retosAsesor(ds, cfg, asesorId, today, opts) {
    opts = opts || {};
    return (cfg.retos || [])
      .filter((r) => r.estado === 'activo' && isParticipant(r, asesorId))
      .filter((r) => opts.incluirConcluidos ? true : r.fin >= U.addDays(today, -7))
      .map((r) => evalReto(ds, cfg, r, asesorId, today))
      .filter(Boolean)
      .sort((a, b) => ({ en_curso: 0, proximo: 1, concluido: 2 }[a.status] - { en_curso: 0, proximo: 1, concluido: 2 }[b.status]) || (b.progreso - a.progreso));
  }

  /** Reto del día. */
  function evalRetoDia(ds, cfg, asesorId, today) {
    const rd = cfg.retoDia;
    if (!rd || !rd.activo) return null;
    const ind = INDICADORES[rd.indicador];
    if (!ind) return { texto: rd.texto, valor: null };
    const m = D.compute(ds, { cfg, range: { from: today, to: today }, asesorIds: [asesorId], today });
    const valor = ind.get(m);
    return { texto: rd.texto, valor, meta: Number(rd.meta) || 0, progreso: rd.meta ? valor / rd.meta * 100 : 0, cumplido: rd.meta && valor >= rd.meta, valorFmt: fmtInd(rd.indicador, valor), metaFmt: fmtInd(rd.indicador, rd.meta) };
  }

  /* ---------------------------------------------------------------
   * PUNTOS BINCO
   * ------------------------------------------------------------- */
  function weeklyGoalHits(ds, cfg, asesorId, range, today) {
    const hits = [];
    let ws = U.weekStart(range.from);
    while (ws <= range.to) {
      const we = U.addDays(ws, 6);
      const wr = { from: ws < range.from ? range.from : ws, to: we > range.to ? range.to : we };
      if (wr.from <= today) {
        const meta = D.metaRange(cfg, [asesorId], { from: ws, to: we });
        const monto = ds.colocaciones.filter((c) => c.asesorId === asesorId && U.inRange(c.fecha, { from: ws, to: we })).reduce((s, c) => s + c.monto, 0);
        if (meta > 0 && monto >= meta) hits.push({ from: ws, to: we, monto, meta });
      }
      ws = U.addDays(ws, 7);
    }
    return hits;
  }
  function points(ds, cfg, asesorId, range, today, m) {
    const p = cfg.puntos;
    m = m || D.compute(ds, { cfg, range, asesorIds: [asesorId], today });
    const e = m.eventos;
    const hits = weeklyGoalHits(ds, cfg, asesorId, range, today);
    const detalle = [
      { concepto: 'Contactos efectivos', n: e.contactos, pts: p.contacto },
      { concepto: 'Expedientes completos', n: e.expedientes, pts: p.expediente },
      { concepto: 'Envíos a Mesa', n: e.mesa, pts: p.mesa },
      { concepto: 'Autorizados', n: e.autorizados, pts: p.autorizado },
      { concepto: 'Créditos colocados', n: e.colocados, pts: p.colocado },
      { concepto: 'Metas semanales cumplidas', n: hits.length, pts: p.metaSemanal },
    ].map((d) => Object.assign(d, { total: d.n * (Number(d.pts) || 0) }));
    return { total: detalle.reduce((s, d) => s + d.total, 0), detalle };
  }

  /* ---------------------------------------------------------------
   * LOGROS (automáticos)
   * ------------------------------------------------------------- */
  function streak(ds, cfg, asesorId, today) {
    const days = D.activityDays(ds, asesorId);
    let d = today, n = 0, guard = 0;
    // si hoy aún no hay actividad, la racha cuenta hasta el último día hábil
    const isBD = (s) => cfg.diasHabiles.includes(U.fromYmd(s).getDay());
    if (!days.has(d)) d = U.addDays(d, -1);
    while (guard++ < 120) {
      if (!isBD(d)) { d = U.addDays(d, -1); continue; }
      if (days.has(d)) { n++; d = U.addDays(d, -1); } else break;
    }
    return n;
  }

  function achievements(ds, cfg, asesorId, today, teamRows) {
    const L = cfg.logros;
    const month = { from: U.monthStart(today), to: U.monthEnd(today) };
    const week = { from: U.weekStart(today), to: U.weekEnd(today) };
    const mm = D.compute(ds, { cfg, range: month, asesorIds: [asesorId], today });
    const wm = D.compute(ds, { cfg, range: week, asesorIds: [asesorId], today });
    const racha = streak(ds, cfg, asesorId, today);
    // primer crédito de la semana (equipo)
    const wc = ds.colocaciones.filter((c) => U.inRange(c.fecha, week) && c.asesorId !== 'SIN ASESOR').sort((a, b) => a.fecha.localeCompare(b.fecha));
    const primero = wc.length ? wc.filter((c) => c.fecha === wc[0].fecha).map((c) => c.asesorId) : [];
    // mejor conversión del equipo (mes)
    let mejorConv = null;
    (teamRows || []).forEach((r) => { if (r.m.contactacion.trabajados >= L.minTrabajados && r.m.conversion != null && (!mejorConv || r.m.conversion > mejorConv.v)) mejorConv = { id: r.id, v: r.m.conversion }; });
    const pctC = mm.contactacion.pct;
    const list = [
      { id: 'racha', emoji: '🔥', nombre: 'Racha Comercial', desc: `${L.rachaDias} días hábiles consecutivos con gestión`, ok: racha >= L.rachaDias, prog: Math.min(100, racha / L.rachaDias * 100), detalle: `${racha} día(s) seguidos` },
      { id: 'contact', emoji: '🎯', nombre: `Contactación ${L.contactacionMin}%+`, desc: `Contactación del mes ≥ ${L.contactacionMin}% (mín. ${L.minTrabajados} leads trabajados)`, ok: pctC != null && pctC >= L.contactacionMin && mm.contactacion.trabajados >= L.minTrabajados, prog: pctC == null ? 0 : Math.min(100, pctC / L.contactacionMin * 100), detalle: U.pct(pctC) },
      { id: 'semana', emoji: '🏆', nombre: 'Meta Semanal Cumplida', desc: 'Colocación de la semana ≥ meta semanal', ok: wm.meta > 0 && wm.monto >= wm.meta, prog: wm.meta ? Math.min(100, wm.monto / wm.meta * 100) : 0, detalle: `${U.moneyK(wm.monto)} de ${U.moneyK(wm.meta)}` },
      { id: 'primero', emoji: '🚀', nombre: 'Primer Crédito de la Semana', desc: 'Primer crédito colocado del equipo en la semana', ok: primero.includes(asesorId), prog: primero.includes(asesorId) ? 100 : 0, detalle: primero.length ? (primero.includes(asesorId) ? '¡Fuiste de los primeros!' : 'Ya lo ganó otro compañero') : 'Aún disponible esta semana' },
      { id: 'h1', emoji: '💰', nombre: `${U.moneyK(L.hito1)} Colocados`, desc: `Colocación del mes ≥ ${U.money(L.hito1)}`, ok: mm.monto >= L.hito1, prog: Math.min(100, mm.monto / L.hito1 * 100), detalle: U.moneyK(mm.monto) },
      { id: 'h2', emoji: '💰', nombre: `${U.moneyK(L.hito2)} Colocados`, desc: `Colocación del mes ≥ ${U.money(L.hito2)}`, ok: mm.monto >= L.hito2, prog: Math.min(100, mm.monto / L.hito2 * 100), detalle: U.moneyK(mm.monto) },
      { id: 'mensual', emoji: '👑', nombre: 'Meta Mensual Cumplida', desc: 'Colocación del mes ≥ meta mensual', ok: mm.meta > 0 && mm.monto >= mm.meta, prog: mm.meta ? Math.min(100, mm.monto / mm.meta * 100) : 0, detalle: U.pct(mm.avance, 0) },
      { id: 'conv', emoji: '🤝', nombre: 'Mejor Conversión', desc: 'Mayor conversión del equipo en el mes', ok: !!mejorConv && mejorConv.id === asesorId, prog: mejorConv && mm.conversion != null ? Math.min(100, mm.conversion / mejorConv.v * 100) : 0, detalle: U.pct(mm.conversion) },
    ];
    return { list, racha, ganados: list.filter((x) => x.ok).length };
  }

  /* ---------------------------------------------------------------
   * RANKING POSITIVO
   * ------------------------------------------------------------- */
  function teamRows(ds, cfg, range, today, tipo) {
    return Object.keys(cfg.asesores).filter((id) => cfg.asesores[id].activo !== false).map((id) => {
      const m = D.compute(ds, { cfg, range, asesorIds: [id], today, tipo });
      const pts = points(ds, cfg, id, range, today, m);
      return { id, nombre: cfg.asesores[id].nombre || id, m, puntos: pts.total };
    });
  }
  function ranking(rows, criterio) {
    const val = (r) => criterio === 'avance' ? (r.m.avance || 0) : criterio === 'puntos' ? r.puntos : r.m.monto;
    const sorted = rows.slice().sort((a, b) => val(b) - val(a) || b.m.creditos - a.m.creditos);
    let pos = 0, last = null;
    return sorted.map((r, i) => {
      const v = val(r);
      if (v !== last) { pos = i + 1; last = v; }
      const above = sorted.slice(0, i).reverse().find((x) => val(x) > v);
      const gap = above ? val(above) - v : 0;
      let siguiente = null;
      if (above) {
        siguiente = criterio === 'avance' ? `Te faltan ${gap.toFixed(1)} puntos de avance para subir una posición.`
          : criterio === 'puntos' ? `Te faltan ${U.int(Math.max(1, Math.ceil(gap)))} puntos BINCO para subir una posición.`
            : `Te faltan ${U.money(Math.max(1, Math.ceil(gap)))} para subir una posición.`;
      } else siguiente = '¡Vas al frente! Mantén el ritmo.';
      return Object.assign({}, r, { pos, valor: v, gap, siguiente });
    });
  }

  /* ---------------------------------------------------------------
   * RECONOCIMIENTO SEMANAL (viernes)
   * ------------------------------------------------------------- */
  function weeklyRecognition(ds, cfg, today) {
    const ws = U.weekStart(today);
    const week = { from: ws, to: U.addDays(ws, 6) };
    const prev = { from: U.addDays(ws, -7), to: U.addDays(ws, -1) };
    const rows = Object.keys(cfg.asesores).filter((id) => cfg.asesores[id].activo !== false).map((id) => ({
      id, nombre: cfg.asesores[id].nombre || id,
      w: D.compute(ds, { cfg, range: week, asesorIds: [id], today }),
      p: D.compute(ds, { cfg, range: prev, asesorIds: [id], today }),
    }));
    const best = (fn, ok) => {
      const c = rows.filter((r) => (ok ? ok(r) : true) && fn(r) != null && fn(r) > 0).sort((a, b) => fn(b) - fn(a));
      if (!c.length) return null;
      const top = fn(c[0]);
      return { ganadores: c.filter((r) => fn(r) === top).map((r) => r.nombre), valor: top };
    };
    const minT = 5;
    return {
      week,
      categorias: [
        { emoji: '🏆', titulo: 'Mayor Colocación', r: best((r) => r.w.monto), fmt: (v) => U.money(v) },
        { emoji: '📞', titulo: 'Mayor Contactación', r: best((r) => r.w.contactacion.pct, (r) => r.w.contactacion.trabajados >= minT), fmt: (v) => U.pct(v) },
        { emoji: '🎯', titulo: 'Mejor Conversión', r: best((r) => r.w.conversion, (r) => r.w.contactacion.trabajados >= minT), fmt: (v) => U.pct(v) },
        { emoji: '📁', titulo: 'Más Expedientes', r: best((r) => r.w.eventos.expedientes), fmt: (v) => U.int(v) + ' expedientes' },
        { emoji: '🚀', titulo: 'Mayor Crecimiento Semanal', r: best((r) => r.w.monto - r.p.monto), fmt: (v) => '+' + U.money(v) + ' vs semana anterior' },
      ],
    };
  }
  function showRecognition(cfg, today) {
    if (cfg.reconocimientoModo === 'siempre') return true;
    if (cfg.reconocimientoModo === 'nunca') return false;
    const dow = U.fromYmd(today).getDay();
    return dow === 5 || dow === 6 || dow === 0; // viernes y fin de semana
  }

  root.BincoGame = {
    defaultConfig, INDICADORES, fmtInd, isParticipant, participantIds, retoStatus, evalReto, retosAsesor, evalRetoDia,
    points, weeklyGoalHits, streak, achievements, teamRows, ranking, weeklyRecognition, showRecognition,
  };
})(typeof window !== 'undefined' ? window : globalThis);
