// Throwaway receiver for F02-T00 (design Q33): does the LINE Login `sub` equal the Messaging API `source.userId`?
// Records only user IDs and event types. Never message text, names or pictures. Delete it after the check.
//
// Routes (TOKEN is a long random path value, PARITY_TOKEN):
//   GET  /c/parity/TOKEN      the LIFF page (the token is in the endpoint URL, so only the test user can open it): signs in, shows the Login `sub`, posts it to /id/TOKEN
//   POST /id/TOKEN            { "sub": "U..." } from that page
//   POST /hook/TOKEN          the Messaging API webhook; x-line-signature is verified with LINE_CHANNEL_SECRET
//   GET  /result/TOKEN        what was recorded and whether the IDs match
import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_BODY = 64 * 1024
const LINE_ID = /^U[0-9a-f]{32}$/

const safeEqual = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function createHandler(env, log = (line) => console.log(JSON.stringify(line))) {
  const { PARITY_TOKEN, LINE_CHANNEL_SECRET, LIFF_ID } = env
  if (!PARITY_TOKEN || PARITY_TOKEN.length < 24) throw new Error('PARITY_TOKEN must be at least 24 characters')
  if (!LINE_CHANNEL_SECRET) throw new Error('LINE_CHANNEL_SECRET is required')
  const seen = { loginSub: new Set(), webhookUserId: new Set() }

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  const tokenOk = (given) => typeof given === 'string' && safeEqual(given, PARITY_TOKEN)

  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname
    const [, a, b] = path.split('/')
    try {
      if (req.method === 'GET' && path.startsWith('/c/parity/') && tokenOk(path.split('/')[3])) return send(res, 200, page(LIFF_ID, PARITY_TOKEN), 'text/html; charset=utf-8')

      if (req.method === 'GET' && a === 'result' && tokenOk(b)) {
        const login = [...seen.loginSub], hook = [...seen.webhookUserId]
        return send(res, 200, { loginSub: login, webhookUserId: hook, match: login.length > 0 && login.every((id) => hook.includes(id)) })
      }

      if (req.method === 'POST' && a === 'id' && tokenOk(b)) {
        const { sub } = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        if (typeof sub !== 'string' || !LINE_ID.test(sub)) return send(res, 400, { error: 'bad_sub' })
        seen.loginSub.add(sub); log({ at: new Date().toISOString(), kind: 'login_sub', id: sub })
        return send(res, 200, { ok: true })
      }

      if (req.method === 'POST' && a === 'hook' && tokenOk(b)) {
        const raw = await readBody(req)
        const expected = createHmac('sha256', LINE_CHANNEL_SECRET).update(raw).digest('base64')
        const given = req.headers['x-line-signature']
        if (typeof given !== 'string' || !safeEqual(given, expected)) return send(res, 401, { error: 'bad_signature' })
        const events = JSON.parse(raw.toString('utf8') || '{}').events ?? []
        for (const ev of events) {
          const id = ev?.source?.userId
          if (typeof id === 'string' && LINE_ID.test(id)) {
            seen.webhookUserId.add(id)
            log({ at: new Date().toISOString(), kind: 'webhook_user_id', id, eventType: String(ev.type).slice(0, 32) })
          }
        }
        return send(res, 200, { ok: true })   // also answers the console's Verify button (no events)
      }
      return send(res, 404, { error: 'not_found' })
    } catch (e) {
      return send(res, e.message === 'too large' ? 413 : 400, { error: 'bad_request' })
    }
  }
}

// Shown only to the one test user. Not product text.
function page(liffId, token) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>parity check</title><pre id="out">starting</pre>
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<script>
(async () => {
  const out = document.getElementById('out')
  try {
    await liff.init({ liffId: ${JSON.stringify(liffId ?? '')} })
    if (!liff.isLoggedIn()) { liff.login(); return }
    const sub = JSON.parse(atob(liff.getIDToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub
    const r = await fetch('/id/${token}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub }) })
    out.textContent = 'login sub: ' + sub + '\\nrecorded: ' + r.status
  } catch (e) { out.textContent = 'error: ' + e.message }
})()
</script>`
}
