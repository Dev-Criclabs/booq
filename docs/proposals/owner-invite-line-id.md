# Proposal: how BOOQ learns the owner's LINE user ID (D122)

Status: **PROPOSAL, not a decision.** Written 30 Oct 2026 by the spec drafter at the Orchestrator's request. It lists options with a recommendation. Nothing here changes a rule until a person decides it and the PRD, then the hand-off, then F01, F02 and F15 are updated.

## The gap

D122 says the owner invite is bound to the owner's LINE user ID "entered in P2 step 1" and is single use. P2 step 1 has a field "Owner LINE ID" with the note "The invite in step P3 goes here" (H-P2-Step1-Basics). Nothing says how BOOQ staff can know that ID before the owner has ever signed in.

## Why it cannot be typed in as stated

- The LINE user ID the app uses is the machine id returned by LINE Login (the ID token `sub`) and that the Messaging API uses for push, a long opaque string. It is not the human readable LINE ID (the @name or search ID) a person knows. (FA §5.3, F02 §4.)
- One LINE provider per club (D7) means the same person has a **different** user ID in each club. So the ID cannot be learned from the person's other clubs or from BOOQ's own LINE account.
- To the best of the drafter's reading, LINE's public API has no lookup from a human readable LINE ID to a user ID; the user ID is learned only when the person interacts with that club's Login channel, LIFF app or Official Account (a Login `sub`, or a `follow` webhook event). **To verify against LINE's documentation before any option is built (G-1).**
- Whether the Login `sub` equals the Messaging API user ID under one provider is itself still to be tested with a real account (F02 Q33, FA Q33).

So what BOOQ staff can type in step 1 before first sign in is at best a reference (the owner's display name or human readable LINE ID), not a binding key.

## Constraints from the decisions

- D122: bound to the owner's LINE ID, single use. D102: a club that is not live admits the owner role and testers; the owner invite stays valid for return visits. (Read together: the link binds once; later visits are recognised by the bound LINE user ID, not by the link.)
- D3: BOOQ staff never use LINE; the owner always signs in with LINE.
- D2: BOOQ may hold the owner's contact details (name, phone, LINE, email) from step 1.
- Money, accounts and credentials are not decided by sessions (D147): an option that needs an SMS provider account is the user's.

## Options

**A. First sign in claims the invite, BOOQ staff approve.**
The invite is a long random single use token, sent by BOOQ staff to the owner's email or phone from step 1 (outside LINE). The owner opens it, signs in with LINE; the first LINE user ID that presents the token is recorded as a **pending** owner binding. BOOQ staff see the LINE display name and a masked ID in P3 and approve after confirming with the owner by phone (the phone from step 1). Only after approval is the owner role granted. Step 1's "Owner LINE ID" field becomes a reference note (display name or the @name), not a key.
- Pros: works with what BOOQ really has; the human approval closes the forwarded link risk; no new accounts.
- Cons: one manual step per club; between sign in and approval the owner waits; changes the D122 wording ("entered in step 1").

**B. Bind through the Official Account follow event.**
The Official Account is set up first (P2 step 4). BOOQ staff ask the owner to add the club's Official Account (a QR in P3). The `follow` webhook gives that user's LINE user ID and display name; P3 lists "people who added the club" and staff pick the owner (confirming by phone), which binds the invite to that user ID before any link is opened. The link then works only for that ID.
- Pros: the ID is known before the owner opens the invite, matching D122 closely; binds without a first sign in.
- Cons: needs the Official Account live early; any person who adds the account appears in the list, so staff must pick correctly; a display name is not proof of identity; only possible after step 4.

**C. Verify by a code sent to the owner's phone or email.**
BOOQ staff send the invite link by email or SMS to the details in step 1, and a short one time code is read to the owner by phone or sent in a second channel. The owner signs in with LINE and enters the code; the LINE user ID seen at that moment is recorded as the owner's.
- Pros: a stronger check than a link alone.
- Cons: needs an SMS or email provider (an account and a cost, the user's to decide); more screens.

**D. Link only, no extra check.**
Same as A without the approval. First LINE user ID to open the token becomes the owner. Simplest.
- Pros: nothing manual.
- Cons: a forwarded or intercepted link hands the whole club to a stranger (the owner role sees players, payments and staff). Not recommended.

## Recommendation (for the Orchestrator and the user to decide)

**Option A.** It is the only one that needs no new account and no early Official Account, and its human approval step removes the main risk of D. Concretely, if A is chosen:

1. Step 1 keeps the "Owner LINE ID" field as an optional reference note (display name or @name); the owner's phone and email stay required.
2. The invite is a single use token delivered outside LINE; opening it and signing in creates a pending binding (the user ID is recorded server side, never typed).
3. P3 shows pending bindings with display name and masked ID; a platform admin or the assigned specialist approves after a call to the owner's phone; approval grants the owner role, binds the club to that LINE user ID and consumes the token (D122). A second user ID presenting the used token is refused and logged in P6.
4. Return visits are recognised by the bound LINE user ID, so D102's "valid for return visits" holds without the link.
5. An unapproved binding expires after a set time (a platform config value) and the invite can be reissued (D138).

If Option B is preferred later it can be added as a way to pre-fill the same pending binding.

## What would change if A is chosen

PRD (P2 step 1 field wording and the invite flow), hand-off ROLE and PLAT rows, F01 PLAT-01 and ROLE-02 (the owner invite criterion), F02 (the owner sign in), F15 (P2 step 1 and P3 screens, a Pending owner row), and one P6 entry type. The F01 design's `owner_invite` table gets a pending binding state. No code until it is approved.

## Questions that stay with the user

- Is a manual BOOQ approval of each owner acceptable for the launch volume (Hunter first, then a few clubs)?
- Who may approve (platform admin only, or the assigned specialist as well)?
- G-1: confirm with LINE's documentation (or a real test account) that no lookup from a human readable LINE ID to a user ID exists.
