-- F13-T04 / migration 0703: the F13 payment port. Requirements: RCPT-01-AC6, R4, D37, D74, D79, D112.
-- app.apply_payment, app.take_cash and the wrong amount credit reach the receipt through the registry (0404), not by name:
-- issue_receipt(order, payment, kind) returns uuid, kind `order` (the sale) or `wallet_credit` (late, duplicate and wrong amount
-- money). F13 edits no other feature's code: it only fills its row, as F06 did in 0511. A refund to the wallet never comes this
-- way, so it issues no receipt (D119). Callers are definer functions owned by booq_owner, so the function keeps no direct grant.
select app.register_payment_port('issue_receipt', 'app.issue_receipt(uuid, uuid, text)'::regprocedure);
