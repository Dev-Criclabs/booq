// node infra/line-parity/server.mjs   (needs PARITY_TOKEN, LINE_CHANNEL_SECRET, LIFF_ID; PORT optional)
// Put it behind any HTTPS front. LINE needs https for the LIFF endpoint and the webhook.
import { createServer } from 'node:http'
import { createHandler } from './handler.mjs'

createServer(createHandler(process.env)).listen(Number(process.env.PORT ?? 8787), () => console.log('line-parity listening'))
