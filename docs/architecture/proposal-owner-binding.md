# Proposal: how the owner invite is bound to a person (D122)

Status: **proposal by the Architect role, 30 Oct 2026, for the Spec drafter and the user.** It changes the wording of D122, which only the orchestrator and the user can do. Nothing is built on it yet.

## The problem

D122 says an owner invite is bound to the LINE ID the platform enters in P2 step 1, so only that person can take the owner role. LINE's APIs do not let us check that: after "Sign in with LINE" the server gets the person's internal user id (`U` followed by 32 hex characters) and display name. The LINE ID people search for (`@name`) is not in the ID token, the profile or any API we use, and a platform admin cannot type the internal id because they cannot see it. So "bound to the typed LINE ID" cannot be enforced; as built it would refuse every real owner.

## Proposal (recommended default, D147)

1. **Create the invite unbound.** The platform creates the owner invite with no LINE user id. The link goes to `club.owner_email` only (SR-01); nobody sees the token. Short life (`invite_ttl_hours`, 72 as a proposal).
2. **Bind at first redemption.** The first successful sign-in through the link binds the invite and the new `app_user` to that LINE user id. The role is granted once (single use, atomic). The same link opened later by the same LINE user only opens the club (D102); any other LINE user is refused. This is the rule D122 already describes for the time after redemption.
3. **Verify the person, not the string.** Three checks make a forwarded link useless to a stranger: (a) the link was only emailed to the owner's address; (b) C2 collects the owner's name and phone and the redemption compares the typed phone with `club.owner_phone` (already built: `owner_verified`); (c) a mismatch keeps Go live closed until a second platform admin confirms with the owner by another channel (already built: `confirm_owner_verified`). P3 shows the LINE display name and the typed phone beside `owner_phone`, so the admin can see who signed in.
4. **Optional, stronger:** the platform admin reads a one-time six digit code to the owner on the phone, and the owner types it on C2. It needs a screen and a copy key, so it is a decision, not part of the default.

## What changes in the code (after the decision)

- Migration 0003: drop `club_invite_owner_bound` (an owner invite no longer needs `bound_line_user_id`).
- `platform.create_owner_invite`: stop copying `club.owner_line` into the invite; `club.owner_line` stays as a contact detail.
- `app.redeem_invite`: for an owner invite with no bound id, set `bound_line_user_id` to the redeemer in the same statement (still one atomic update, still one winner).
- Tests: a different LINE user cannot take a redeemed invite; two parallel first redemptions have one winner and one bound id; the link emailed is the only copy of the token.

## What the user needs to decide

Either accept the proposal and reword D122 ("bound to the first person who signs in through the emailed link, verified by phone match and a second admin"), or name another way to learn the owner's internal LINE id before they sign in (there is none in LINE's public APIs that I know of; the one-time code in point 4 is the nearest).
