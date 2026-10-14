import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  getPipelines,
  getLeadCustomFields,
  getLeads,
  buildStageIndex,
  nombreEtapa,
  diaDe,
} from './kommo.js';

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fallo = (e) => ({ isError: true, content: [{ type: 'text', text: String(e?.message || e) }] });

function construirServidor() {
  const server = new McpServer({ name: 'kommo-embudo', version: '1.0.0' });

  server.registerTool(
    'kommo_list_pipelines',
    {
      title: 'Listar pipelines y etapas',
      description:
        'Devuelve todos los pipelines (embudos) de la cuenta de Kommo con sus etapas en orden. Úsalo primero para saber cómo está organizada la cuenta y qué pipeline corresponde a cada cliente.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await getPipelines());
      } catch (e) {
        return fallo(e);
      }
    }
  );

  server.registerTool(
    'kommo_list_custom_fields',
    {
      title: 'Listar campos personalizados de leads',
      description:
        'Campos personalizados de los leads, con sus opciones. Sirve para localizar el campo que identifica al cliente, la promoción o el origen del lead cuando no hay un pipeline por cliente.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await getLeadCustomFields());
      } catch (e) {
        return fallo(e);
      }
    }
  );

  server.registerTool(
    'kommo_funnel',
    {
      title: 'Embudo por etapa',
      description:
        'Recuento de leads por pipeline y etapa, filtrando por fecha de creación del lead. Devuelve una fila por etapa con el número de leads y el importe acumulado. Es la fuente del embudo del dashboard.',
      inputSchema: {
        desde: z.string().describe('Fecha inicial YYYY-MM-DD (fecha de creación del lead)'),
        hasta: z.string().describe('Fecha final YYYY-MM-DD, incluida'),
        pipeline_id: z.number().optional().describe('Limitar a un pipeline concreto'),
      },
    },
    async ({ desde, hasta, pipeline_id }) => {
      try {
        const { porStatus } = await buildStageIndex();
        const { leads, truncado } = await getLeads({ desde, hasta, pipeline_id });
        const acc = new Map();
        for (const lead of leads) {
          const info = nombreEtapa(porStatus, lead);
          const clave = `${info.pipeline_id}|${lead.status_id}`;
          const fila = acc.get(clave) || {
            pipeline: info.pipeline,
            pipeline_id: info.pipeline_id,
            etapa: info.etapa,
            status_id: lead.status_id,
            orden: info.orden,
            leads: 0,
            importe: 0,
          };
          fila.leads += 1;
          fila.importe += Number(lead.price || 0);
          acc.set(clave, fila);
        }
        const filas = [...acc.values()].sort(
          (a, b) => a.pipeline.localeCompare(b.pipeline) || a.orden - b.orden
        );
        return ok({ desde, hasta, total_leads: leads.length, truncado, filas });
      } catch (e) {
        return fallo(e);
      }
    }
  );

  server.registerTool(
    'kommo_leads_por_dia',
    {
      title: 'Leads por día',
      description:
        'Leads creados por día y pipeline en un rango de fechas. Pensado para cruzarse con la inversión diaria de Meta y calcular el coste por lead real que llega al CRM.',
      inputSchema: {
        desde: z.string().describe('Fecha inicial YYYY-MM-DD'),
        hasta: z.string().describe('Fecha final YYYY-MM-DD, incluida'),
        pipeline_id: z.number().optional().describe('Limitar a un pipeline concreto'),
      },
    },
    async ({ desde, hasta, pipeline_id }) => {
      try {
        const { porStatus } = await buildStageIndex();
        const { leads, truncado } = await getLeads({ desde, hasta, pipeline_id });
        const acc = new Map();
        for (const lead of leads) {
          const info = nombreEtapa(porStatus, lead);
          const dia = diaDe(lead.created_at);
          const clave = `${dia}|${info.pipeline_id}`;
          const fila = acc.get(clave) || {
            dia,
            pipeline: info.pipeline,
            pipeline_id: info.pipeline_id,
            leads: 0,
          };
          fila.leads += 1;
          acc.set(clave, fila);
        }
        const filas = [...acc.values()].sort(
          (a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : a.pipeline.localeCompare(b.pipeline))
        );
        return ok({ desde, hasta, total_leads: leads.length, truncado, filas });
      } catch (e) {
        return fallo(e);
      }
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

const SECRETO = process.env.MCP_PATH_SECRET || '';
const RUTA = SECRETO ? `/mcp/${SECRETO}` : '/mcp';

app.get('/', (_req, res) => res.status(200).send('kommo-mcp en marcha'));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post(RUTA, async (req, res) => {
  const server = construirServidor();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e?.message || e) });
  }
});

// En modo sin sesión no hay stream de servidor ni sesión que cerrar.
app.get(RUTA, (_req, res) => res.status(405).json({ error: 'Method not allowed' }));
app.delete(RUTA, (_req, res) => res.status(405).json({ error: 'Method not allowed' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`kommo-mcp escuchando en ${PORT}, ruta MCP: ${SECRETO ? '/mcp/<MCP_PATH_SECRET>' : '/mcp'}`);
});

export default app;
