-- F08-T07 / migration 1090: registers app.f08_cancel (0909) in F09's cancel handler registry at ord 30 (F09 design 4.3).
-- The registry table is created by 1003 and 0909 sorts before it, so the registration is a late file in F09's block, numbered high
-- to stay clear of F09's own files. It is F08's content: the exception is recorded in docs/architecture/build-plan.md section 4.
select app.register_cancel_handler('f08_waitlist', 'app.f08_cancel(uuid, uuid, text)'::regprocedure, 30);
