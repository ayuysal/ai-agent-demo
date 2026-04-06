# AI Demo Proxy - Deployment Guide

## Voraussetzungen
- Node.js 18+
- Cloudflare Account (gratis: https://dash.cloudflare.com/sign-up)

## Setup (5 Minuten)

### 1. Cloudflare Account erstellen & Wrangler einrichten

```bash
cd ai-demo-worker
npm install
npx wrangler login
```

### 2. KV Namespace erstellen

```bash
npx wrangler kv namespace create DEMO_KV
```

Die Ausgabe zeigt eine ID wie: `id = "abc123..."`.
Kopiere diese ID in `wrangler.toml` bei `id = "YOUR_KV_NAMESPACE_ID"`.

### 3. Secrets setzen

```bash
# Dein Anthropic API Key
npx wrangler secret put ANTHROPIC_API_KEY
# Eingabe: sk-ant-...

# Admin Key zum Leads abrufen (beliebiger sicherer String)
npx wrangler secret put ADMIN_KEY
# Eingabe: z.B. mein-geheimer-admin-key-2024
```

### 4. Domain konfigurieren

In `wrangler.toml` die `ALLOWED_ORIGIN` auf deine Demo-Domain setzen:
```toml
ALLOWED_ORIGIN = "https://deine-demo.netlify.app"
```

Waehrend der Entwicklung auf `*` lassen.

### 5. Deployen

```bash
npm run deploy
```

Die Ausgabe zeigt die Worker-URL, z.B.:
`https://ai-demo-proxy.dein-subdomain.workers.dev`

### 6. Demo-HTML aktualisieren

In `ai-agent-demo.html` die Zeile:
```js
const PROXY_URL = 'YOUR_WORKER_URL';
```
ersetzen mit:
```js
const PROXY_URL = 'https://ai-demo-proxy.dein-subdomain.workers.dev';
```

## Endpoints

| Endpoint | Method | Beschreibung |
|----------|--------|-------------|
| `/chat` | POST | Proxied Chat (rate limited, 20/Session) |
| `/lead` | POST | Email-Lead speichern |
| `/leads?key=ADMIN_KEY` | GET | Alle Leads abrufen |
| `/health` | GET | Status-Check |

## Leads abrufen

```bash
curl https://ai-demo-proxy.dein-subdomain.workers.dev/leads?key=DEIN_ADMIN_KEY
```

## Lokale Entwicklung

```bash
npm run dev
```

Startet den Worker lokal auf `http://localhost:8787`.

## Kosten

- **Cloudflare Workers Free Tier**: 100.000 Requests/Tag
- **KV Free Tier**: 100.000 Reads/Tag, 1.000 Writes/Tag
- **Anthropic**: Abhaengig von Nutzung (Sonnet 4: ~$0.03 Input, ~$0.15 Output pro 1M Tokens)
- **Geschaetzt bei 50 Demo-Besuchern/Tag**: ~$0.50-1.00/Tag Anthropic-Kosten
