// Cliente mínimo de la API v4 de Kommo.
// El token NUNCA se escribe aquí: se lee de process.env.KOMMO_TOKEN.

const BASE = () => {
  if (process.env.KOMMO_BASE_URL) return process.env.KOMMO_BASE_URL.replace(/\/+$/, '');
  const sub = process.env.KOMMO_SUBDOMAIN;
  if (!sub) throw new Error('Falta KOMMO_SUBDOMAIN (o KOMMO_BASE_URL) en las variables de entorno.');
  return `https://${sub}.kommo.com`;
};

const token = () => {
  const t = process.env.KOMMO_TOKEN;
  if (!t) throw new Error('Falta KOMMO_TOKEN en las variables de entorno.');
  return t;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una petición GET a la API v4. Devuelve null en 204 (sin contenido). */
export async function kommoGet(path, params = {}) {
  const url = new URL(BASE() + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 204) return null;
  if (res.status === 401) throw new Error('Kommo devuelve 401: el token no es válido o ha sido revocado.');
  if (res.status === 403) throw new Error('Kommo devuelve 403: al token le falta el scope necesario (crm).');
  if (res.status === 429) throw new Error('Kommo devuelve 429: demasiadas peticiones. Reduce el rango de fechas.');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Kommo devuelve ${res.status} en ${path}. ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Pipelines con sus etapas. */
export async function getPipelines() {
  const json = await kommoGet('/api/v4/leads/pipelines');
  const pipelines = json?._embedded?.pipelines ?? [];
  return pipelines.map((p) => ({
    pipeline_id: p.id,
    pipeline: p.name,
    es_principal: Boolean(p.is_main),
    etapas: (p._embedded?.statuses ?? [])
      .sort((a, b) => a.sort - b.sort)
      .map((s) => ({ status_id: s.id, etapa: s.name, tipo: s.type, orden: s.sort })),
  }));
}

/** Campos personalizados de leads: sirve para localizar el campo que identifica al cliente. */
export async function getLeadCustomFields() {
  const json = await kommoGet('/api/v4/leads/custom_fields', { limit: 250 });
  const fields = json?._embedded?.custom_fields ?? [];
  return fields.map((f) => ({
    field_id: f.id,
    nombre: f.name,
    tipo: f.type,
    opciones: (f.enums ?? []).map((e) => e.value).slice(0, 40),
  }));
}

const MAX_PAGES = Number(process.env.KOMMO_MAX_PAGES || 40); // 40 x 250 = 10.000 leads

/**
 * Lee los leads creados en un rango de fechas, paginando.
 * desde / hasta son 'YYYY-MM-DD' en la zona indicada por KOMMO_TZ_OFFSET (horas, por defecto 0).
 */
export async function getLeads({ desde, hasta, pipeline_id } = {}) {
  const offsetH = Number(process.env.KOMMO_TZ_OFFSET || 0);
  const toUnix = (d, endOfDay) => {
    if (!d) return undefined;
    const base = Date.parse(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
    return Math.floor(base / 1000) - offsetH * 3600;
  };

  const params = { limit: 250, page: 1 };
  const from = toUnix(desde, false);
  const to = toUnix(hasta, true);
  if (from !== undefined) params['filter[created_at][from]'] = from;
  if (to !== undefined) params['filter[created_at][to]'] = to;
  if (pipeline_id) params['filter[pipeline_id]'] = pipeline_id;

  const leads = [];
  let truncado = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    params.page = page;
    const json = await kommoGet('/api/v4/leads', params);
    const lote = json?._embedded?.leads ?? [];
    leads.push(...lote);
    if (!json?._links?.next || lote.length === 0) break;
    if (page === MAX_PAGES) truncado = true;
    await sleep(170); // Kommo limita a ~7 peticiones por segundo
  }
  return { leads, truncado };
}

/** Diccionario status_id -> {pipeline, etapa}. 142 y 143 son globales en Kommo. */
export async function buildStageIndex() {
  const pipelines = await getPipelines();
  const porStatus = new Map();
  for (const p of pipelines) {
    for (const e of p.etapas) {
      porStatus.set(e.status_id, { pipeline: p.pipeline, pipeline_id: p.pipeline_id, etapa: e.etapa, orden: e.orden, tipo: e.tipo });
    }
  }
  return { pipelines, porStatus };
}

export function nombreEtapa(porStatus, lead) {
  const hit = porStatus.get(lead.status_id);
  if (hit) return hit;
  if (lead.status_id === 142) return { pipeline: '(global)', pipeline_id: lead.pipeline_id, etapa: 'Ganado', orden: 9998, tipo: 1 };
  if (lead.status_id === 143) return { pipeline: '(global)', pipeline_id: lead.pipeline_id, etapa: 'Perdido', orden: 9999, tipo: 2 };
  return { pipeline: '(desconocido)', pipeline_id: lead.pipeline_id, etapa: `status ${lead.status_id}`, orden: 10000, tipo: 0 };
}

export function diaDe(unix) {
  const offsetH = Number(process.env.KOMMO_TZ_OFFSET || 0);
  return new Date((unix + offsetH * 3600) * 1000).toISOString().slice(0, 10);
}
