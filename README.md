# kommo-mcp

Servidor MCP que expone el embudo de Kommo como conector para Claude. Una vez desplegado y
añadido como conector personalizado en claude.ai, el dashboard de paid media puede consultar el
embudo en vivo igual que consulta Meta Ads.

## Antes de nada: el token

**Si el token que vas a usar ha pasado alguna vez por un chat, un email, un Slack o un commit,
revócalo y genera uno nuevo.** El token de larga duración de Kommo lleva el scope `crm`, que es
lectura y escritura sobre todos tus leads.

Se genera en Kommo → Ajustes → Integraciones → tu integración → Token de larga duración.

El token **no va nunca en este repositorio**. Va en las variables de entorno del sitio donde
despliegues. El `.gitignore` ya excluye `.env`.

## Qué expone

| Herramienta | Para qué |
|---|---|
| `kommo_list_pipelines` | Todos los pipelines con sus etapas en orden. Lo primero que hay que llamar: dice cómo está organizada la cuenta. |
| `kommo_list_custom_fields` | Campos personalizados de leads, con sus opciones. Sirve para localizar el campo que identifica cliente, promoción u origen. |
| `kommo_funnel` | Recuento de leads por pipeline y etapa en un rango de fechas, con importe acumulado. Es la fuente del embudo del dashboard. |
| `kommo_leads_por_dia` | Leads creados por día y pipeline. Pensado para cruzar con la inversión diaria de Meta. |

Todas son de solo lectura: este servidor no escribe nada en Kommo.

## Variables de entorno

| Variable | Obligatoria | Qué es |
|---|---|---|
| `KOMMO_SUBDOMAIN` | sí | Si entras por `https://miempresa.kommo.com`, es `miempresa`. |
| `KOMMO_TOKEN` | sí | El token de larga duración. |
| `MCP_PATH_SECRET` | muy recomendable | Segmento secreto de la URL. Sin él la ruta es `/mcp` y queda abierta. |
| `KOMMO_TZ_OFFSET` | no | Horas de desfase para agrupar por día. España peninsular: `2` en verano, `1` en invierno. Por defecto `0`. |
| `KOMMO_MAX_PAGES` | no | Tope de páginas de 250 leads por consulta. Por defecto `40` (10.000 leads). |
| `KOMMO_BASE_URL` | no | Solo si tu cuenta no está en `{subdominio}.kommo.com`. |

Genera el secreto de la ruta con:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## Desplegar

### Railway (lo más directo)

1. Sube este repo a GitHub.
2. En Railway: New Project → Deploy from GitHub repo → elige el repo.
3. Variables → añade `KOMMO_SUBDOMAIN`, `KOMMO_TOKEN`, `MCP_PATH_SECRET`, `KOMMO_TZ_OFFSET`.
4. Settings → Networking → Generate Domain.
5. Comprueba que responde: `https://tu-dominio.up.railway.app/health` debe devolver `{"ok":true}`.

### Vercel

1. Sube el repo a GitHub e impórtalo en Vercel.
2. Settings → Environment Variables → las mismas cuatro.
3. Deploy. El `vercel.json` ya enruta todo a `src/server.js`.

Nota: en Vercel cada petición arranca una función nueva. Funciona porque el servidor es sin
estado, pero si una consulta tarda mucho (rangos de fechas largos con muchos leads) puedes
chocar con el límite de duración del plan. Railway no tiene ese problema.

## Añadirlo en Claude

En claude.ai → Ajustes → Conectores → Añadir conector personalizado, con la URL:

```
https://tu-dominio/mcp/<MCP_PATH_SECRET>
```

Después, en una conversación, activa el conector y pide "lista mis pipelines de Kommo" para
comprobar que responde.

## Sobre la seguridad de esto

El secreto en la URL es una barrera razonable para un servicio personal, pero es solo eso: quien
tenga la URL completa puede leer tus leads. No la pegues en sitios públicos. Si quieres algo más
sólido, el paso siguiente es poner OAuth delante, y entonces el conector pide login en vez de
confiar en la URL.

El servidor solo implementa lecturas, así que aunque la URL se filtre nadie puede modificar ni
borrar nada en tu CRM con ella. El token sí puede: por eso vive solo en las variables de entorno.

## En local

```bash
cp .env.example .env    # rellena KOMMO_SUBDOMAIN, KOMMO_TOKEN y MCP_PATH_SECRET
npm install
npm start
```

Prueba rápida del handshake:

```bash
curl -s -X POST http://127.0.0.1:3000/mcp/<MCP_PATH_SECRET> \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
