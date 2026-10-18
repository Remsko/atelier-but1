// Atelier BUT 1 — fonction « ia »
// Relais vers l'IA : Claude (clé « sk-ant-… »), OpenAI ou Mistral.
// Claude : Haiku pour le quotidien, Sonnet automatiquement pour la SAE, la lecture des sujets et les demandes difficiles.
// La clé de l'IA reste ici (secret IA_API_KEY), jamais dans le navigateur. Quota quotidien par compte (IA_DAILY_LIMIT, 80).
// Chaque demande à Claude enregistre ses tokens et son coût (table ia_cost) : Administration → Consommation.

const URL_ = Deno.env.get('SUPABASE_URL')!;
const pickKey = (legacy: string, dict: string) => {
  const v = Deno.env.get(legacy); if (v) return v;
  try { const d = JSON.parse(Deno.env.get(dict) || '{}'); return d.default || Object.values(d)[0] as string || ''; } catch { return ''; }
};
const ANON = pickKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const SERVICE = pickKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
const IA_KEY = Deno.env.get('IA_API_KEY') || '';
const IA_BASE = (Deno.env.get('IA_BASE_URL') || (IA_KEY.startsWith('sk-ant-') ? 'https://api.anthropic.com/v1' : 'https://api.mistral.ai/v1')).replace(/\/$/, '');
const ANTHROPIC = /anthropic/.test(IA_BASE) || Deno.env.get('IA_PROVIDER') === 'anthropic';
const OPENAI = /openai\.com/.test(IA_BASE);
const MODEL_DEFAULT = Deno.env.get('IA_MODEL') || (ANTHROPIC ? 'claude-haiku-5-5' : OPENAI ? 'gpt-4o-mini' : 'mistral-medium-latest');
const MODEL_QUICK = Deno.env.get('IA_MODEL_QUICK') || (ANTHROPIC ? 'claude-haiku-5-5' : Deno.env.get('IA_MODEL') || (OPENAI ? 'gpt-4o-mini' : 'mistral-small-latest'));
const DAILY = +(Deno.env.get('IA_DAILY_LIMIT') || 80);
const MODEL_EXPERT = Deno.env.get('IA_MODEL_EXPERT') || (ANTHROPIC ? 'claude-sonnet-5-5' : '');
const EXPERT_DAILY = +(Deno.env.get('IA_EXPERT_DAILY') || 0); // 0 = pas de limite
// demandes envoyées à Sonnet : SAE, lecture/découpage des sujets, arbres, récursivité, pointeurs, complexité, corrections complètes, preuves
const HARD = /\bsa[éeÉE](?![a-zà-ÿ])|situation d'apprentissage|voici le sujet d'un TP|d[ée]coup|\barbres?\b|r[ée]cursi|pointeur|complexit[ée]|preuve|d[ée]monstration|correction (compl[èe]te|autoris[ée]e)|corrige (tous|toutes|l'exercice)|montre(-moi)? la correction|jeux d'essai|requ[êe]te de preuve/i;

// ---------- tarifs (dollars par million de tokens) ----------
// Source : platform.claude.com/docs/en/about-claude/pricing (octobre 2026). Modifiables avec le secret IA_PRICES (même format JSON).
// Haiku 5.5 : tarif plus élevé quand la demande dépasse 100 000 tokens en entrée (« long »).
// Écriture du cache : non indiquée sur la page des tarifs, comptée ici comme l'entrée × 1,25 (règle habituelle de Claude).
type Price = { in: number; out: number; cacheRead: number; cacheWrite?: number; longFrom?: number; long?: { in: number; out: number; cacheRead: number } };
const PRICES: Record<string, Price> = Object.assign({
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cacheRead: 0.01, longFrom: 100000, long: { in: 0.50, out: 2.50, cacheRead: 0.05 } },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.10 },
}, (() => { try { return JSON.parse(Deno.env.get('IA_PRICES') || '{}'); } catch { return {}; } })());
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
function costOf(model: string, u: Usage): number {
  const p = PRICES[model] || Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1];
  if (!p) return 0;
  const inp = u.input_tokens || 0, out = u.output_tokens || 0, cr = u.cache_read_input_tokens || 0, cw = u.cache_creation_input_tokens || 0;
  const big = p.longFrom && p.long && inp + cr + cw > p.longFrom;
  const r = big ? { ...p, ...p.long } : p;
  return (inp * r.in + out * r.out + cr * r.cacheRead + cw * (p.cacheWrite ?? r.in * 1.25)) / 1e6;
}
// enregistre une demande : +1 demande, + tokens, + coût, par personne, par jour et par modèle
async function record(owner: string, model: string, u: Usage) {
  try {
    await fetch(URL_ + '/rest/v1/rpc/ia_record', { method: 'POST', headers: svcHeaders(), body: JSON.stringify({
      p_owner: owner, p_model: model, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0,
      p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0, p_cost: costOf(model, u) }) });
  } catch { /* le suivi ne doit jamais bloquer la réponse */ }
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: string | { url: string } };
type Msg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

