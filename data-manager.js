/* =====================================================================
 * BINCO | Reto Comercial — data-manager.js
 * ---------------------------------------------------------------------
 * CAPA DE DATOS INDEPENDIENTE.
 * Ninguna regla de negocio depende de Excel: los archivos (y en el futuro
 * las APIs) se convierten a un MODELO CANÓNICO y todo el tablero trabaja
 * sobre ese modelo.
 *
 *   Fuente (Excel/CSV | API Funnel | API ICARUS | BD central)
 *        → Mapper (columnas → campos canónicos)
 *        → Normalizer (fechas, montos, etapas, tipos, hashes)
 *        → Store (IndexedDB, histórico con upsert, nunca reemplaza)
 *        → Matcher (cruce Funnel ↔ ICARUS)
 *        → Metrics (KPIs oficiales)
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
   * 1. UTILIDADES
   * ------------------------------------------------------------- */
  const U = {};

  U.norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

  U.normName = (s) => U.norm(s).toUpperCase();

  U.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  U.pad = (n) => (n < 10 ? '0' : '') + n;
  U.ymd = (d) => d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate());
  U.fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  U.addDays = (s, n) => { const d = U.fromYmd(s); d.setDate(d.getDate() + n); return U.ymd(d); };
  U.today = () => U.ymd(new Date());
  U.monthKey = (s) => s.slice(0, 7);
  U.monthStart = (s) => s.slice(0, 8) + '01';
  U.monthEnd = (s) => { const d = U.fromYmd(U.monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return U.ymd(d); };
  U.weekStart = (s) => { const d = U.fromYmd(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return U.ymd(d); }; // lunes
  U.weekEnd = (s) => U.addDays(U.weekStart(s), 6);
  U.inRange = (s, r) => !!s && s >= r.from && s <= r.to;
  U.daysBetween = (a, b) => { const out = []; let c = a; while (c <= b) { out.push(c); c = U.addDays(c, 1); } return out; };

  /** Días hábiles (por defecto lunes a viernes; configurable). */
  U.businessDays = (from, to, habiles) => {
    const set = habiles || [1, 2, 3, 4, 5];
    return U.daysBetween(from, to).filter((s) => set.includes(U.fromYmd(s).getDay()));
  };

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  U.fmtDate = (s) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${+d} ${MESES[+m - 1]} ${y}`; };
  U.fmtDateShort = (s) => { if (!s) return '—'; const [, m, d] = s.split('-'); return `${+d} ${MESES[+m - 1]}`; };
  U.monthName = (s) => { const [y, m] = s.split('-'); return `${MESES_L[+m - 1]} ${y}`; };
  U.fmtDateTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${U.pad(d.getDate())}/${U.pad(d.getMonth() + 1)}/${d.getFullYear()} ${U.pad(h)}:${U.pad(d.getMinutes())} ${ap}`;
  };

  const MXN = (typeof Intl !== 'undefined') ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }) : null;
  U.money = (n) => (MXN ? MXN.format(Math.round(n || 0)) : '$' + Math.round(n || 0));
  U.moneyK = (n) => {
    n = n || 0;
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  };
  U.pct = (n, dec) => (n == null || !isFinite(n) ? '—' : n.toFixed(dec == null ? 1 : dec) + '%');
  U.int = (n) => (n == null ? '—' : Math.round(n).toLocaleString('es-MX'));
  U.safeDiv = (a, b) => (b ? a / b : null);
  U.round2 = (n) => Math.round(n * 100) / 100;

  /** Hash FNV-1a 64 bits (2×32). Para cruzar CURP / teléfono sin guardarlos en claro. */
  U.hash = (s) => {
    if (!s) return '';
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 16777619);
      h2 ^= c; h2 = Math.imul(h2, 0x5bd1e995); h2 ^= h2 >>> 13;
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  };

  /** Fecha flexible → 'YYYY-MM-DD'. Soporta serial Excel, Date, dd/mm/aaaa (formato MX), aaaa-mm-dd, con hora. */
  U.parseDate = (v) => {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return U.ymd(v);
    if (typeof v === 'number' && isFinite(v)) {
      if (v > 20000 && v < 80000) { // serial Excel (1954-2119)
        const days = Math.floor(v + 1 / 1440); // tolerancia de 1 minuto (seriales tipo 46295.9996)
        const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
        return U.ymd(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      }
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      let d = +m[1], mo = +m[2];
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // venía mm/dd
      return valid(y, mo, d);
    }
    m = U.norm(s).match(/^(\d{1,2}) (?:de )?([a-z]{3})[a-z]* (?:de )?(\d{4})/);
    if (m) { const mo = MESES.indexOf(m[2]) + 1; if (mo) return valid(+m[3], mo, +m[1]); }
    if (/^\d{5}(\.\d+)?$/.test(s)) return U.parseDate(Number(s));
    return null;
    function valid(y, mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
      const dt = new Date(y, mo - 1, d);
      return dt.getMonth() === mo - 1 ? U.ymd(dt) : null;
    }
  };

  /** Monto flexible: "$1,234.50", "1 234,50", 1234.5 → número. */
  U.parseMoney = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).replace(/[^\d,.\-]/g, '');
    if (!s) return 0;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > ld && s.length - lc - 1 <= 2) s = s.replace(/\./g, '').replace(',', '.'); // decimal con coma
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  };

  U.parseBool = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    const s = U.norm(v);
    if (!s) return null;
    if (/^(no|n|0|false|falso|sin contacto|no contactado|no contesta|ilocalizable|buzon|no efectivo|negativo)/.test(s)) return false;
    if (/^(si|s|1|true|verdadero|x|contactado|efectivo|positivo|ok)/.test(s)) return true;
    return null;
  };

  U.phone = (v) => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
  U.curp = (v) => { const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length === 18 ? s : ''; };
  U.idStr = (v) => { const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ''); return s && !['0', 'NA', 'N/A', 'N/D', 'ND', 'S/N', 'SN', '-'].includes(s) ? s.replace(/\.0+$/, '') : ''; };

  /** Nombre abreviado para no exponer datos completos: "María Guadalupe López" → "María G. L." */
  U.shortName = (s) => {
    const p = String(s || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return 'Cliente';
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    return [cap(p[0])].concat(p.slice(1, 3).map((w) => w.charAt(0).toUpperCase() + '.')).join(' ');
  };
  /** Llave de nombre independiente del orden: "SOSA SOSA JOSE ALFREDO" = "José Alfredo Sosa Sosa" */
  U.nameKey = (s) => U.normName(s).split(' ').filter(Boolean).sort().join(' ');
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------------------------------------------------------------
   * 2. CATÁLOGOS: ETAPAS Y TIPOS
   * ------------------------------------------------------------- */
  const STAGES = [
    { key: 'lead', label: 'Lead', plural: 'Leads', idx: 0 },
    { key: 'contactado', label: 'Contactado', plural: 'Contactados', idx: 1 },
    { key: 'interes', label: 'Interés', plural: 'Con interés', idx: 2 },
    { key: 'expediente', label: 'Expediente', plural: 'Expedientes', idx: 3 },
    { key: 'mesa', label: 'Mesa', plural: 'En Mesa', idx: 4 },
    { key: 'autorizado', label: 'Autorizado', plural: 'Autorizados', idx: 5 },
    { key: 'por_dispersar', label: 'Por dispersar', plural: 'Por dispersar', idx: 6 },
    { key: 'colocado', label: 'Colocado', plural: 'Colocados', idx: 7 },
    { key: 'perdido', label: 'No continuó', plural: 'No continuaron', idx: -1 },
  ];
  const STAGE_IDX = Object.fromEntries(STAGES.map((s) => [s.key, s.idx]));
  const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

  /** Reglas de detección de etapa (orden importa). Valores no reconocidos se pueden mapear manualmente. */
  const STAGE_RULES = [
    ['perdido', ['rechaz', 'declin', 'cancel', 'perdid', 'no interes', 'no califica', 'descart', 'baja', 'desist', 'no aplica', 'cerrado perdido']],
    ['lead', ['no contact', 'sin contact', 'no contesta', 'buzon', 'por contactar', 'ilocaliz', 'no localiz', 'numero equivocado']],
    ['colocado', ['colocad', 'dispersad', 'desembolsad', 'fondead', 'cerrado ganado', 'ganado', 'vigente', 'activo']],
    ['por_dispersar', ['por dispers', 'pendiente de dispers', 'pendiente dispers', 'en dispers', 'dispersion', 'firma', 'firmad', 'por fondear', 'formaliz']],
    ['autorizado', ['autoriz', 'aprobad', 'aceptad', 'preautoriz']],
    ['mesa', ['mesa', 'analisis', 'revision', 'evaluacion', 'comite', 'dictamen', 'validacion', 'credito en proceso', 'buro']],
    ['expediente', ['expediente', 'document', 'integracion', 'captura', 'solicitud', 'papeleria']],
    ['interes', ['interes', 'interesad']],
    ['contactado', ['contactad', 'contacto efectivo', 'cita', 'seguimiento', 'negociac', 'perfilad', 'cotiz', 'propuesta']],
    ['lead', ['nuevo', 'lead', 'asignad', 'pendiente', 'prospecto', 'sin gestion', 'base']],
  ];

  function detectStage(raw, stageMap) {
    const n = U.norm(raw);
    if (!n) return { stage: 'lead', known: false };
    if (stageMap && stageMap[n]) return { stage: stageMap[n], known: true };
    for (const [stage, keys] of STAGE_RULES) if (keys.some((k) => n.includes(k))) return { stage, known: true };
    return { stage: 'lead', known: false };
  }

  const TIPOS = ['Nuevo', 'Renovación', 'Nómina', 'Otros'];
  function detectTipo(raw) {
    const n = U.norm(raw);
    if (!n) return { tipo: 'Otros', recuperado: false };
    const recuperado = /recuper|reactiv|reingres|winback/.test(n);
    if (/nomin|payroll|descuento via|convenio/.test(n)) return { tipo: 'Nómina', recuperado };
    if (/renov|recompra|refin|ampliac|recuper|reactiv|reingres|subsecuente|segundo|recurrente/.test(n)) return { tipo: 'Renovación', recuperado };
    if (/nuev|primer|originac|nueva|new/.test(n)) return { tipo: 'Nuevo', recuperado };
    return { tipo: 'Otros', recuperado };
  }

  /* ---------------------------------------------------------------
   * 3. DEFINICIÓN DE CAMPOS CANÓNICOS + SINÓNIMOS (auto-reconocimiento)
   * ------------------------------------------------------------- */
  const FIELDS = {
    funnel: [
      { key: 'asesor', label: 'Asesor', req: true, syn: ['asesor', 'nombre asesor', 'ejecutivo', 'ejecutivo comercial', 'promotor', 'vendedor', 'agente', 'usuario asignado', 'asignado a', 'responsable', 'gestor', 'owner', 'propietario', 'colaborador'] },
      { key: 'etapa', label: 'Etapa / Estatus', req: true, syn: ['etapa', 'estatus', 'status', 'estado', 'fase', 'etapa funnel', 'situacion', 'estatus lead', 'estatus solicitud'] },
      { key: 'nombreCliente', label: 'Nombre del cliente', syn: ['cliente', 'nombre cliente', 'nombre del cliente', 'nombre', 'prospecto', 'nombre completo', 'nombre prospecto', 'acreditado', 'solicitante'] },
      { key: 'clienteId', label: 'ID Cliente', syn: ['id cliente', 'cliente id', 'no cliente', 'numero cliente', 'num cliente', 'id del cliente', 'codigo cliente', 'clave cliente', 'numero de cliente'] },
      { key: 'contrato', label: 'Número de contrato', syn: ['contrato', 'no contrato', 'numero contrato', 'num contrato', 'folio contrato', 'numero de contrato', 'no credito', 'numero de credito', 'id credito'] },
      { key: 'leadId', label: 'Folio / ID Lead', syn: ['id lead', 'lead id', 'folio', 'id', 'id oportunidad', 'id prospecto', 'folio solicitud', 'folio lead', 'no solicitud'] },
      { key: 'telefono', label: 'Teléfono', syn: ['telefono', 'celular', 'tel', 'movil', 'whatsapp', 'numero telefonico', 'telefono celular', 'telefono cliente'] },
      { key: 'curp', label: 'CURP', syn: ['curp'] },
      { key: 'tipo', label: 'Tipo de crédito', syn: ['tipo', 'tipo credito', 'tipo de credito', 'producto', 'tipo operacion', 'tipo de operacion', 'linea', 'segmento', 'tipo cliente', 'tipo de cliente'] },
      { key: 'monto', label: 'Monto solicitado / potencial', syn: ['monto', 'monto solicitado', 'importe', 'monto credito', 'monto potencial', 'monto autorizado', 'cantidad solicitada', 'monto propuesto', 'monto del credito'] },
      { key: 'fechaAsignacion', label: 'Fecha de asignación', syn: ['fecha asignacion', 'fecha alta', 'fecha creacion', 'fecha registro', 'fecha lead', 'fecha de asignacion', 'creado', 'fecha ingreso', 'fecha de alta', 'fecha de creacion', 'fecha'] },
      { key: 'fechaUltimaGestion', label: 'Fecha última gestión', syn: ['ultima gestion', 'fecha ultima gestion', 'ult gestion', 'ult actividad', 'fecha ult gestion', 'ultimo movimiento', 'fecha gestion', 'fecha actualizacion', 'ultima actividad', 'fecha modificacion', 'modificado', 'fecha ultimo contacto', 'fecha de ultima gestion', 'ultima actualizacion'] },
      { key: 'fechaContacto', label: 'Fecha de contacto', syn: ['fecha contacto', 'fecha primer contacto', 'fecha de contacto', 'fecha contacto efectivo'] },
      { key: 'contactado', label: 'Contactado (Sí/No)', syn: ['contactado', 'contacto efectivo', 'contactable', 'resultado contacto', 'contacto', 'resultado llamada'] },
      { key: 'gestiones', label: 'Número de gestiones', syn: ['gestiones', 'numero gestiones', 'no gestiones', 'intentos', 'llamadas', 'actividades', 'numero de gestiones', 'total gestiones'] },
      { key: 'fechaExpediente', label: 'Fecha expediente', syn: ['fecha expediente', 'fecha documentacion', 'fecha de expediente'] },
      { key: 'fechaMesa', label: 'Fecha envío a Mesa', syn: ['fecha mesa', 'fecha envio mesa', 'fecha mesa control', 'fecha envio a mesa', 'fecha mesa de control'] },
      { key: 'fechaColocacion', label: 'Fecha de colocación / dispersión', syn: ['fecha colocacion', 'fecha de colocacion', 'fecha dispersion', 'fecha de dispersion', 'fecha desembolso', 'fecha colocado', 'fecha de credito'] },
      { key: 'fechaAutorizacion', label: 'Fecha autorización', syn: ['fecha autorizacion', 'fecha aprobacion', 'fecha autorizado', 'fecha de autorizacion'] },
      { key: 'proximaAccion', label: 'Próxima acción', syn: ['proxima accion', 'siguiente paso', 'siguiente accion', 'tarea', 'proximo paso', 'accion siguiente'] },
      { key: 'recuperado', label: 'Cliente recuperado', syn: ['recuperado', 'cliente recuperado', 'reactivado'] },
    ],
    icarus: [
      { key: 'contrato', label: 'Número de contrato', req: true, syn: ['contrato', 'no contrato', 'numero contrato', 'num contrato', 'folio contrato', 'numero de contrato', 'no credito', 'numero de credito', 'credito', 'id credito', 'no prestamo', 'prestamo'] },
      { key: 'fechaColocacion', label: 'Fecha de colocación', req: true, syn: ['fecha colocacion', 'fecha dispersion', 'fecha desembolso', 'fecha disposicion', 'fecha otorgamiento', 'fecha inicio', 'fecha contrato', 'fecha apertura', 'fecha de colocacion', 'fecha de dispersion', 'fecha alta', 'fecha'] },
      { key: 'monto', label: 'Monto colocado', req: true, syn: ['monto', 'monto colocado', 'monto otorgado', 'monto dispersado', 'capital', 'monto credito', 'importe', 'monto financiado', 'monto prestado', 'capital otorgado', 'monto del credito'] },
      { key: 'asesor', label: 'Asesor', syn: ['asesor', 'nombre asesor', 'ejecutivo', 'ejecutivo comercial', 'promotor', 'vendedor', 'agente', 'gestor', 'colaborador', 'originador'] },
      { key: 'clienteId', label: 'ID Cliente', syn: ['id cliente', 'cliente id', 'no cliente', 'numero cliente', 'num cliente', 'codigo cliente', 'clave cliente', 'numero de cliente'] },
      { key: 'nombreCliente', label: 'Nombre del cliente', syn: ['cliente', 'nombre cliente', 'nombre del cliente', 'nombre', 'acreditado', 'nombre completo', 'nombre acreditado'] },
      { key: 'telefono', label: 'Teléfono', syn: ['telefono', 'celular', 'tel', 'movil', 'telefono celular'] },
      { key: 'curp', label: 'CURP', syn: ['curp'] },
      { key: 'tipo', label: 'Tipo de crédito', syn: ['tipo', 'tipo credito', 'tipo de credito', 'producto', 'tipo operacion', 'tipo de operacion', 'linea', 'segmento', 'tipo cliente'] },
      { key: 'estatus', label: 'Estatus del crédito', syn: ['estatus', 'status', 'estado', 'situacion', 'estatus credito'] },
      { key: 'sucursal', label: 'Sucursal', syn: ['sucursal', 'oficina', 'plaza', 'region'] },
      { key: 'recuperado', label: 'Cliente recuperado', syn: ['recuperado', 'cliente recuperado', 'reactivado'] },
    ],
  };

  /** Busca la fila de encabezados (primera con ≥3 celdas de texto) */
  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i] || [];
      const txt = r.filter((c) => typeof c === 'string' && c.trim() && isNaN(Number(c)));
      if (txt.length >= 3) return i;
    }
    return 0;
  }

  /** Sugiere mapeo columnas→campos. Primero mapeos guardados, luego coincidencia exacta, luego parcial. */
  function suggestMapping(source, headers, savedMappings) {
    const fields = FIELDS[source];
    const nh = headers.map((h) => U.norm(h));
    const mapping = {};
    const used = new Set();
    const saved = savedMappings || {};
    // a) mapeo guardado por el usuario (encabezado normalizado → campo)
    nh.forEach((h, i) => { const f = saved[h]; if (f && !mapping[f] && fields.some((x) => x.key === f)) { mapping[f] = headers[i]; used.add(i); } });
    // b) exacto
    fields.forEach((f) => {
      if (mapping[f.key]) return;
      const i = nh.findIndex((h, j) => !used.has(j) && (h === U.norm(f.label) || f.syn.includes(h)));
      if (i >= 0) { mapping[f.key] = headers[i]; used.add(i); }
    });
    // c) parcial (el encabezado contiene el sinónimo más largo). Se excluyen sinónimos genéricos de 1 palabra corta.
    const cands = [];
    fields.forEach((f) => {
      if (mapping[f.key]) return;
      nh.forEach((h, i) => {
        if (used.has(i)) return;
        f.syn.forEach((s) => {
          if (s.length < 4 || s === 'fecha' || s === 'nombre') return;
          if ((' ' + h + ' ').includes(' ' + s + ' ')) cands.push({ f: f.key, i, score: s.length });
        });
      });
    });
    cands.sort((a, b) => b.score - a.score).forEach((c) => {
      if (mapping[c.f] || used.has(c.i)) return;
      // evitar que "fecha X" se mapee a un campo no fecha y viceversa
      const isDateField = /^fecha/.test(c.f);
      if (isDateField !== /fecha|^f /.test(nh[c.i])) return;
      mapping[c.f] = headers[c.i]; used.add(c.i);
    });
    return mapping;
  }

  /** Valida que el mapeo tenga lo mínimo indispensable */
  function validateMapping(source, mapping) {
    const errors = [];
    FIELDS[source].filter((f) => f.req).forEach((f) => { if (!mapping[f.key]) errors.push(`Falta relacionar la columna obligatoria "${f.label}".`); });
    if (source === 'funnel') {
      if (!mapping.nombreCliente && !mapping.clienteId && !mapping.telefono && !mapping.leadId && !mapping.contrato) errors.push('Relaciona al menos un identificador del cliente (Nombre, ID Cliente, Teléfono, Folio o Contrato).');
      if (!mapping.fechaAsignacion && !mapping.fechaUltimaGestion) errors.push('Relaciona al menos una fecha (Fecha de asignación o Fecha última gestión).');
    }
    return errors;
  }

  /* ---------------------------------------------------------------
   * 4. NORMALIZACIÓN A MODELO CANÓNICO
   * ------------------------------------------------------------- */
  function pick(raw, mapping, key) { const col = mapping[key]; return col == null ? undefined : raw[col]; }

  function normalizeFunnel(raw, mapping, cfg) {
    const g = (k) => pick(raw, mapping, k);
    const etapaRaw = String(g('etapa') == null ? '' : g('etapa')).trim();
    const st = detectStage(etapaRaw, cfg.stageMap);
    const tp = detectTipo(g('tipo'));
    const nombre = String(g('nombreCliente') || '').trim();
    const asesorNombre = String(g('asesor') || '').trim();
    const recFlag = U.parseBool(g('recuperado'));
    const rec = {
      leadId: U.idStr(g('leadId')),
      clienteId: U.idStr(g('clienteId')),
      contrato: U.idStr(g('contrato')),
      telHash: U.hash(U.phone(g('telefono'))),
      curpHash: U.hash(U.curp(g('curp'))),
      nombre,
      nombreNorm: U.normName(nombre),
      asesorNombre: asesorNombre || 'Sin asesor',
      asesorId: resolveAsesor(asesorNombre, cfg),
      tipo: tp.tipo,
      recuperado: recFlag != null ? recFlag : tp.recuperado,
      etapaRaw,
      etapa: st.stage,
      etapaReconocida: st.known,
      monto: U.parseMoney(g('monto')),
      fAsig: U.parseDate(g('fechaAsignacion')),
      fUlt: U.parseDate(g('fechaUltimaGestion')),
      fContacto: U.parseDate(g('fechaContacto')),
      contactado: U.parseBool(g('contactado')),
      gestiones: g('gestiones') == null || g('gestiones') === '' ? null : U.parseMoney(g('gestiones')),
      fExp: U.parseDate(g('fechaExpediente')),
      fMesa: U.parseDate(g('fechaMesa')),
      fAut: U.parseDate(g('fechaAutorizacion')),
      fColoc: U.parseDate(g('fechaColocacion')),
      fColocReporte: U.parseDate(g('fechaColocacion')), // fecha de colocación del Funnel (se captura al autorizar)
      proximaAccion: String(g('proximaAccion') || '').trim().slice(0, 140),
    };
    if (!rec.fAsig) rec.fAsig = rec.fUlt || rec.fContacto;
    rec.key = funnelKey(rec);
    return rec;
  }

  function funnelKey(r) {
    if (r.leadId) return 'L:' + r.leadId;
    if (r.clienteId) return 'C:' + r.clienteId + '|' + r.asesorId;
    if (r.contrato) return 'K:' + r.contrato;
    if (r.telHash) return 'T:' + r.telHash + '|' + r.asesorId;
    if (r.curpHash) return 'P:' + r.curpHash;
    return 'N:' + r.nombreNorm + '|' + r.asesorId;
  }

  function normalizeIcarus(raw, mapping, cfg) {
    const g = (k) => pick(raw, mapping, k);
    const tp = detectTipo(g('tipo'));
    const asesorNombre = String(g('asesor') || '').trim();
    const estatus = U.norm(g('estatus'));
    const recFlag = U.parseBool(g('recuperado'));
    const nombre = String(g('nombreCliente') || '').trim();
    return {
      contrato: U.idStr(g('contrato')),
      clienteId: U.idStr(g('clienteId')),
      telHash: U.hash(U.phone(g('telefono'))),
      curpHash: U.hash(U.curp(g('curp'))),
      nombre,
      nombreNorm: U.normName(nombre),
      asesorNombre: asesorNombre || '',
      asesorId: asesorNombre ? resolveAsesor(asesorNombre, cfg) : '',
      tipo: tp.tipo,
      tipoRaw: String(g('tipo') || ''),
      recuperado: recFlag != null ? recFlag : tp.recuperado,
      monto: U.parseMoney(g('monto')),
      fecha: U.parseDate(g('fechaColocacion')),
      cancelado: /cancel|anulad|revert|reversad|baja/.test(estatus),
      sucursal: String(g('sucursal') || '').trim(),
    };
  }

  function resolveAsesor(nombre, cfg) {
    const id = U.normName(nombre) || 'SIN ASESOR';
    const alias = (cfg && cfg.asesorAlias) || {};
    return alias[id] || id;
  }

  /* ---------------------------------------------------------------
   * 5. IMPORTACIÓN: validación, deduplicación y upsert (histórico)
   * ------------------------------------------------------------- */
  /** Analiza filas crudas antes de importar (no escribe nada). */
  function analyze(source, rows, mapping, cfg) {
    const out = { source, total: rows.length, validos: 0, invalidos: 0, duplicados: 0, fechasInvalidas: 0, montosCero: 0, periodo: null, etapasNoReconocidas: {}, etapasDetectadas: {}, records: [], issues: [] };
    const seen = new Map();
    let minD = null, maxD = null;
    rows.forEach((raw, i) => {
      const empty = Object.values(raw).every((v) => v == null || String(v).trim() === '');
      if (empty) return;
      if (source === 'funnel') {
        const r = normalizeFunnel(raw, mapping, cfg);
        if (!r.fAsig) { out.fechasInvalidas++; }
        if (!r.nombreNorm && !r.clienteId && !r.telHash && !r.leadId && !r.contrato) { out.invalidos++; out.issues.push(`Fila ${i + 2}: sin identificador de cliente.`); return; }
        out.etapasDetectadas[r.etapaRaw || '(vacío)'] = r.etapa;
        if (!r.etapaReconocida && r.etapaRaw) out.etapasNoReconocidas[U.norm(r.etapaRaw)] = r.etapaRaw;
        if (seen.has(r.key)) {
          out.duplicados++;
          const prev = seen.get(r.key);
          // conservar el registro más avanzado / más reciente
          if (moreRecent(r, prev)) { seen.set(r.key, r); }
          return;
        }
        seen.set(r.key, r);
        const d = r.fUlt || r.fAsig; if (d) { minD = !minD || d < minD ? d : minD; maxD = !maxD || d > maxD ? d : maxD; }
      } else {
        const r = normalizeIcarus(raw, mapping, cfg);
        if (!r.contrato) { out.invalidos++; out.issues.push(`Fila ${i + 2}: sin número de contrato.`); return; }
        if (!r.fecha) { out.fechasInvalidas++; out.invalidos++; out.issues.push(`Fila ${i + 2}: fecha de colocación inválida (contrato ${r.contrato}).`); return; }
        if (!r.monto) out.montosCero++;
        if (seen.has(r.contrato)) {
          out.duplicados++;
          const prev = seen.get(r.contrato);
          if (prev.monto !== r.monto) out.issues.push(`Contrato ${r.contrato} repetido con montos distintos (${U.money(prev.monto)} vs ${U.money(r.monto)}). Se conserva el primero.`);
          return;
        }
        seen.set(r.contrato, r);
        minD = !minD || r.fecha < minD ? r.fecha : minD; maxD = !maxD || r.fecha > maxD ? r.fecha : maxD;
      }
    });
    out.records = Array.from(seen.values());
    out.validos = out.records.length;
    out.periodo = minD ? { from: minD, to: maxD } : null;
    if (out.fechasInvalidas && source === 'funnel') out.issues.unshift(`${out.fechasInvalidas} registros sin fecha válida (no aparecerán en filtros por periodo).`);
    if (out.montosCero) out.issues.push(`${out.montosCero} colocaciones con monto en cero.`);
    return out;
  }

  function moreRecent(a, b) {
    const ia = STAGE_IDX[a.etapa], ib = STAGE_IDX[b.etapa];
    const da = a.fUlt || a.fAsig || '', db = b.fUlt || b.fAsig || '';
    if (da !== db) return da > db;
    return ia > ib;
  }

  /** Upsert del Funnel: actualiza registros existentes y conserva historial de etapas. */
  function mergeFunnel(existing, incoming, cargaId, fechaCorte) {
    const map = new Map(existing.map((r) => [r.key, r]));
    let nuevos = 0, actualizados = 0;
    incoming.forEach((r) => {
      const prev = map.get(r.key);
      const stamp = r.fUlt || fechaCorte;
      if (!prev) {
        r.historial = [{ etapa: r.etapa, fecha: stamp }];
        if (r.etapa === 'colocado' && !r.fColoc) r.fColoc = r.fUlt || fechaCorte; // se congela: no se moverá si después cambia la última gestión
        r.cargaId = cargaId; r.primeraCarga = cargaId;
        map.set(r.key, r); nuevos++;
      } else {
        const hist = (prev.historial || []).slice();
        // la fecha de colocación se fija la primera vez que el registro aparece como colocado
        if (r.etapa === 'colocado' && !r.fColoc) r.fColoc = prev.etapa === 'colocado' ? (prev.fColoc || prev.fUlt || null) : (r.fUlt || fechaCorte);
        if (prev.etapa !== r.etapa) hist.push({ etapa: r.etapa, fecha: stamp });
        const merged = Object.assign({}, prev, r, {
          historial: hist,
          cargaId,
          primeraCarga: prev.primeraCarga,
          fAsig: prev.fAsig || r.fAsig,
          fContacto: r.fContacto || prev.fContacto,
          fExp: r.fExp || prev.fExp, fMesa: r.fMesa || prev.fMesa, fAut: r.fAut || prev.fAut, fColoc: r.fColoc || prev.fColoc || null, fColocReporte: r.fColocReporte || prev.fColocReporte || null,
          monto: r.monto || prev.monto,
        });
        map.set(r.key, merged); actualizados++;
      }
    });
    return { records: Array.from(map.values()), nuevos, actualizados };
  }

  /** Upsert de ICARUS por número de contrato (ICARUS = fuente oficial de colocación). */
  function mergeIcarus(existing, incoming, cargaId) {
    const map = new Map(existing.map((r) => [r.contrato, r]));
    let nuevos = 0, actualizados = 0;
    incoming.forEach((r) => {
      if (map.has(r.contrato)) actualizados++; else nuevos++;
      map.set(r.contrato, Object.assign({}, map.get(r.contrato) || {}, r, { cargaId }));
    });
    return { records: Array.from(map.values()), nuevos, actualizados };
  }

  /* ---------------------------------------------------------------
   * 6. CRUCE FUNNEL ↔ ICARUS
   * Prioridad: 1) ID Cliente 2) Contrato 3) Teléfono 4) CURP 5) Nombre normalizado (+ mismo asesor)
   * ------------------------------------------------------------- */
  function match(funnel, icarus) {
    const idx = { clienteId: new Map(), contrato: new Map(), telHash: new Map(), curpHash: new Map(), nombreNorm: new Map() };
    funnel.forEach((f) => {
      Object.keys(idx).forEach((k) => {
        let v = f[k]; if (!v) return;
        if (k === 'nombreNorm') v = U.nameKey(v);
        if (!idx[k].has(v)) idx[k].set(v, []);
        idx[k].get(v).push(f);
      });
    });
    const links = new Map();       // contrato → {funnelKey, via}
    const fLinks = new Map();      // funnelKey → [contratos]
    const stats = { clienteId: 0, contrato: 0, telHash: 0, curpHash: 0, nombreNorm: 0, sinCruce: 0 };
    const order = ['clienteId', 'contrato', 'telHash', 'curpHash', 'nombreNorm'];

    icarus.forEach((c) => {
      let found = null, via = null;
      for (const k of order) {
        let v = c[k]; if (!v) continue;
        if (k === 'nombreNorm') v = U.nameKey(v);
        let cands = idx[k].get(v) || [];
        if (k === 'nombreNorm' && c.asesorId) cands = cands.filter((f) => f.asesorId === c.asesorId);
        if (k === 'nombreNorm' && cands.length > 1) continue; // ambiguo: no adivinar
        if (cands.length) {
          // preferir el no vinculado, más avanzado y cercano a la fecha de colocación
          cands = cands.slice().sort((a, b) => (fLinks.has(a.key) - fLinks.has(b.key)) || (STAGE_IDX[b.etapa] - STAGE_IDX[a.etapa]) || String(b.fUlt || '').localeCompare(String(a.fUlt || '')));
          found = cands[0]; via = k; break;
        }
      }
      if (found) {
        links.set(c.contrato, { funnelKey: found.key, via });
        if (!fLinks.has(found.key)) fLinks.set(found.key, []);
        fLinks.get(found.key).push(c.contrato);
        stats[via]++;
      } else stats.sinCruce++;
    });
    return { links, fLinks, stats };
  }

  /* ---------------------------------------------------------------
   * 7. DATASET: une fuentes, aplica cruce y deja todo listo para métricas
   * ------------------------------------------------------------- */
  function buildDataset(funnelRaw, icarusRaw, cfg) {
    const alias = cfg.asesorAlias || {};
    const reAlias = (id) => alias[id] || id;
    const funnel = funnelRaw.map((r) => Object.assign({}, r, { asesorId: reAlias(r.asesorId), etapa: cfg.stageMap && cfg.stageMap[U.norm(r.etapaRaw)] ? cfg.stageMap[U.norm(r.etapaRaw)] : r.etapa }));
    const icarus = icarusRaw.map((r) => Object.assign({}, r, { asesorId: r.asesorId ? reAlias(r.asesorId) : '' }));
    const m = match(funnel, icarus);
    const fByKey = new Map(funnel.map((f) => [f.key, f]));

    // ICARUS: completar asesor/tipo desde el Funnel si ICARUS no lo trae
    let colocaciones = icarus.filter((c) => !c.cancelado).map((c) => {
      const l = m.links.get(c.contrato);
      const f = l ? fByKey.get(l.funnelKey) : null;
      const out = Object.assign({}, c, { funnelKey: l ? l.funnelKey : null, matchVia: l ? l.via : null });
      if (!out.asesorId && f) { out.asesorId = f.asesorId; out.asesorNombre = f.asesorNombre; out.asesorDesdeFunnel = true; }
      if (!out.asesorId) { out.asesorId = 'SIN ASESOR'; out.asesorNombre = 'Sin asesor'; }
      if ((out.tipo === 'Otros' || !out.tipoRaw) && f && f.tipo !== 'Otros') out.tipo = f.tipo;
      if (!out.nombre && f) out.nombre = f.nombre;
      return out;
    });

    // Funnel: etapa efectiva. ICARUS confirma "colocado". Si el Funnel dice colocado y ICARUS no → pendiente de validar.
    const funnelEff = funnel.map((f) => {
      const confirmados = m.fLinks.get(f.key) || [];
      let etapaEf = f.etapa, pendienteValidar = false;
      if (confirmados.length) etapaEf = 'colocado';
      else if (f.etapa === 'colocado') { etapaEf = 'por_dispersar'; pendienteValidar = true; }
      return Object.assign({}, f, { etapaEf, pendienteValidar, contratos: confirmados });
    });

    // Fuente de colocación: 'oficial' (reporte ICARUS/sistema nuevo), 'funnel' (créditos "Colocado" del Funnel)
    // o 'auto' (usa el Funnel mientras no haya reporte oficial cargado; si hay reporte oficial, manda el oficial).
    // BINCO dejó de usar ICARUS: la fuente fija es el Funnel, salvo que se elija explícitamente "oficial".
    const usarFunnel = cfg.fuenteColocacion !== 'oficial';
    if (usarFunnel) {
      // Igual que el Tablero comercial: un crédito con FECHA DE COLOCACIÓN en el Funnel cuenta como colocado
      // en esa fecha aunque su estatus todavía diga "Autorizado" o "Por dispersar".
      funnelEff.forEach((f) => {
        if (!f.contratos.length && f.fColocReporte && ['autorizado', 'por_dispersar', 'colocado'].includes(f.etapa)) { f.pendienteValidar = true; f.etapaEf = 'por_dispersar'; }
      });
      // Historial de colocación de meses cerrados (p. ej. tomado del Tablero comercial BINCO BI):
      // en esos meses la colocación es EXACTAMENTE la lista del historial (mes y monto), sin depender
      // de la fecha de última gestión del Funnel.
      const hist = cfg.historialColocacion;
      const cubiertos = new Set((hist && hist.meses) || []);
      const usadosHist = new Set();
      if (hist && hist.items && hist.items.length) {
        const porNombre = new Map();
        funnelEff.forEach((f) => { const k = U.nameKey(f.nombreNorm) + '|' + f.asesorId; if (!porNombre.has(k)) porNombre.set(k, []); porNombre.get(k).push(f); });
        hist.items.forEach((it, i) => {
          const aId = reAlias(it.asesorId);
          const cands = (porNombre.get(it.nameKey + '|' + aId) || []).filter((f) => !usadosHist.has(f.key))
            .sort((a, b) => (b.etapa === 'colocado') - (a.etapa === 'colocado'));
          const f = cands[0] || null;
          const mEnd = U.monthEnd(it.mes + '-01');
          const enMes = (d) => d && d.slice(0, 7) === it.mes;
          const fecha = f && enMes(f.fColocReporte) ? f.fColocReporte : (f && enMes(f.fColoc) ? f.fColoc : (f && enMes(f.fUlt) ? f.fUlt : mEnd));
          const contrato = (f && f.contrato) || ('BI-' + U.hash(it.nameKey + it.mes + i).slice(0, 12));
          colocaciones.push({
            contrato, fecha, monto: Number(it.monto) || 0, asesorId: aId, asesorNombre: f ? f.asesorNombre : it.asesorNombre,
            tipo: f ? f.tipo : (it.tipo || 'Otros'), recuperado: f ? f.recuperado : false, nombre: f ? f.nombre : it.cliente,
            nombreNorm: U.normName(it.cliente), clienteId: f ? f.clienteId : '', funnelKey: f ? f.key : null,
            matchVia: 'historial', fuenteHistorial: true,
          });
          if (f) { usadosHist.add(f.key); f.etapaEf = 'colocado'; f.pendienteValidar = false; f.contratos = [contrato]; }
        });
      }
      // en meses cubiertos solo cuenta el historial (se descartan otras fuentes de ese mes)
      if (cubiertos.size) colocaciones = colocaciones.filter((c) => c.fuenteHistorial || !c.fecha || !cubiertos.has(c.fecha.slice(0, 7)));
      funnelEff.forEach((f) => {
        if (!f.pendienteValidar) return;
        const fechaF = f.fColocReporte || f.fColoc || f.fUlt || f.fAut || f.fAsig;
        // En meses cubiertos por el historial solo cuenta lo que está en el historial
        if (fechaF && cubiertos.has(fechaF.slice(0, 7))) { f.etapaEf = 'colocado'; f.pendienteValidar = false; f.contratos = []; f.fueraDeHistorial = true; return; }
        const contrato = f.contrato || ('FN-' + U.hash(f.key).slice(0, 12));
        colocaciones.push({
          contrato, fecha: fechaF, monto: f.monto || 0, asesorId: f.asesorId, asesorNombre: f.asesorNombre,
          tipo: f.tipo, recuperado: f.recuperado, nombre: f.nombre, nombreNorm: f.nombreNorm, clienteId: f.clienteId,
          funnelKey: f.key, matchVia: 'funnel', fuenteFunnel: true, fechaEstimada: !(f.fColocReporte || f.fColoc),
        });
        f.etapaEf = 'colocado'; f.pendienteValidar = false; f.contratos = [contrato];
      });
    }

    // Ajustes de cierre de mes (ej. operaciones tomadas para el bono de septiembre)
    const aj = applyCierres(cfg, reAlias, funnelEff, colocaciones);
    colocaciones = aj.colocaciones;

    // catálogo de asesores detectados
    const asesores = new Map();
    const addA = (id, nombre) => { if (!id || id === 'SIN ASESOR') return; if (!asesores.has(id)) asesores.set(id, nombre || id); };
    funnelEff.forEach((f) => addA(f.asesorId, f.asesorNombre));
    colocaciones.forEach((c) => addA(c.asesorId, c.asesorNombre));

    const pendientes = funnelEff.filter((f) => f.pendienteValidar).length + colocaciones.filter((c) => c.asesorId === 'SIN ASESOR').length;
    const clientesUnicos = new Set(funnelEff.map((f) => f.key));
    colocaciones.forEach((c) => { if (!c.funnelKey) clientesUnicos.add('ICARUS:' + (c.clienteId || c.contrato)); });

    return {
      funnel: funnelEff, colocaciones, asesores, ajustes: aj.ajustes, reemplazadas: aj.reemplazadas,
      fuenteColocacion: usarFunnel ? 'funnel' : 'oficial',
      matchStats: Object.assign({}, m.stats, { coincidencias: m.links.size, pendientes, clientesUnicos: clientesUnicos.size, canceladosExcluidos: icarus.length - colocaciones.length }),
    };
  }

  /* ---------------------------------------------------------------
   * 7b. AJUSTE DE CIERRE DE MES
   * Operaciones que se tomaron para el bono de un mes (colocadas después,
   * o aún en Mesa / Expediente) se ATRIBUYEN a ese mes y se EXCLUYEN de
   * los meses siguientes, para no contarlas dos veces.
   *  - Su monto entra al mes del cierre como "ajuste de cierre" (etiquetado aparte de lo real).
   *  - Si después se dispersan en el reporte oficial, esa colocación se reemplaza por el ajuste
   *    (no suma en el mes de dispersión).
   *  - Sus registros del Funnel salen del pipeline, proyección, puntos y retos de meses posteriores.
   *  - Si nunca se dispersan, se quedan en el mes del cierre y se marcan para seguimiento.
   * ------------------------------------------------------------- */
  const FUENTE_COLOCADO_RX = /colocad|dispers/;
  function applyCierres(cfg, reAlias, funnelEff, colocaciones) {
    const ajustes = [], virtuales = [], reemplazadas = [];
    const usados = new Set(), enMes = new Set();
    (cfg.cierres || []).filter((ci) => ci.activo !== false).forEach((ci) => {
      const pStart = ci.periodo + '-01', pEnd = U.monthEnd(pStart);
      (ci.items || []).forEach((it) => {
        const aId = it.asesorId ? reAlias(it.asesorId) : '';
        const sameA = (x) => !aId || x.asesorId === aId;
        const fMatch = funnelEff.filter((f) => sameA(f) && (
          (it.folio && (f.leadId === it.folio || f.clienteId === it.folio)) ||
          (it.contrato && f.contrato === it.contrato) ||
          (it.clienteId && f.clienteId === it.clienteId) ||
          (it.nameKey && U.nameKey(f.nombreNorm) === it.nameKey)));
        const fKeys = new Set(fMatch.map((f) => f.key));
        const col = colocaciones.filter((c) => !usados.has(c.contrato) && c.fecha >= pStart && sameA(c) && (
          (it.contrato && c.contrato === it.contrato) ||
          (it.folio && (c.contrato === it.folio || c.clienteId === it.folio)) ||
          (it.clienteId && c.clienteId === it.clienteId) ||
          (it.nameKey && U.nameKey(c.nombreNorm || c.nombre) === it.nameKey) ||
          (c.funnelKey && fKeys.has(c.funnelKey)))).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] || null;
        // Si ya se colocó DENTRO del mes del cierre es colocación real de ese mes: se conserva tal cual.
        // Si se colocó DESPUÉS, se reemplaza por el ajuste (cuenta en el mes del cierre, no en el de dispersión).
        const colEnMes = col && col.fecha <= pEnd;
        if (col) usados.add(col.contrato);
        if (col && !colEnMes) reemplazadas.push(Object.assign({}, col, { reemplazadaPor: it.id, cierre: ci.nombre }));
        if (colEnMes) enMes.add(col.contrato);
        fMatch.forEach((f) => { f.cierrePeriodo = ci.periodo; f.cierreHasta = pEnd; f.cierreNombre = ci.nombre; });
        // fecha de atribución: la fecha real si fue colocado dentro del mes; si no, el último día del mes
        const fechaAtrib = FUENTE_COLOCADO_RX.test(U.norm(it.fuente)) && it.fecha && it.fecha >= pStart && it.fecha <= pEnd ? it.fecha : pEnd;
        const best = fMatch.slice().sort((a, b) => STAGE_IDX[b.etapaEf] - STAGE_IDX[a.etapaEf])[0];
        let estado;
        if (col) estado = { key: 'dispersado', label: (col.fecha <= pEnd ? 'Colocado ' : 'Dispersado ') + U.fmtDateShort(col.fecha) + (Math.round(col.monto) !== Math.round(it.monto) ? ` (monto real ${U.money(col.monto)})` : '') };
        else if (best && best.etapaEf === 'perdido') estado = { key: 'perdido', label: 'No prosperó (' + best.etapaRaw + ')' };
        else if (best) estado = { key: 'proceso', label: 'En ' + STAGE_LABEL[best.etapaEf] };
        else estado = { key: 'sin', label: 'Pendiente de vincular (aún no aparece en Funnel ni colocación oficial)' };
        const asesorId = aId || 'SIN ASESOR';
        if (!colEnMes) virtuales.push({
          contrato: 'AJ-' + it.id, fecha: fechaAtrib, monto: it.monto, asesorId, asesorNombre: it.asesorNombre, tipo: it.tipo, recuperado: false,
          nombre: it.cliente, nombreNorm: U.normName(it.cliente), ajuste: true, ajusteFuente: it.fuente, cierreNombre: ci.nombre, cierreId: ci.id,
          funnelKey: best ? best.key : null, matchVia: 'ajuste', reemplaza: col ? col.contrato : null,
        });
        ajustes.push(Object.assign({}, it, { asesorId, cierreId: ci.id, cierreNombre: ci.nombre, periodo: ci.periodo, fechaAtrib, estado, colocacion: col ? { contrato: col.contrato, fecha: col.fecha, monto: col.monto } : null, funnelKeys: Array.from(fKeys) }));
      });
    });
    return { colocaciones: colocaciones.filter((c) => !usados.has(c.contrato) || enMes.has(c.contrato)).concat(virtuales), ajustes, reemplazadas };
  }

  /** Lee una calculadora de bonos / lista de cierre (cualquier hoja con columnas Asesor, Cliente, Monto…). */
  const CIERRE_COLS = {
    asesor: ['asesor homologado', 'asesor', 'promotor', 'ejecutivo', 'ejecutivo comercial', 'vendedor'],
    cliente: ['cliente', 'nombre cliente', 'nombre del cliente', 'acreditado', 'prospecto'],
    monto: ['monto', 'monto considerado', 'monto colocado', 'monto solicitado', 'importe'],
    tipo: ['tipo de credito', 'tipo', 'producto'],
    estatus: ['estatus', 'estatus actual', 'status', 'etapa'],
    fuente: ['fuente escenario 2', 'fuente', 'origen'],
    fecha: ['fecha', 'fecha colocacion', 'fecha de colocacion'],
    folio: ['folio crm', 'folio', 'id lead'],
    contrato: ['contrato', 'no contrato', 'numero de contrato'],
    clienteId: ['id cliente', 'no cliente', 'numero cliente'],
    considerada: ['considerada', 'considerado', 'incluida'],
  };
  function findCols(cells) {
    const n = cells.map((c) => U.norm(c));
    const col = {};
    Object.entries(CIERRE_COLS).forEach(([k, syns]) => {
      for (const sy of syns) {
        let i = n.findIndex((h) => h === sy);
        if (i < 0) i = n.findIndex((h) => h && h.startsWith(sy + ' '));
        if (i >= 0) { col[k] = i; break; }
      }
    });
    return col;
  }
  function parseCierreMatrix(matrix, sheetName, cfg) {
    const tables = [];
    for (let i = 0; i < matrix.length; i++) {
      const col = findCols(matrix[i] || []);
      if (col.cliente == null || col.monto == null || col.asesor == null) continue;
      const items = [];
      let j = i + 1;
      for (; j < matrix.length; j++) {
        const r = matrix[j] || [];
        const cli = String(r[col.cliente] == null ? '' : r[col.cliente]).trim();
        const first = U.norm(r.find((x) => String(x == null ? '' : x).trim() !== '') || '');
        if (!cli && !first) break;
        if (/^total/.test(first) || /^total/.test(U.norm(cli))) break;
        if (!cli || cli.startsWith('(')) continue;
        if (col.considerada != null && /^no/.test(U.norm(r[col.considerada]))) continue;
        const monto = U.parseMoney(r[col.monto]);
        if (!monto) continue;
        const asesorNombre = String(r[col.asesor] || '').trim();
        const g = (k) => (col[k] == null ? '' : r[col[k]]);
        items.push({
          asesorNombre, asesorId: asesorNombre ? resolveAsesor(asesorNombre, cfg) : '',
          cliente: cli, nameKey: U.nameKey(cli), monto,
          tipo: detectTipo(g('tipo')).tipo, estatus: String(g('estatus') || ''), fuente: String(g('fuente') || ''),
          fecha: U.parseDate(g('fecha')), folio: U.idStr(g('folio')), contrato: U.idStr(g('contrato')), clienteId: U.idStr(g('clienteId')),
        });
      }
      if (items.length) tables.push({ sheetName, items, hasFolio: col.folio != null, hasFuente: col.fuente != null });
      i = j;
    }
    return tables;
  }
  /** Metas por asesor (tabla con "Asesor" y "Meta individual") y meta de equipo (fila "EQUIPO"). */
  function parseMetasMatrix(matrix, cfg) {
    const out = { asesores: {}, equipo: null };
    for (let i = 0; i < matrix.length; i++) {
      const n = (matrix[i] || []).map((c) => U.norm(c));
      const ia = n.findIndex((h) => h === 'asesor'), im = n.findIndex((h) => h === 'meta individual' || h === 'meta monto' || h === 'meta de colocacion');
      if (ia < 0 || im < 0) continue;
      for (let j = i + 1; j < matrix.length; j++) {
        const r = matrix[j] || []; const a = String(r[ia] || '').trim(); if (!a) break;
        const meta = U.parseMoney(r[im]); if (!meta) continue;
        if (/^equipo/i.test(U.norm(a))) out.equipo = meta; else out.asesores[resolveAsesor(a, cfg)] = { nombre: a, meta };
      }
      if (Object.keys(out.asesores).length) break;
    }
    return out;
  }
  /** Lee el texto copiado (Ctrl+A, Ctrl+C) del Tablero comercial de BINCO BI y obtiene los colocados del mes. */
  const MESES_TXT = { ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06', jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12' };
  function parseTableroTexto(texto, cfg) {
    const lineas = String(texto || '').split(/\r?\n/).map((x) => x.replace(/\u00a0/g, ' ').trim());
    let mes = null;
    const mc = String(texto).match(/corte de\s+([a-záéíóú]{3})[a-z]*\.?\s+(20\d\d)/i);
    if (mc && MESES_TXT[U.norm(mc[1]).slice(0, 3)]) mes = mc[2] + '-' + MESES_TXT[U.norm(mc[1]).slice(0, 3)];
    const asesores = Object.keys((cfg && cfg.asesores) || {}).map((id) => ({ id, nombre: (cfg.asesores[id].nombre || id), clave: U.normName(cfg.asesores[id].nombre || id).split(' ').slice(0, 2).join(' ') }));
    const items = [];
    for (let i = 0; i < lineas.length; i++) {
      const m = lineas[i].match(/^Colocado(?:\t+| {1,3})(?!\(|vs\b|a la fecha)(.+)$/);
      if (!m) continue;
      let cliente = m[1].split('\t')[0].trim();
      // el detalle puede venir en la misma línea o en la siguiente
      const resto = (m[1].split('\t').slice(1).join('\t') + ' \t ' + (lineas[i + 1] || '')).trim();
      const monto = U.parseMoney((resto.match(/\$\s?[\d,]+(?:\.\d+)?/) || [''])[0]);
      const nr = U.normName(resto);
      const a = asesores.find((x) => x.clave && nr.includes(x.clave));
      if (!cliente || !monto || /^\d/.test(cliente)) continue;
      items.push({ cliente, nameKey: U.nameKey(cliente), asesorId: a ? a.id : '', asesorNombre: a ? a.nombre : '', monto, mes });
    }
    return { mes, items };
  }

  function parseCierreWorkbook(wb, cfg) {
    let best = null, metas = { asesores: {}, equipo: null };
    wb.SheetNames.forEach((name) => {
      const m = root.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      parseCierreMatrix(m, name, cfg).forEach((t) => {
        const score = t.items.length * 10 + (t.hasFolio ? 2 : 0) + (t.hasFuente ? 1 : 0);
        if (!best || score > best.score) best = Object.assign(t, { score });
      });
      const mm = parseMetasMatrix(m, cfg);
      if (Object.keys(mm.asesores).length && (!Object.keys(metas.asesores).length || (metas.equipo == null && mm.equipo != null))) metas = mm;
    });
    if (best) best.items.forEach((it) => { it.id = U.hash([it.asesorId, it.nameKey, it.monto, it.folio].join('|')).slice(0, 12); });
    return { tabla: best, metas };
  }

  /* ---------------------------------------------------------------
   * 8. MÉTRICAS OFICIALES (reglas de cálculo documentadas en README)
   * ------------------------------------------------------------- */
  const OPEN_STAGES = ['lead', 'contactado', 'interes', 'expediente', 'mesa', 'autorizado', 'por_dispersar'];
  const SI = (k) => STAGE_IDX[k];
  const NOT_CONTACTED_RX = /no contest|ilocaliz|sin contact|no localiz|numero equivocado|buzon|no contact/;

  function isContacted(f) {
    if (f.contactado === true) return true;
    if (f.contactado === false && STAGE_IDX[f.etapaEf] <= SI('contactado')) return false;
    if (f.etapaEf === 'perdido') return f.contactado !== false && !NOT_CONTACTED_RX.test(U.norm(f.etapaRaw));
    return STAGE_IDX[f.etapaEf] >= 1;
  }
  function isWorked(f) {
    if (f.gestiones != null && f.gestiones > 0) return true;
    if (f.contactado != null) return true;
    if (STAGE_IDX[f.etapaEf] >= 1 || f.etapaEf === 'perdido') return true;
    if (NOT_CONTACTED_RX.test(U.norm(f.etapaRaw))) return true;
    return !!(f.fUlt && f.fAsig && f.fUlt > f.fAsig);
  }
  /** Máxima etapa alcanzada (considera historial: un perdido que llegó a Mesa cuenta en Mesa). */
  function reachedIdx(f) {
    let mx = STAGE_IDX[f.etapaEf];
    (f.historial || []).forEach((h) => { if (STAGE_IDX[h.etapa] > mx) mx = STAGE_IDX[h.etapa]; });
    if (f.etapaEf === 'perdido' && mx < 0) mx = isContacted(f) ? 1 : 0;
    if (f.pendienteValidar) mx = Math.min(mx, SI('por_dispersar'));
    if (f.etapaEf !== 'colocado') mx = Math.min(mx, SI('por_dispersar'));
    return mx;
  }
  /** Fecha en que el registro alcanzó la etapa: campo explícito → historial → última gestión → asignación. */
  function stageDate(f, stage) {
    const explicit = { contactado: f.fContacto, expediente: f.fExp, mesa: f.fMesa, autorizado: f.fAut }[stage];
    if (explicit) return explicit;
    const si = STAGE_IDX[stage];
    const h = (f.historial || []).find((x) => STAGE_IDX[x.etapa] >= si);
    if (h && h.fecha) return h.fecha;
    return f.fUlt || f.fAsig;
  }

  /** Tipos de meta: 'monto' (colocación $) y 'creditos' (número de créditos colocados). */
  const META_KEYS = {
    monto: { mes: 'metas', base: 'metaBase', equipo: 'metaEquipo', redondeo: (x) => Math.round(x) },
    creditos: { mes: 'metasCreditos', base: 'metaCreditosBase', equipo: 'metaEquipoCreditos', redondeo: (x) => Math.round(x * 10) / 10 },
  };
  function metaMensual(cfg, asesorId, mk, tipoMeta) {
    const K = META_KEYS[tipoMeta || 'monto'];
    const byMonth = (cfg[K.mes] && cfg[K.mes][mk]) || {};
    if (byMonth[asesorId] != null && byMonth[asesorId] !== '') return Number(byMonth[asesorId]) || 0;
    const a = cfg.asesores && cfg.asesores[asesorId];
    return a && a[K.base] ? Number(a[K.base]) : 0;
  }
  /** Meta prorrateada por días hábiles cuando el periodo no es un mes completo. */
  function metaRange(cfg, asesorIds, range, tipoMeta) {
    let total = 0;
    let cur = U.monthStart(range.from);
    while (cur <= range.to) {
      const mEnd = U.monthEnd(cur);
      const a = range.from > cur ? range.from : cur, b = range.to < mEnd ? range.to : mEnd;
      const bdM = U.businessDays(cur, mEnd, cfg.diasHabiles).length || 1;
      const bdR = U.businessDays(a, b, cfg.diasHabiles).length;
      const factor = (a === cur && b === mEnd) ? 1 : bdR / bdM;
      const mk = U.monthKey(cur);
      asesorIds.forEach((id) => { total += metaMensual(cfg, id, mk, tipoMeta) * factor; });
      const n = U.fromYmd(cur); n.setMonth(n.getMonth() + 1); cur = U.ymd(n);
    }
    return META_KEYS[tipoMeta || 'monto'].redondeo(total);
  }
  function metaEquipoRange(cfg, activeIds, range, tipoMeta) {
    const K = META_KEYS[tipoMeta || 'monto'];
    let total = 0, cur = U.monthStart(range.from);
    while (cur <= range.to) {
      const mEnd = U.monthEnd(cur);
      const a = range.from > cur ? range.from : cur, b = range.to < mEnd ? range.to : mEnd;
      const bdM = U.businessDays(cur, mEnd, cfg.diasHabiles).length || 1;
      const factor = (a === cur && b === mEnd) ? 1 : U.businessDays(a, b, cfg.diasHabiles).length / bdM;
      const mk = U.monthKey(cur);
      const fixed = cfg[K.equipo] && cfg[K.equipo][mk];
      const m = fixed ? Number(fixed) : activeIds.reduce((s, id) => s + metaMensual(cfg, id, mk, tipoMeta), 0);
      total += m * factor;
      const n = U.fromYmd(cur); n.setMonth(n.getMonth() + 1); cur = U.ymd(n);
    }
    return K.redondeo(total);
  }

  function progressLevel(p) {
    if (p == null) return { key: 'inicio', label: 'Arrancando' };
    if (p >= 100) return { key: 'meta', label: '¡Meta cumplida!' };
    if (p >= 80) return { key: 'cerca', label: 'Cerca de la meta' };
    if (p >= 50) return { key: 'avance', label: 'Buen avance' };
    return { key: 'inicio', label: 'En marcha' };
  }

  /**
   * Calcula todos los KPIs para un conjunto de asesores y un periodo.
   * @param ds dataset (buildDataset)
   * @param o {range:{from,to}, asesorIds:[...]|null (null = todo el equipo), tipo:'Todos'|..., today, cfg}
   */
  function compute(ds, o) {
    const cfg = o.cfg, range = o.range, today = o.today || U.today();
    const ids = o.asesorIds ? new Set(o.asesorIds) : null;
    const byA = (x) => !ids || ids.has(x.asesorId);
    const byT = (x) => !o.tipo || o.tipo === 'Todos' || x.tipo === o.tipo;

    // --- Colocación real (ICARUS)
    const coloc = ds.colocaciones.filter((c) => byA(c) && byT(c) && U.inRange(c.fecha, range));
    const monto = coloc.reduce((s, c) => s + c.monto, 0);
    const creditos = coloc.length;
    const porTipo = {}; TIPOS.forEach((t) => { porTipo[t] = { n: 0, monto: 0 }; });
    coloc.forEach((c) => { porTipo[c.tipo].n++; porTipo[c.tipo].monto += c.monto; });
    const recuperados = coloc.filter((c) => c.recuperado).length;
    const ajusteList = coloc.filter((c) => c.ajuste);
    const montoAjuste = ajusteList.reduce((s, c) => s + c.monto, 0);

    // --- Meta
    const metaIds = o.asesorIds || Object.keys(cfg.asesores || {}).filter((id) => cfg.asesores[id].activo !== false);
    const meta = o.asesorIds ? metaRange(cfg, metaIds, range) : metaEquipoRange(cfg, metaIds, range);
    const avance = meta ? (monto / meta) * 100 : null;
    const faltante = Math.max(0, meta - monto);
    // Meta de número de créditos colocados
    const metaCreditos = o.asesorIds ? metaRange(cfg, metaIds, range, 'creditos') : metaEquipoRange(cfg, metaIds, range, 'creditos');
    const avanceCreditos = metaCreditos ? (creditos / metaCreditos) * 100 : null;
    const faltanteCreditos = Math.max(0, Math.ceil(metaCreditos - creditos));

    // --- Funnel
    // registros del Funnel ya contados en un cierre anterior no cuentan en periodos posteriores
    const fAll = ds.funnel.filter((f) => byA(f) && byT(f) && !(f.cierreHasta && range.from > f.cierreHasta));
    const enAlcance = fAll.filter((f) => {
      const open = OPEN_STAGES.includes(f.etapaEf);
      const asig = f.fAsig || f.fUlt;
      if (asig && asig > range.to) return false;
      if (U.inRange(asig, range)) return true;
      if (open) return true;
      if (f.etapaEf === 'colocado') return f.contratos.some((k) => coloc.some((c) => c.contrato === k));
      return U.inRange(f.fUlt, range);
    });
    // colocaciones sin registro en Funnel: cuentan como recorrido completo
    const huerfanas = coloc.filter((c) => !c.funnelKey);

    const pipeline = ['lead', 'contactado', 'interes', 'expediente', 'mesa', 'autorizado', 'colocado'].map((k) => ({ key: k, label: STAGES.find((s) => s.key === k).plural, n: 0, monto: 0, actual: 0, montoActual: 0 }));
    enAlcance.forEach((f) => {
      const r = reachedIdx(f);
      pipeline.forEach((p) => {
        if (p.key === 'colocado') return;
        const si = STAGE_IDX[p.key];
        if (r >= si) { p.n++; p.monto += f.monto || 0; }
      });
    });
    huerfanas.forEach((c) => pipeline.forEach((p) => { if (p.key !== 'colocado') { p.n++; p.monto += c.monto; } }));
    const pc = pipeline.find((p) => p.key === 'colocado'); pc.n = creditos; pc.monto = monto;
    pipeline.forEach((p, i) => { p.conv = i === 0 ? null : U.safeDiv(p.n, pipeline[i - 1].n) == null ? null : (p.n / pipeline[i - 1].n) * 100; });

    // estado actual (foto de hoy, independiente del periodo)
    const abiertos = fAll.filter((f) => OPEN_STAGES.includes(f.etapaEf));
    const cnt = (st) => abiertos.filter((f) => f.etapaEf === st);
    const sum = (arr) => arr.reduce((s, f) => s + (f.monto || 0), 0);
    const estado = {
      enProceso: abiertos.filter((f) => STAGE_IDX[f.etapaEf] >= SI('expediente')).length,
      interes: cnt('interes').length, montoInteres: sum(cnt('interes')),
      expediente: cnt('expediente').length, mesa: cnt('mesa').length, autorizados: cnt('autorizado').length,
      porDispersar: cnt('por_dispersar').length, pendientesValidar: abiertos.filter((f) => f.pendienteValidar).length,
      montoMesa: sum(cnt('mesa')), montoAutorizados: sum(cnt('autorizado')), montoPorDispersar: sum(cnt('por_dispersar')),
    };

    // --- Contactación
    const asignados = fAll.filter((f) => U.inRange(f.fAsig, range)).length;
    const gestionados = fAll.filter((f) => U.inRange(f.fAsig, range) || U.inRange(f.fUlt, range) || U.inRange(f.fContacto, range));
    const trabajados = gestionados.filter(isWorked);
    const contactados = trabajados.filter(isContacted);
    const pctContactacion = trabajados.length ? (contactados.length / trabajados.length) * 100 : null;

    // --- Eventos del periodo (para retos, puntos y racha)
    const ev = { contactos: 0, intereses: 0, expedientes: 0, mesa: 0, autorizados: 0 };
    fAll.forEach((f) => {
      const r = reachedIdx(f);
      if (r >= SI('contactado') && isContacted(f) && U.inRange(stageDate(f, 'contactado'), range)) ev.contactos++;
      if (r >= SI('interes') && U.inRange(stageDate(f, 'interes'), range)) ev.intereses++;
      if (r >= SI('expediente') && U.inRange(stageDate(f, 'expediente'), range)) ev.expedientes++;
      if (r >= SI('mesa') && U.inRange(stageDate(f, 'mesa'), range)) ev.mesa++;
      if (r >= SI('autorizado') && U.inRange(stageDate(f, 'autorizado'), range)) ev.autorizados++;
    });
    ev.colocados = creditos;

    // --- Proyección (solo si el periodo incluye hoy o el futuro). REAL y PROYECCIÓN nunca se mezclan.
    const fA = cfg.factorAutorizado == null ? 1 : Number(cfg.factorAutorizado);
    const fM = cfg.factorMesa == null ? 1 : Number(cfg.factorMesa);
    const proyectable = range.to >= today;
    const enCaminoAut = (estado.montoAutorizados + estado.montoPorDispersar) * fA;
    const enCaminoMesa = estado.montoMesa * fM;
    const enCamino = proyectable ? Math.round(enCaminoAut + enCaminoMesa) : 0;
    const proyeccion = { real: monto, enCamino, enCaminoAut: proyectable ? Math.round(enCaminoAut) : 0, enCaminoMesa: proyectable ? Math.round(enCaminoMesa) : 0, potencial: monto + enCamino, faltanteProyectado: Math.max(0, meta - monto - enCamino), proyectable };

    // --- Ritmo vs esperado
    const bdTotal = U.businessDays(range.from, range.to, cfg.diasHabiles).length;
    const corte = today < range.to ? today : range.to;
    const bdTrans = corte >= range.from ? U.businessDays(range.from, corte, cfg.diasHabiles).length : 0;
    const esperado = bdTotal ? meta * bdTrans / bdTotal : 0;
    let ritmo = null;
    if (meta && bdTrans) {
      const ratio = monto / (esperado || 1);
      ritmo = { esperado: Math.round(esperado), ratio, key: ratio >= 1.05 ? 'adelantado' : ratio >= 0.95 ? 'en_ritmo' : 'debajo', label: ratio >= 1.05 ? 'Adelantado' : ratio >= 0.95 ? 'En ritmo' : 'Por debajo del ritmo requerido' };
    }

    // --- Ticket y simulador
    const ticket = creditos ? monto / creditos : null;

    return {
      range, monto, creditos, ticket, porTipo, metaCreditos, avanceCreditos, faltanteCreditos, nivelCreditos: progressLevel(avanceCreditos), montoReal: monto - montoAjuste, montoAjuste, creditosAjuste: ajusteList.length, recuperados, meta, avance, faltante, nivel: progressLevel(avance),
      pipeline, estado, proyeccion, ritmo, bdTotal, bdTrans,
      contactacion: { asignados, trabajados: trabajados.length, contactados: contactados.length, pct: pctContactacion },
      conversion: trabajados.length ? (creditos / trabajados.length) * 100 : null,
      eventos: ev, colocacionesList: coloc, abiertos,
    };
  }

  /** Serie diaria acumulada + línea esperada (para la gráfica de evolución). */
  function dailySeries(ds, o) {
    const cfg = o.cfg, range = o.range, today = o.today || U.today();
    const ids = o.asesorIds ? new Set(o.asesorIds) : null;
    const coloc = ds.colocaciones.filter((c) => (!ids || ids.has(c.asesorId)) && (!o.tipo || o.tipo === 'Todos' || c.tipo === o.tipo) && U.inRange(c.fecha, range));
    const days = U.daysBetween(range.from, range.to);
    const meta = o.meta;
    const bd = U.businessDays(range.from, range.to, cfg.diasHabiles);
    let acc = 0, bdc = 0;
    return days.map((d) => {
      acc += coloc.filter((c) => c.fecha === d).reduce((s, c) => s + c.monto, 0);
      if (bd.includes(d)) bdc++;
      return { fecha: d, real: d <= today ? acc : null, esperado: bd.length ? Math.round(meta * bdc / bd.length) : 0 };
    });
  }

  /** Colocación semanal (últimas N semanas) para evolución por asesor. */
  function weeklySeries(ds, o) {
    const ids = o.asesorIds ? new Set(o.asesorIds) : null;
    const end = U.weekStart(o.today || U.today());
    const out = [];
    for (let i = (o.weeks || 8) - 1; i >= 0; i--) {
      const from = U.addDays(end, -7 * i), to = U.addDays(from, 6);
      const c = ds.colocaciones.filter((x) => (!ids || ids.has(x.asesorId)) && U.inRange(x.fecha, { from, to }));
      out.push({ from, to, monto: c.reduce((s, x) => s + x.monto, 0), n: c.length });
    }
    return out;
  }

  /** Clientes más cercanos a colocarse (sin datos sensibles). */
  const NEXT_ACTION = {
    por_dispersar: 'Confirmar firma y dispersión', autorizado: 'Agendar firma del contrato',
    mesa: 'Dar seguimiento a Mesa y resolver observaciones', expediente: 'Completar documentos y enviar a Mesa',
    interes: 'Integrar expediente', contactado: 'Confirmar interés y pedir documentos', lead: 'Lograr primer contacto',
  };
  function nearClosings(ds, o) {
    const ids = o.asesorIds ? new Set(o.asesorIds) : null;
    return ds.funnel
      .filter((f) => (!ids || ids.has(f.asesorId)) && OPEN_STAGES.includes(f.etapaEf) && STAGE_IDX[f.etapaEf] >= (o.minStage == null ? SI('expediente') : o.minStage))
      .filter((f) => !o.tipo || o.tipo === 'Todos' || f.tipo === o.tipo)
      .filter((f) => !o.etapa || o.etapa === 'Todas' || f.etapaEf === o.etapa)
      .sort((a, b) => (STAGE_IDX[b.etapaEf] - STAGE_IDX[a.etapaEf]) || (b.monto - a.monto))
      .slice(0, o.limit || 15)
      .map((f) => ({
        cliente: U.shortName(f.nombre), etapa: STAGE_LABEL[f.etapaEf], etapaKey: f.etapaEf, monto: f.monto, tipo: f.tipo,
        asesor: f.asesorNombre, pendienteValidar: f.pendienteValidar, cierrePeriodo: f.cierrePeriodo || null,
        accion: f.proximaAccion || NEXT_ACTION[f.etapaEf], ultima: f.fUlt,
      }));
  }

  /** Días con actividad comercial (para la racha). */
  function activityDays(ds, asesorId) {
    const days = new Set();
    ds.funnel.forEach((f) => {
      if (f.asesorId !== asesorId) return;
      [f.fUlt, f.fContacto, f.fExp, f.fMesa, f.fAut].forEach((d) => d && days.add(d));
      (f.historial || []).forEach((h) => h.fecha && days.add(h.fecha));
    });
    ds.colocaciones.forEach((c) => { if (c.asesorId === asesorId) days.add(c.fecha); });
    return days;
  }

  /* ---------------------------------------------------------------
   * 9. ALMACENAMIENTO (IndexedDB con respaldo en memoria)
   * ------------------------------------------------------------- */
  class Store {
    constructor(dbName) { this.dbName = dbName || 'binco_reto_comercial'; this.mem = {}; this.db = null; }
    async open() {
      if (typeof indexedDB === 'undefined') return this;
      try {
        this.db = await new Promise((res, rej) => {
          const rq = indexedDB.open(this.dbName, 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
          rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
        });
      } catch (e) { console.warn('IndexedDB no disponible, se usa memoria', e); this.db = null; }
      return this;
    }
    async get(k) {
      if (!this.db) return this.mem[k];
      return new Promise((res, rej) => { const t = this.db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
    }
    async set(k, v) {
      if (!this.db) { this.mem[k] = v; return; }
      return new Promise((res, rej) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    }
    async clear() {
      this.mem = {};
      if (!this.db) return;
      return new Promise((res) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => res(); });
    }
  }

  /** Configuración (pequeña) en localStorage con respaldo en memoria. */
  const ConfigStore = {
    KEY: 'binco_reto_config_v1', mem: null,
    load(defaults) {
      let c = null;
      try { c = JSON.parse(root.localStorage.getItem(this.KEY) || 'null'); } catch (e) { c = this.mem; }
      return deepMerge(JSON.parse(JSON.stringify(defaults)), c || {});
    },
    save(cfg) { this.mem = cfg; try { root.localStorage.setItem(this.KEY, JSON.stringify(cfg)); } catch (e) { /* memoria */ } },
  };
  function deepMerge(a, b) {
    Object.keys(b || {}).forEach((k) => {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]);
      else a[k] = b[k];
    });
    return a;
  }

  /* ---------------------------------------------------------------
   * 10. FUENTES DE DATOS (adaptadores intercambiables)
   * ------------------------------------------------------------- */
  /** Fuente local: archivos Excel/CSV cargados por el administrador (FASE 1). */
  class FileSource {
    constructor(store) { this.store = store; this.kind = 'archivos'; }
    async loadAll() {
      return {
        funnel: (await this.store.get('funnel')) || [], icarus: (await this.store.get('icarus')) || [],
        cargas: (await this.store.get('cargas')) || [], snapshots: (await this.store.get('snapshots')) || [],
      };
    }
  }

  /**
   * Fuente API (FASE 2) — PREPARADA, NO CONECTADA.
   * No existe hoy una API confirmada de Funnel BINCO ni de ICARUS. Este adaptador solo
   * define el contrato: cuando el proveedor entregue endpoints, se configuran URL, auth y
   * el mapeo de campos (el mismo mapper que usan los Excel), sin tocar la lógica de negocio.
   */
  class ApiSource {
    constructor(conf, cfg) { this.conf = conf || {}; this.cfg = cfg; this.kind = 'api'; }
    isConfigured() { return !!(this.conf.funnelUrl || this.conf.icarusUrl); }
    async fetchJson(url) {
      const headers = { Accept: 'application/json' };
      if (this.conf.token) headers.Authorization = 'Bearer ' + this.conf.token;
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
      const j = await r.json();
      return Array.isArray(j) ? j : (j.data || j.items || j.results || []);
    }
    async loadAll() {
      if (!this.isConfigured()) throw new Error('API no configurada. Ver README §13 (información a solicitar al proveedor).');
      const fRows = this.conf.funnelUrl ? await this.fetchJson(this.conf.funnelUrl) : [];
      const iRows = this.conf.icarusUrl ? await this.fetchJson(this.conf.icarusUrl) : [];
      const fMap = this.conf.funnelMapping || suggestMapping('funnel', Object.keys(fRows[0] || {}), {});
      const iMap = this.conf.icarusMapping || suggestMapping('icarus', Object.keys(iRows[0] || {}), {});
      return {
        funnel: analyze('funnel', fRows, fMap, this.cfg).records,
        icarus: analyze('icarus', iRows, iMap, this.cfg).records, cargas: [], snapshots: [],
      };
    }
  }

  /* ---------------------------------------------------------------
   * 11. LECTURA DE ARCHIVOS (SheetJS)
   * ------------------------------------------------------------- */
  async function readFile(file) {
    if (!root.XLSX) throw new Error('No se cargó SheetJS (xlsx).');
    const buf = await file.arrayBuffer();
    // Fechas como serial de Excel (cellDates:false) para evitar desfases por zona horaria.
    const wb = root.XLSX.read(buf, { type: 'array', cellDates: false, codepage: 65001 });
    // hoja con más filas
    let best = null;
    wb.SheetNames.forEach((n) => {
      const rows = root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      if (!best || rows.length > best.rows.length) best = { name: n, rows };
    });
    return tableFromMatrix(best.rows, best.name);
  }
  function tableFromMatrix(matrix, sheetName) {
    const h = findHeaderRow(matrix);
    const seen = {};
    const headers = (matrix[h] || []).map((x, i) => {
      let s = String(x == null ? '' : x).trim() || `Columna ${i + 1}`;
      if (seen[s]) s = s + ' (' + (++seen[s]) + ')'; else seen[s] = 1;
      return s;
    });
    const rows = matrix.slice(h + 1).map((r) => Object.fromEntries(headers.map((k, i) => [k, r[i] == null ? '' : r[i]])));
    return { sheetName, headers, rows };
  }
  /** Detecta si el archivo parece Funnel o ICARUS por sus columnas. */
  function guessSource(headers) {
    const f = Object.keys(suggestMapping('funnel', headers, {}));
    const i = Object.keys(suggestMapping('icarus', headers, {}));
    const fScore = f.filter((k) => ['etapa', 'fechaAsignacion', 'fechaUltimaGestion', 'contactado', 'gestiones', 'proximaAccion'].includes(k)).length;
    const iScore = i.filter((k) => ['contrato', 'fechaColocacion', 'monto'].includes(k)).length + (/(dispers|colocac|otorg)/.test(U.norm(headers.join(' '))) ? 1 : 0);
    return fScore >= iScore ? 'funnel' : 'icarus';
  }

  /* ---------------------------------------------------------------
   * 12. DATOS DE DEMOSTRACIÓN (formato "exportación real" → pasa por el mismo pipeline)
   * ------------------------------------------------------------- */
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function demoData(today, seed) {
    const R = rng(seed || 20261007);
    const pickR = (a) => a[Math.floor(R() * a.length)];
    const asesores = [
      ['Ana Karen Ruiz', 1.25], ['Luis Fernando Mora', 1.05], ['Daniela Ortega', 0.95], ['Jorge Castañeda', 0.85],
      ['Mariana Solís', 1.1], ['Ricardo Villalobos', 0.7], ['Paola Hernández', 0.9], ['Erick Salazar', 0.8],
    ];
    const nombres = ['María', 'José', 'Guadalupe', 'Juan', 'Rosa', 'Carlos', 'Verónica', 'Miguel', 'Laura', 'Fernando', 'Patricia', 'Alejandro', 'Gabriela', 'Arturo', 'Leticia', 'Héctor', 'Claudia', 'Raúl', 'Silvia', 'Javier'];
    const apellidos = ['García', 'Martínez', 'López', 'González', 'Rodríguez', 'Pérez', 'Sánchez', 'Ramírez', 'Cruz', 'Flores', 'Gómez', 'Morales', 'Vázquez', 'Reyes', 'Jiménez', 'Torres', 'Díaz', 'Mendoza', 'Ruiz', 'Aguilar'];
    const tipos = ['Nuevo', 'Nuevo', 'Renovación', 'Renovación', 'Nómina'];
    const estatusTxt = { lead: ['Nuevo', 'No contesta', 'Por contactar'], contactado: ['Contactado', 'Interesado - seguimiento'], expediente: ['Integración de expediente'], mesa: ['Mesa de control'], autorizado: ['Autorizado'], por_dispersar: ['Pendiente de dispersión'], colocado: ['Colocado'], perdido: ['No interesado', 'Rechazado'] };
    const acciones = { por_dispersar: 'Confirmar cita de firma', autorizado: 'Llamar para agendar firma', mesa: 'Enviar comprobante de domicilio faltante', expediente: 'Recoger estados de cuenta', contactado: 'Enviar lista de documentos', lead: '' };
    const funnel = [], icarus = [];
    const mStart = U.monthStart(today);
    const prevStart = U.monthStart(U.addDays(mStart, -1));
    const from = U.addDays(prevStart, -21);
    const bd = U.businessDays(from, today);
    let folio = 50000, contrato = 880000, clienteSeq = 120000;

    asesores.forEach(([nombreA, skill]) => {
      bd.forEach((d) => {
        const nLeads = Math.max(1, Math.round((2 + R() * 3) * (0.8 + skill * 0.2)));
        for (let i = 0; i < nLeads; i++) {
          const cli = `${pickR(nombres)} ${pickR(nombres)} ${pickR(apellidos)} ${pickR(apellidos)}`;
          const tipo = pickR(tipos);
          const monto = Math.round((tipo === 'Nómina' ? 25000 + R() * 35000 : 20000 + R() * 60000) / 500) * 500;
          const age = U.businessDays(d, today).length - 1; // días hábiles transcurridos
          // probabilidad de avance según antigüedad y habilidad
          const pContact = 0.62 + skill * 0.12;
          let stage = 'lead';
          const r = R();
          if (r < pContact) stage = 'contactado';
          if (stage === 'contactado' && R() < 0.42 * skill && age >= 1) stage = 'expediente';
          if (stage === 'expediente' && R() < 0.75 && age >= 2) stage = 'mesa';
          if (stage === 'mesa' && R() < 0.72 && age >= 3) stage = 'autorizado';
          if (stage === 'autorizado' && R() < 0.8 && age >= 4) stage = 'por_dispersar';
          if (stage === 'por_dispersar' && R() < 0.9 && age >= 5) stage = 'colocado';
          if ((stage === 'lead' || stage === 'contactado') && age > 6 && R() < 0.75) stage = 'perdido';
          if (['expediente', 'mesa', 'autorizado', 'por_dispersar'].includes(stage) && age > 10) stage = R() < 0.16 ? 'colocado' : 'perdido';
          const clienteId = 'BC' + (clienteSeq++);
          const tel = '55' + String(Math.floor(10000000 + R() * 89999999));
          const lag = Math.min(age, Math.floor(R() * 4) + (STAGE_IDX[stage] > SI('expediente') ? 3 : 0));
          const fUlt = bd[Math.min(bd.length - 1, bd.indexOf(d) + lag)] || d;
          const row = {
            'Folio': 'F' + (folio++), 'Ejecutivo Comercial': nombreA, 'Nombre del Cliente': cli, 'ID Cliente': clienteId,
            'Teléfono': tel, 'Tipo de Crédito': tipo, 'Monto Solicitado': monto, 'Estatus': pickR(estatusTxt[stage]),
            'Fecha Asignación': fmtMx(d), 'Fecha Última Gestión': fmtMx(fUlt), 'Contactado': stage === 'lead' ? (R() < 0.6 ? 'No' : '') : (stage === 'perdido' ? 'Sí' : 'Sí'),
            'Gestiones': stage === 'lead' ? Math.floor(R() * 3) : 1 + Math.floor(R() * 5), 'Próxima Acción': acciones[stage] || '',
          };
          funnel.push(row);
          if (stage === 'colocado') {
            const fCol = fUlt <= today ? fUlt : today;
            icarus.push({
              'No. Contrato': 'CT-' + (contrato++), 'ID Cliente': clienteId, 'Nombre Acreditado': cli.toUpperCase(),
              'Asesor': nombreA.toUpperCase(), 'Producto': tipo === 'Nómina' ? 'CREDITO NOMINA' : tipo === 'Renovación' ? 'RENOVACION' : 'CREDITO NUEVO',
              'Monto Otorgado': monto, 'Fecha Dispersión': fmtMx(fCol), 'Sucursal': 'Matriz', 'Estatus': 'VIGENTE',
            });
          }
        }
      });
    });
    // Casos de control para validar la lógica:
    // a) fila duplicada en ICARUS (debe ignorarse)
    if (icarus.length) icarus.push(Object.assign({}, icarus[0]));
    // b) fila duplicada en Funnel (mismo folio)
    if (funnel.length) funnel.push(Object.assign({}, funnel[5]));
    // c) colocación en ICARUS sin ID cliente → debe cruzar por teléfono? (no trae teléfono) → por nombre + asesor
    const sample = funnel.find((f) => /contactado/i.test(f['Estatus']));
    if (sample) {
      sample['Estatus'] = 'Colocado';
      icarus.push({ 'No. Contrato': 'CT-' + (contrato++), 'ID Cliente': '', 'Nombre Acreditado': sample['Nombre del Cliente'].toUpperCase(), 'Asesor': sample['Ejecutivo Comercial'], 'Producto': 'CREDITO NUEVO', 'Monto Otorgado': sample['Monto Solicitado'], 'Fecha Dispersión': fmtMx(today), 'Sucursal': 'Matriz', 'Estatus': 'VIGENTE' });
    }
    // d) crédito cancelado (no debe contar)
    icarus.push({ 'No. Contrato': 'CT-' + (contrato++), 'ID Cliente': 'BC999999', 'Nombre Acreditado': 'CLIENTE CANCELADO PRUEBA', 'Asesor': asesores[0][0].toUpperCase(), 'Producto': 'CREDITO NUEVO', 'Monto Otorgado': 50000, 'Fecha Dispersión': fmtMx(today), 'Sucursal': 'Matriz', 'Estatus': 'CANCELADO' });
    return { funnel, icarus, asesores: asesores.map((a) => a[0]), metas: Object.fromEntries(asesores.map((a) => [a[0], Math.round(a[1] * 620000 / 10000) * 10000])) };
    function fmtMx(s) { const [y, m, dd] = s.split('-'); return `${dd}/${m}/${y}`; }
  }

  /* ---------------------------------------------------------------
   * EXPORTAR
   * ------------------------------------------------------------- */
  root.BincoData = {
    U, STAGES, STAGE_IDX, STAGE_LABEL, TIPOS, FIELDS, OPEN_STAGES,
    detectStage, detectTipo, suggestMapping, validateMapping, findHeaderRow, tableFromMatrix, guessSource, readFile,
    normalizeFunnel, normalizeIcarus, analyze, mergeFunnel, mergeIcarus, match, buildDataset,
    compute, dailySeries, weeklySeries, nearClosings, activityDays, metaMensual, metaRange, metaEquipoRange, progressLevel,
    isContacted, isWorked, reachedIdx, stageDate,
    Store, ConfigStore, FileSource, ApiSource, deepMerge, demoData,
    applyCierres, parseCierreMatrix, parseCierreWorkbook, parseMetasMatrix, parseTableroTexto,
  };
})(typeof window !== 'undefined' ? window : globalThis);
