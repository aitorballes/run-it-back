// Importa historiales de manos en la cuenta del usuario que llama (GrindSet al acabar un torneo).
// Usa la misma lógica que la web (src/lib/importer.js), que `npm run deploy:functions` copia a
// ../_shared antes de desplegar. Las consultas van con el token del usuario, así que las
// políticas RLS se aplican igual que en la web.
//
// POST { files: [{ name, text }], summaries?: [{ tournamentId, finishPosition, players, ... }] }
//   → { saved, updated, summariesUpdated, platform, tournaments: [{ dbId, tournamentId, name, hands, created }] }

import { createClient } from 'npm:@supabase/supabase-js@2.99.3'
import { importHandHistories } from '../_shared/importer.js'

const MAX_BYTES = 20 * 1024 * 1024

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authorization = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser(authorization.replace(/^Bearer /, ''))
  if (authError || !user) return json({ error: 'unauthorized' }, 401)

  let body: { files?: { name?: string, text?: string }[], summaries?: Record<string, unknown>[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const texts = (body.files ?? []).map(file => file.text).filter((text): text is string => typeof text === 'string')
  const summaries = (body.summaries ?? []).filter(summary => summary && typeof summary.tournamentId === 'string')
  if (!texts.length && !summaries.length) return json({ error: 'no_files' }, 400)
  if (texts.reduce((size, text) => size + text.length, 0) > MAX_BYTES) return json({ error: 'too_large' }, 413)

  try {
    return json(await importHandHistories(supabase, user.id, texts, { extraSummaries: summaries }))
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