function needsExpert(b: any, msgs: Msg[]): boolean {
  if (b.tier === 'quick') return false;
  const last = [...msgs].reverse().find(m => m.role === 'user');
  if (!last) return false;
  const text = typeof last.content === 'string' ? last.content : last.content.map(p => p.type === 'text' ? p.text : '').join('\n');
  // on ignore les règles du tuteur (avant le premier « ### ») et le code (blocs ```) : restent le sujet et la demande
  const i = text.indexOf('\n### ');
  const utile = (i >= 0 ? text.slice(i) : text).replace(/```[\s\S]*?```/g, ' ');
  return HARD.test(utile) || (!!b.json && text.length > 6000);
}
const MAX_CHARS = 120000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (code: string, message: string, status = 400) => json({ error: { code, message } }, status);
const svcHeaders = () => ({ apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json' });

async function callIA(body: Record<string, unknown>, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(IA_BASE + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + IA_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.status === 429 && i < tries - 1) { await new Promise(res => setTimeout(res, 1200 * (i + 1))); continue; }
    return r;
  }
}

/* ---------- Claude (API Messages d'Anthropic) ---------- */
function toAnthropic(msgs: Msg[]) {
  const system = msgs.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? p.text : '').join('\n')).join('\n\n');
  const out: { role: string; content: unknown[] }[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    const parts = (typeof m.content === 'string' ? [{ type: 'text', text: m.content } as Part] : m.content).map(p => {
      if (p.type === 'text') return { type: 'text', text: p.text || ' ' };
      const url = typeof p.image_url === 'string' ? p.image_url : p.image_url.url;
      const mm = /^data:([^;]+);base64,(.*)$/s.exec(url);
      return mm ? { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } } : { type: 'text', text: '' };
    }).filter(p => p.type !== 'text' || (p as { text: string }).text);
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...parts); else out.push({ role: m.role, content: parts });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return { system, messages: out };
}
async function callAnthropic(model: string, msgs: Msg[], maxTok: number, stream: boolean, tries = 3): Promise<Response> {
  const { system, messages } = toAnthropic(msgs);
  for (let i = 0; ; i++) {
    const r = await fetch(IA_BASE + '/messages', {
      method: 'POST',
      headers: { 'x-api-key': IA_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTok, system: system || undefined, messages, stream: stream || undefined }),
    });
    if ((r.status === 429 || r.status === 529) && i < tries - 1) { await new Promise(res => setTimeout(res, 1500 * (i + 1))); continue; }
    return r;
  }
}
// flux Claude → format « data: {choices:[{delta:{content}}]} » ; relève au passage les tokens (message_start / message_delta)
function anthropicStreamToOpenAI(body: ReadableStream<Uint8Array>, onUsage: (u: Usage) => Promise<void>) {
  const enc = new TextEncoder(), dec = new TextDecoder(); let buf = '';
  const usage: Usage = {};
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const e = JSON.parse(line.slice(5));
          if (e.type === 'message_start' && e.message?.usage) Object.assign(usage, e.message.usage);
          if (e.type === 'message_delta' && e.usage) Object.assign(usage, e.usage);
          if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') ctl.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: e.delta.text } }] }) + '\n\n'));
          else if (e.type === 'message_delta' && e.delta?.stop_reason) ctl.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: e.delta.stop_reason === 'max_tokens' ? 'length' : 'stop' }] }) + '\n\n'));
        } catch { /* ligne incomplète */ }
      }
    },
    async flush(ctl) { ctl.enqueue(enc.encode('data: [DONE]\n\n')); await onUsage(usage); },
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!IA_KEY) return fail('not_configured', 'l\'IA n\'est pas encore configurée (secret IA_API_KEY)', 503);
  const auth = req.headers.get('Authorization') || '';
  const who = await fetch(URL_ + '/auth/v1/user', { headers: { Authorization: auth, apikey: ANON } });
  if (!who.ok) return fail('session_expired', 'non connecté', 401);
  const user = await who.json();

  let b: any;
  try { b = await req.json(); } catch { return fail('invalid_request', 'requête illisible'); }

  if (b.action === 'usage') {
    const r = await fetch(URL_ + '/rest/v1/ia_usage?select=count,expert&day=eq.' + new Date().toISOString().slice(0, 10) + '&owner=eq.' + user.id, { headers: svcHeaders() });
    const rows = r.ok ? await r.json() : [];
    return json({ used: rows[0]?.count || 0, limit: DAILY, model: MODEL_DEFAULT + (MODEL_EXPERT ? ' (+ ' + MODEL_EXPERT + ' pour la SAE, la lecture des sujets et les demandes difficiles)' : ''), expertUsed: rows[0]?.expert || 0, expertLimit: EXPERT_DAILY });
  }

  const msgs: Msg[] = Array.isArray(b.messages) ? b.messages : [];
  if (!msgs.length) return fail('invalid_request', 'message vide');
  const size = JSON.stringify(msgs).replace(/data:image\/[^"]+/g, '').length;
  if (size > MAX_CHARS) return fail('prompt_too_large', 'demande trop longue', 413);

  const q = await fetch(URL_ + '/rest/v1/rpc/ia_take', { method: 'POST', headers: svcHeaders(), body: JSON.stringify({ p_owner: user.id }) });
  const used = q.ok ? await q.json() : 0;
  if (typeof used === 'number' && used > DAILY) return fail('rate_limited', 'tu as utilisé tes ' + DAILY + ' demandes à l\'IA pour aujourd\'hui : reviens demain (ou utilise « Continuer sur Claude »)', 429);

  if (ANTHROPIC) {
    let model = b.tier === 'quick' ? MODEL_QUICK : MODEL_DEFAULT;
    if (MODEL_EXPERT && MODEL_EXPERT !== model && needsExpert(b, msgs)) {
      if (!EXPERT_DAILY) model = MODEL_EXPERT;
      else {
        const e = await fetch(URL_ + '/rest/v1/rpc/ia_take_expert', { method: 'POST', headers: svcHeaders(), body: JSON.stringify({ p_owner: user.id }) });
        const n = e.ok ? await e.json() : EXPERT_DAILY + 1;
        if (typeof n === 'number' && n <= EXPERT_DAILY) model = MODEL_EXPERT;
      }
    }
    const stream = !!(b.stream && !b.json);
    let r: Response;
    try { r = await callAnthropic(model, msgs, Math.min(+b.maxTokens || (b.json ? 8000 : 2500), 16000), stream); } catch { return fail('server_unavailable', 'l\'IA ne répond pas', 504); }
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 429 || r.status === 529) return fail('rate_limited', 'l\'IA est très demandée en ce moment : réessaie dans une minute', 429);
      if (r.status === 401 || r.status === 403) return fail('not_configured', 'clé de l\'API Claude refusée', 503);
      if (/credit balance/i.test(t)) return fail('not_configured', 'plus de crédit sur le compte de l\'API Claude : l\'admin doit en rajouter', 503);
      if (/prompt is too long|too many tokens/i.test(t)) return fail('prompt_too_large', 'demande trop longue', 413);
      if (/model/i.test(t) && r.status === 404) return fail('not_configured', 'modèle inconnu : vérifie le secret IA_MODEL', 503);
      if (/image/i.test(t) && r.status === 400) return fail('image_rejected', 'images refusées par le modèle', 400);
      return fail('server_error', 'erreur de l\'IA (' + r.status + ')', 502);
    }
    if (stream) return new Response(anthropicStreamToOpenAI(r.body!, u => record(user.id, model, u)), { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-IA-Model': model, 'Access-Control-Expose-Headers': 'X-IA-Model' } });
    const j = await r.json();
    await record(user.id, model, j.usage || {});
    const text = (j.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
    return json({ text, truncated: j.stop_reason === 'max_tokens', used, limit: DAILY, model });
  }

  const body: Record<string, unknown> = {
    model: b.tier === 'quick' ? MODEL_QUICK : MODEL_DEFAULT,
    messages: msgs,
  };
  const maxTok = Math.min(+b.maxTokens || (b.json ? 8000 : 2500), 16000);
  if (OPENAI) body.max_completion_tokens = maxTok * 3;
  else { body.max_tokens = maxTok; body.temperature = b.json ? 0.2 : 0.4; }
  if (b.json) body.response_format = { type: 'json_object' };
  if (b.stream && !b.json) body.stream = true;

  let r: Response;
  try { r = await callIA(body); } catch { return fail('server_unavailable', 'l\'IA ne répond pas', 504); }
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 429) return fail('rate_limited', 'l\'IA est très demandée en ce moment : réessaie dans une minute', 429);
    if (r.status === 401 || r.status === 403) return fail('not_configured', 'clé de l\'IA refusée', 503);
    if (/too (long|large)|context length|maximum.*tokens/i.test(t)) return fail('prompt_too_large', 'demande trop longue', 413);
    if (/model/i.test(t) && /not.*(exist|found)|does not exist|invalid model/i.test(t)) return fail('not_configured', 'modèle inconnu : vérifie le secret IA_MODEL', 503);
    if (/image/i.test(t) && r.status === 400) return fail('image_rejected', 'images refusées par le modèle', 400);
    return fail('server_error', 'erreur de l\'IA (' + r.status + ')', 502);
  }
  if (body.stream) return new Response(r.body, { headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } });
  const j = await r.json();
  const c = j.choices?.[0];
  return json({ text: c?.message?.content || '', truncated: c?.finish_reason === 'length', used, limit: DAILY });
});
