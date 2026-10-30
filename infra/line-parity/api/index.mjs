// Vercel adapter. Project root directory: infra/line-parity. The rewrite in vercel.json sends every path here.
// Not tested on Vercel itself, only through handler.mjs on a local server.
import { createHandler } from '../handler.mjs'

export const config = { api: { bodyParser: false } }   // the signature needs the raw bytes
// The LIFF ID is not secret; it falls back to the BOOQ test provider's LIFF app when the project variable is unset.
const handle = createHandler({ ...process.env, LIFF_ID: process.env.LIFF_ID || '2012300015-WIi1jtLB' })
export default (req, res) => handle(req, res)
