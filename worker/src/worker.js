/**
 * AI Demo Proxy - Cloudflare Worker
 *
 * Endpoints:
 *   POST /chat       - Proxied Anthropic API call (rate limited)
 *   POST /lead       - Email lead collection (KV stored)
 *   GET  /leads      - List collected leads (requires admin key)
 *   GET  /health     - Health check
 *
 * Secrets (set via `npx wrangler secret put`):
 *   ANTHROPIC_API_KEY  - Your Anthropic API key
 *   ADMIN_KEY          - Admin key for /leads endpoint
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Session-ID',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(origin, env) {
  // In production, lock to your domain. During dev, allow all.
  const allowed = env.ALLOWED_ORIGIN || '*';
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': allowed === '*' ? (origin || '*') : allowed,
  };
}

function json(data, status = 200, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, env) },
  });
}

// ─── RATE LIMITING ───

async function checkRateLimit(sessionId, env) {
  const key = `rate:${sessionId}`;
  const max = parseInt(env.MAX_MESSAGES_PER_SESSION || '20');
  const ttl = parseInt(env.SESSION_TTL_SECONDS || '3600');

  const current = await env.DEMO_KV.get(key);
  const count = current ? parseInt(current) : 0;

  if (count >= max) {
    return { allowed: false, remaining: 0, count };
  }

  await env.DEMO_KV.put(key, String(count + 1), { expirationTtl: ttl });
  return { allowed: true, remaining: max - count - 1, count: count + 1 };
}

// ─── CHAT PROXY ───

async function handleChat(request, env, origin) {
  const sessionId = request.headers.get('X-Session-ID');
  if (!sessionId) {
    return json({ error: { message: 'Missing X-Session-ID header' } }, 400, origin, env);
  }

  // Rate limit check
  const limit = await checkRateLimit(sessionId, env);
  if (!limit.allowed) {
    return json({
      error: { message: 'Session limit reached. Try again later or use your own API key.' }
    }, 429, origin, env);
  }

  // Parse request
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'Invalid JSON body' } }, 400, origin, env);
  }

  const { system, messages } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return json({ error: { message: 'Messages array required' } }, 400, origin, env);
  }

  // Sanitize: only pass role + content, strip anything else
  const cleanMessages = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content || '').slice(0, 4000),
  }));

  // Forward to Anthropic
  const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: String(system || 'You are a helpful assistant.').slice(0, 8000),
      messages: cleanMessages,
    }),
  });

  const data = await anthropicResponse.json();

  // Return response with rate limit info
  const response = json(data, anthropicResponse.status, origin, env);
  response.headers.set('X-RateLimit-Remaining', String(limit.remaining));
  return response;
}

// ─── EMAIL LEAD COLLECTION ───

async function handleLead(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin, env);
  }

  const { email } = body;

  if (!email || !email.includes('@') || email.length > 200) {
    return json({ error: 'Valid email required' }, 400, origin, env);
  }

  // Store in KV with timestamp
  const leadKey = `lead:${email.toLowerCase()}`;
  const existing = await env.DEMO_KV.get(leadKey);

  if (existing) {
    return json({ status: 'already_registered', message: 'Access already granted.' }, 200, origin, env);
  }

  const leadData = {
    email: email.toLowerCase(),
    timestamp: new Date().toISOString(),
    userAgent: request.headers.get('User-Agent') || 'unknown',
    country: request.cf?.country || 'unknown',
  };

  // Store lead (no expiration - keep forever)
  await env.DEMO_KV.put(leadKey, JSON.stringify(leadData));

  // Also add to the leads index for easy listing
  const indexKey = 'leads:index';
  const currentIndex = await env.DEMO_KV.get(indexKey);
  const index = currentIndex ? JSON.parse(currentIndex) : [];
  index.push({ email: email.toLowerCase(), timestamp: leadData.timestamp });
  await env.DEMO_KV.put(indexKey, JSON.stringify(index));

  return json({
    status: 'success',
    message: 'Access granted. Architecture details sent to your email.',
  }, 200, origin, env);
}

// ─── ADMIN: LIST LEADS ───

async function handleListLeads(request, env, origin) {
  const adminKey = new URL(request.url).searchParams.get('key');

  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return json({ error: 'Unauthorized' }, 401, origin, env);
  }

  const indexKey = 'leads:index';
  const currentIndex = await env.DEMO_KV.get(indexKey);
  const leads = currentIndex ? JSON.parse(currentIndex) : [];

  return json({ count: leads.length, leads }, 200, origin, env);
}

// ─── ROUTER ───

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }

    // Routes
    switch (url.pathname) {
      case '/chat':
        if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin, env);
        return handleChat(request, env, origin);

      case '/lead':
        if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin, env);
        return handleLead(request, env, origin);

      case '/leads':
        if (request.method !== 'GET') return json({ error: 'GET only' }, 405, origin, env);
        return handleListLeads(request, env, origin);

      case '/health':
        return json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          model: 'claude-sonnet-4-20250514',
        }, 200, origin, env);

      default:
        return json({ error: 'Not found' }, 404, origin, env);
    }
  },
};
