// Vercel adapter. Project root directory: infra/line-parity. The rewrite in vercel.json sends every path here.
// Not tested on Vercel itself, only through handler.mjs on a local server.
import { createHandler } from '../handler.mjs'

export const config = { api: { bodyParser: false } }   // the signature needs the raw bytes
const handle = createHandler(process.env)
export default (req, res) => handle(req, res)
