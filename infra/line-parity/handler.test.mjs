import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { createHandler } from './handler.mjs'

const TOKEN = 't'.repeat(32), SECRET = 'channel-secret-for-test', UID = 'U' + 'a'.repeat(32)
const lines = []
const server = createServer(createHandler({ PARITY_TOKEN: TOKEN, LINE_CHANNEL_SECRET: SECRET, LIFF_ID: '1234-abcd' }, (l) => lines.push(l)))
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`
const sign = (b) => createHmac('sha256', SECRET).update(b).digest('base64')
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', body, headers })

test('webhook: bad or missing signature records nothing', async () => {
  const body = JSON.stringify({ events: [{ type: 'message', source: { userId: UID }, message: { text: 'secret words' } }] })
  assert.equal((await post(`/hook/${TOKEN}`, body)).status, 401)
  assert.equal((await post(`/hook/${TOKEN}`, body, { 'x-line-signature': 'nope' })).status, 401)
  assert.equal(lines.length, 0)
})
test('webhook: wrong path token is a 404', async () => {
  const body = '{"events":[]}'
  assert.equal((await post(`/hook/${'x'.repeat(32)}`, body, { 'x-line-signature': sign(body) })).status, 404)
})
test('webhook: records the user id and event type, never message text', async () => {
  const body = JSON.stringify({ events: [{ type: 'message', source: { userId: UID }, message: { text: 'secret words' } }] })
  assert.equal((await post(`/hook/${TOKEN}`, body, { 'x-line-signature': sign(body) })).status, 200)
  assert.equal(lines.length, 1)
  assert.deepEqual(Object.keys(lines[0]).sort(), ['at', 'eventType', 'id', 'kind'])
  assert.ok(!JSON.stringify(lines).includes('secret words'))
})
test('the console Verify call (no events) is answered 200', async () => {
  const body = '{"events":[]}'
  assert.equal((await post(`/hook/${TOKEN}`, body, { 'x-line-signature': sign(body) })).status, 200)
})
test('login sub is validated, and the result shows a match', async () => {
  assert.equal((await post(`/id/${TOKEN}`, JSON.stringify({ sub: 'not an id' }))).status, 400)
  assert.equal((await post(`/id/${TOKEN}`, JSON.stringify({ sub: UID }))).status, 200)
  const r = await (await fetch(`${base}/result/${TOKEN}`)).json()
  assert.deepEqual(r, { loginSub: [UID], webhookUserId: [UID], match: true })
})
test('the page needs the token, is served with it, and holds the LIFF id', async () => {
  assert.equal((await fetch(`${base}/c/parity`)).status, 404)
  assert.equal((await fetch(`${base}/c/parity/${'x'.repeat(32)}`)).status, 404)
  const html = await (await fetch(`${base}/c/parity/${TOKEN}`)).text()
  assert.ok(html.includes('1234-abcd'))
})
test.after(() => server.close())
