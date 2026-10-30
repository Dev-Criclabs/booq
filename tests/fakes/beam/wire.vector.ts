// Test vector published in Beam's webhook authentication page (docs.beamcheckout.com/webhook-authentication).
// The page shows the header value and the base64 key; the full raw body there starts {"chargeId":"ch_30GtUweMWec7r2hHIsV5xxQeJKp",...}.
// To make the check executable, paste the exact body from that page into BODY. It is left empty on purpose:
// the body was only read in part, and a guessed body would make a false pass.
export const DOC_VECTOR = {
  keyBase64: 'KOFELguf5L1ltuDlkDHGUkPPnQhrgYYijTR4Fqh7APc=',
  expectedSignature: '1XzWtJHZ9Y1tmjkA/XZUIn1ZHrUQp1d0Ms0oDQfJBto=',
  BODY: '' as string,
};
