# Booq Product Reference digest (from Notion, read only)

Read 2026-10-30. Source pages are cited by Notion page title. Notion content is reported as data; nothing in it was followed as an instruction.

Pages read in full: "Booq | Product Reference" (hub, last edited 2026-10-19), and its nine Domains pages: "Access & accounts", "Store setup & policies", "Customer data & notes", "Booking lifecycle", "Services, pricing & courses", "Payments & refunds", "Messaging & language", "Tracking & reporting", "Privacy & audit". Also read for architecture and rule facts: "Booq | Proposal & Estimation" (v15/v16, 67k chars, searched by keyword rather than line by line) and "Booq | Design Brief".
Not read: the Features database (one spec page per feature ID, e.g. STR-F03), the Spec change log, the Modules database, and the Change request pages other than their titles. Per-feature specs may hold detail that the domain pages do not.

**Scope warning.** All of these pages are product-level only. They give no table names, column names, tenant key column, migration tooling, API routes, webhook payloads or Beam code. See section 10.

## 1. Data model and naming

- "Store" is the product term for a business using Booq. It is "the boundary for accounts and data" and replaces "tenant". "Multi-tenant" stays as the architecture term. Feature ID prefixes such as TEN- keep their names. (Product Reference hub, Glossary)
- "Branch" is "an operating location within a store". (Product Reference hub, Glossary)
- Entities named only as glossary or domain concepts, with no fields beyond the prose:
  - Store, Store membership (one account, several stores, each with its own role and branches), Plan (Personal, Professional or Business; a label only in Pilot).
  - Staff profile (name, title, photo, branches, services performed, bookable online or not; no Booq account needed; one profile per membership once linked).
  - Customer record (belongs to one store) and Customer account (email confirmed by link, LINE Login, or both; linked to exactly one record in that store).
  - Service, Variant, Add-on, Course, Promo code, Resource (name, free-text type, capacity in guests default 1, status active or archived), Resource block, Working schedule, Leave (types Annual, Sick, Personal, Other).
  - Booking, Booking terms (cancellation window, reschedule window, deposit and no-show rule saved on the booking when made), Checkout hold, Reminder acknowledgement, Booking source, Receipt, Follow-up, Activity, Audit log. (Product Reference hub, Glossary; Store setup & policies; Services, pricing & courses)
- Customer record fields listed in prose: name (required), email (unique per store), phone (a match only warns), LINE display name, date of birth, gender, preferred staff, tags, marketing consent, and store-defined fixed fields. (Customer data & notes)
- The Store configuration catalog on "Store setup & policies" lists every store and branch setting with level, values, default and who changes it. It names settings in words, for example "Approval hold" and "Share booking history across branches". It gives no column names.
- Booking states (six): pending, confirmed, checked-in, completed, no-show, cancelled. Decline and approval expiry are cancellation reasons, not states. (Booking lifecycle)
- Payment status label: Unpaid, Deposit paid, Paid, Refund due, Refunded. It is separate from booking state. A booking keeps total, paid, refunded and balance due (total - paid + refunded). (Payments & refunds)
- Course states: Active, Used up, Expired, Refunded. Service states: Published, Hidden, Archived. Follow-up states: open, done, cancelled. (Services, pricing & courses; Customer data & notes)
- Booking field types: Text, Single choice, Multiple choice, Yes/No. (Store setup & policies)
- Currency and time zone are fixed at THB and Asia/Bangkok in Pilot, and are not settings. (Store setup & policies, catalog)
- Money storage format (integer satang) is not stated. Notion says only "rounded to whole baht" for deposits and shows amounts as "฿1,250.00".
- Repo layout, from "Booq | Design Brief": one repo with `apps/web` (production), `apps/prototype` (mock data, never deployed) and `packages/ui` (design system, imported as `@booq/ui`). This is the only code-level naming in the pages read.

## 2. Rules by domain (IDs and status)

Status convention: "Every rule is Confirmed unless labelled Proposed or Open." All nine domains are "Approved at G2" on 2026-10-19 by the PO/Tech Lead (Pirush). Each domain page ends with "Open items: None", except the two notes below. (Product Reference hub)

Feature IDs cited by the pages, by module:
- Access and tenancy: ACC-F01 to F03, TEN-F01 to F02. TEN-F03 branding (Before launch), TEN-F04 plan limits (Before launch), TEN-F05 Booq subscription billing (Later).
- Store setup: STR-F01 to F05 (STR-F03 booking policies, STR-F04 payment settings, STR-F05 booking fields), STF-F01 to F04, RES-F01 to F02.
- Bookings and portal: BKG-F01 to F04, F06, F07, F11 ("any staff" strategy), PTL-F01 to F06.
- Services: SVC-F01 to F05, F08. SVC-F06 scheduled classes (Later), SVC-F09 course opening balances (Later), SVC-F10 course sharing and transfer (Later). PRM-F01 promo codes.
- Customers: CRM-F01 to F04. CRM-F08 merge was Removed because manual merge moved into CRM-F01.
- Money: PAY-F01 to F03, PAY-F07 (manual payments), POS-F01 to F03, POS-F06 (tax invoices, Later), POS-F07 (Bolt+ terminal, Later), FIN-F01 to F02.
- Messaging: NTF-F01, F02, F04, F06, NTF-F07 (staff LINE, Later), LIN-F01 to F03, LOC-F01 (strings translatable), LOC-F02 (Thai, before general launch).
- Reporting and compliance: RPT-F01, F02, CMP-F01 (consent, Before launch, not yet specified), CMP-F02 (data requests, Before launch, not yet specified), CMP-F03 (audit), CMP-F04 (retention, Later).
- Other: NFW-F03 (design system), BKG-F05 (Later), INV (inventory, Later, not specified).

Key domain rules:
- **Store setup & policies**
  - Defaults:
    - Lead time: minimum 2 hours, maximum 60 days. The range is 15 minutes to 90 days; the minimum can be none.
    - Approval hold: 24 hours.
    - Cancellation window and reschedule window: 24 hours each.
    - Deposit: none, rounded to whole baht.
    - No-show rule: keep the deposit.
    - Self-editing by customers: on.
    - Staff selection by customers: on.
    - "Any staff" strategy: round robin.
    - Share booking history across branches: on.
    - Staff edit their own availability: off.
    - Reminders: up to 2, default one at 24 hours before.
  - Start-time grid is fixed at 30 minutes and is not a setting.
  - Service-level overrides are limited to deposit, confirmation, cancellation window and reschedule window.
  - No go-live step: a store takes bookings once it has one bookable service. Payment and LINE settings are optional.
  - Policy changes apply to new bookings. Saved booking terms apply to existing ones.
  - Holidays are entered by hand. Nothing is auto-cancelled; affected bookings are listed.
- **Booking lifecycle**: availability, "any staff" strategies, staff-created bookings (confirmed at once, staff overrides need warning, reason and audit but never override double bookings, closures, leave, hours or capacity), approval holds, reschedule goes back to pending, no reopening of terminal states, no direct confirmed to completed, no-show is only marked by hand.
- **Services, pricing & courses**:
  - Price precedence has 10 steps.
  - Prices belong to services, with no store-wide price rules.
  - Duration need not be a multiple of 30 minutes.
  - Add-ons add no time and are added once per booking.
  - A course covers one service, and a session counts as used when the booking is made.
  - Promo code rules: one per booking, unique per store, not case-sensitive.
- **Customer data & notes**: restricted-note eligibility rules, manual merge of customer records, no deletion of customer records in Pilot, follow-ups.
- **Tracking & reporting**: pixels and tags off in Pilot. Booking source is captured (channel Online, LINE or Staff; UTM and click IDs kept for the browser session only, no cookie). Staff source list: Phone, Walk-in, LINE chat, Referral, Ads, Other.
- Open or non-Confirmed items still listed:
  - Branding values (logo, colours, cover, slug) are Open until TEN-F03.
  - Indefinite restricted-note eligibility is Confirmed but flagged "review before real customer data" (blocks CRM-F03).
  - CMP-F01 and CMP-F02 are not yet specified.
  - The hub shows "Proposed hierarchy" and "Scope rules - proposed" headings for role hierarchy.
  - Proposal items Q16 (second reviewer for critical code) and Q18 (short Pilot agreement, legal baseline) are open.

## 3. Auth and roles

- Back-office roles: Owner, Branch manager, Front desk, Staff, all branch-scoped. Customer is the external actor. Platform admin is a CRIC role, separate from store membership. (Product Reference hub, Roles & hierarchy)
- One Booq account per person, identified by email, and it can belong to several stores. A store can have several Owners and always keeps at least one. Shared logins are not allowed. (Access & accounts)
- Sign-in:
  - Store users and Platform admin use email and password. Customers use an email sign-in link or LINE Login.
  - Inactivity sign-out: store users 24 hours, Platform admin 2 hours.
  - Longest session: store users 30 days, Platform admin 12 hours, customers 30 days.
  - Lockout: 5 wrong passwords in 15 minutes pauses sign-in for 15 minutes and sends an email.
  - Reset link: single use, 1 hour. Customer sign-in link: single use, 15 minutes. Invites expire after 7 days.
  - Passwords need at least 8 characters.
  - No Google sign-in and no 2FA in Pilot.
- The first Platform admins are seeded at deployment. After that they invite each other. (Access & accounts)
- Customer identity linking: an email or LINE account links only when the customer proves ownership. A record keeps one email and the newest LINE account. There is never automatic linking by name or phone. A flowchart is given. (Access & accounts)
- Permission matrices exist per domain and are summarised in the hub "Permission overview" (16 area rows by 6 roles). Examples:
  - Only the Owner executes online and course refunds.
  - Counter discounts and voids are for Owner and Branch manager only.
  - The financial dashboard is read-only for Owner and Branch manager.
  - Staff never see checkout or payments.
- Platform admin (CR-Booq-01, approved Option A 2026-10-14):
  - Manages stores (create, edit, deactivate, reactivate), users, branches, store configuration, services and resources, and can view audit records.
  - Not a reader of customer, clinical or financial data by default. No impersonation.
  - Sees affected bookings by date, time, service and staff only, without customer details.
  - Its changes show in Activity under its own name, marked "Booq support".
  - May replace payment gateway credentials but never see them.
  - Sees message status and errors only, with no customer details or message content.
  - Cannot export datasets.
  - Cannot read restricted-note contents.
  - (Access & accounts; Store setup & policies; Messaging & language; Privacy & audit)

## 4. Bookings, availability, holds

- A start time is free when all of these hold:
  - The whole block (buffer before + duration + buffer after) is inside branch opening hours, on the 30-minute grid, on a day with no holiday or closure.
  - Eligible staff work there for the whole block, with capacity left.
  - Required resources are free, each with capacity left.
  - Online bookings respect the lead time.
  - Capacity counts every non-cancelled booking, pending approvals included, plus active checkout holds. Availability is rechecked on submit.
  - One customer may hold two overlapping bookings.
  (Booking lifecycle)
- Checkout hold: the slot is held for 10 minutes while the customer pays online. If the hold ends first, the slot is released. A late payment still creates the booking if the slot is free, otherwise it is "refunded in full automatically" and the customer is told. Bookings with nothing to pay online skip the hold. (Booking lifecycle; Payments & refunds)
- Checkout hold and pending-approval hold are different things. Approval hold default is 24 hours, the deadline is fixed when the request becomes pending, and an expired request is never revived by a late approval or payment callback. (Booking lifecycle)
- Repeat approvals, expiries or cancellations must not duplicate bookings, capacity release, messages, payments or refunds (idempotency). (Booking lifecycle)
- The database-level mechanism for no double booking (transaction, uniqueness rule, locking) is not stated. The proposal risk table says only "property-based tests; concurrency-safe holds". (Booq | Proposal & Estimation)
- Staff capacity is 1:1 or 1:many. A service may need no staff (a court) plus resources in interchangeable groups. A staff member may work at two branches on one day if the times do not overlap, and shifts do not pass midnight. (Services, pricing & courses; Store setup & policies)

## 5. Payments incl. Beam

- Beam is the payment gateway, "Confirmed (PO, 2026-10-19)": "It supports refunds to PromptPay." (Payments & refunds). Fallback 2C2P or Ksher (Booq | Proposal & Estimation, Tech stack). Beam products named: Checkout, Bridge (platform and revenue share), and Bolt+ (card terminal, Later POS-F07).
- Each store is its own merchant (per-store Beam merchant account, per-store KYC). Booq never holds customer funds. (Payments & refunds; Booq | Proposal & Estimation, assumption 4)
- Methods: online PromptPay QR and card, each on or off. Cash, bank transfer and the store's own card terminal can be recorded in store. Gateway credentials are kept secret. (Store setup & policies)
- A booking is created only once the gateway confirms payment. Each online payment gets a receipt. The customer pays exactly what the booking terms require (deposit, or the full amount for full prepayment). (Payments & refunds)
- Refunds:
  - Only the Owner executes refunds.
  - An online refund goes back through the gateway to the original method; a manual payment gets a manual refund.
  - Total refunds never exceed what was paid.
  - A gateway refund is pending, then refunded or failed. A failed refund stays "refund due" and can be retried or done manually.
  - "Refund due" means the Owner still has to refund it by hand. Only a late online payment on a lost slot is refunded automatically.
  - Goodwill refunds need a reason and are audited.
- Cancellation outcomes: before the window, full refund due. Late cancel, deposit kept. No-show follows the no-show rule. Store declines, expiry or store cancel gives a full refund due. (Payments & refunds)
- Manual payments (cash, bank transfer with optional slip image, own terminal, other) are not editable. They are voided by Owner or Branch manager with a reason and re-entered. (Payments & refunds)
- Receipts:
  - One per checkout and one per payment taken outside checkout.
  - Number sequence is per branch with a branch prefix, never reused. A voided receipt keeps its number.
  - Marked "Receipt - not a tax invoice". Tax invoices are Later (POS-F06).
  - Printable at 80 mm; sent by email, and by LINE when connected.
- Not stated: Beam API calls, request or response fields, callback or webhook payload, signature verification, idempotency keys, amount-mismatch handling, sandbox settings, or the Beam refund API. The only Beam statements are in Payments & refunds, Booq | Proposal & Estimation (research notes, assumptions, risks) and the PRD and handoff.

## 6. LINE, messaging, language

- Each store connects its own LINE Official Account. The Owner enters Messaging API channel ID, secret and access token, plus a LINE Login channel and LIFF ID, all under the same provider so user IDs match. These are "kept encrypted" and secrets are hidden after saving. Booq shows a webhook URL to paste into the LINE console and a test sign-in. The LINE module channel is not available (Q22). Each store pays for its own LINE messages. (Store setup & policies; Messaging & language; Booq | Proposal & Estimation)
- Channels:
  - Booking messages always go by email when the customer has one. They also go by LINE when LINE is connected, the account is linked and the customer is a friend of the OA.
  - Reminders go by one channel (LINE if connected, else email).
  - No quiet hours.
  - Retries: 3 times within 30 minutes. A failed LINE reminder falls back to email.
  - The Owner is alerted at 80% of the LINE quota and again when it runs out. (Messaging & language)
- Reminder Confirm only records an acknowledgement. It does not change the booking state (this replaces proposal R41). Staff notifications are in-app and email only in Pilot. Staff LINE is Later (NTF-F07). (Messaging & language)
- LINE data kept: LINE user ID, display name, friend status. Disconnecting LINE stops LINE messages and LINE sign-in. (Messaging & language)
- Language: Pilot UI, emails and LINE messages are English only. Thai comes with LOC-F02 before general launch, with separate Thai and English versions. Every string must be translatable (LOC-F01). Formats: "Mon 19 Oct 2026", 24-hour time, "฿1,250.00", Asia/Bangkok. (Messaging & language; Booq | Design Brief)
- The Design Brief says layouts must fit "Buddhist-era dates later (LOC-F02)". See conflicts.
- Design Brief: LINE and email templates "share tokens only" with the UI and do not use `@booq/ui` components. The LINE Flex Message format is not mentioned in the pages read.

## 7. Privacy, audit, retention, PDPA

- Roles: the store is the data controller, Booq (CRIC) is the data processor. This is stated in the proposal, assumption 11, plus a research note on processor duties (act on controller's instructions, security measures, records, breach notice). (Booq | Proposal & Estimation)
- One event record shown in two views: Activity (timeline on each booking and customer profile; never shows sign-ins, exports or restricted-note access) and the Audit log (complete, for security and disputes). Nobody can edit or delete audit records. Each record has who, when, store and branch, before and after, and a reason where required. (Privacy & audit)
- Audited events listed: sign-ins and failures, role changes, setting changes, booking state changes and overrides, payments, voids, refunds, discounts, customer record changes, restricted-note access and exports. Every restricted-note access is logged. (Privacy & audit)
- Retention: Pilot keeps everything, with no automatic deletion until CMP-F04 (Later). Target: 2 years for audit records. Payment and receipt records follow Thai accounting rules, "usually 5 years", to be confirmed with an accountant or counsel (Q18). (Privacy & audit)
- Consent capture (CMP-F01) and data requests (CMP-F02) are Before launch and not yet specified. In Pilot, consent is on paper, staff record it on the customer record, and CRIC handles data requests by hand. Customer records cannot be deleted in Pilot. (Customer data & notes; Booq | Proposal & Estimation, assumption 21; Booq | Design Brief)
- Medical records are outside the product. The booking field builder carries a fixed "do not ask for health information" warning. (Store setup & policies; Customer data & notes)
- Restricted notes are readable by Owner, Branch manager (assigned branches) and Staff with a qualifying booking, with indefinite eligibility. Front desk gets none. (Customer data & notes)
- Exports are Owner only, show customer name, email and phone, and are audited. (Payments & refunds; Privacy & audit)
- Tracking pixels and tags are off. Booking-source capture is on, and the page states this is not a declaration that the identifiers are anonymous. (Tracking & reporting)
- Backups: the proposal says "Availability, backups, performance... in non-feature setup/QA (TBD)". No backup frequency is given. (Booq | Proposal & Estimation)

## 8. Hosting, stack, migration, tooling

- Front end: Next.js with shadcn/ui and Tailwind CSS (PO and Tech Lead, 2026-10-19). Web-first: responsive back office and staff views, a LIFF or web customer portal, no native apps. (Booq | Proposal & Estimation; Booq | Design Brief)
- Hosting in Thailand: AWS, DigitalOcean or GCP (Confirmed, assumption 13). The provider is not chosen. (Booq | Proposal & Estimation)
- Environments: staging and production, LINE test channels, gateway sandbox, monitoring. (Booq | Proposal & Estimation)
- Delivery: AI coding agents as developers, with automated tests as a merge gate and human review. Pirush is PO, Tech Lead and main developer. (Booq | Proposal & Estimation)
- Design system in `packages/ui` (`@booq/ui`), tokens as CSS variables mapped into the Tailwind theme, a `brand` token separate from `primary`. A front-end ADR is to be "Accepted" before the foundation step. (Booq | Design Brief)
- Accounting: FlowAccount Open API (Later). Ads: Meta Conversions API (RPT-F04, before launch), others Later. (Booq | Proposal & Estimation)
- Database, ORM, auth library, queue, job runner, API style: not stated anywhere in the pages read.
- Migration: only "Data migration services beyond CSV customer import" listed as an exclusion (CRM-F06 is the CSV customer import). No schema migration tooling is named. (Booq | Proposal & Estimation)

## 9. Conflicts with prd-v1.2.md and handoff-v1.2.md

Items 1 to 3 are acknowledged in the PRD or handoff and settled there. The rest are not acknowledged unless noted.

1. **Names.** Notion: Store and Branch. BOOQ: Club and Location. Handoff: "Keep the core's table names and map the labels in the UI." This is acknowledged. It matters because the core's table names are what the handoff says to keep, and Notion does not give them.
2. **Booking length.** Notion: variants of any duration, a 30-minute grid, and the duration need not be a multiple of 30. BOOQ: 60 minutes on the hour for every club (settled 30 Oct).
3. **Plans.** Notion: Personal, Professional, Business tiers (label only in Pilot). BOOQ: one plan at ฿1,900 a month before VAT. Acknowledged in the PRD.
4. **Platform staff access.**
   - Notion: Platform admin may edit store configuration, services, resources, users and payment settings in any store, with no draft or live gating.
   - Notion also shows affected-booking date, time, service and staff, and audit records for any store.
   - PRD and CLAUDE.md: BOOQ staff see setup only. They edit Draft and Testing clubs. Live clubs are look-only unless the owner turns on "Allow BOOQ to make changes" for 24 hours. Players, bookings, payments, slips, receipts, wallets and reports stay hidden.
   - Notion's Platform admin is "not a reader of customer, clinical or financial data by default" but is allowed to view the audit log for any store, and the audit log records customer and payment events. Whether that conflicts with "never see bookings or payments" depends on what the audit entries expose. Flag for the architect.
5. **Late payment after hold.** Notion: booking is created if the slot is free, else a full automatic refund, back through the gateway to the original method. PRD and handoff PAY-03: approved if the slot is free, else the value goes to the wallet. CLAUDE.md: value never goes back as cash, refunds go to wallet or package credit. This conflicts directly.
6. **Refund route in general.** Notion: gateway refund to PromptPay or the original method, and manual cash or bank refunds. The PRD Beam section also says "Refunds go back by PromptPay", while CLAUDE.md says refunds go to wallet or package credit. Notion's Owner-executed, by-hand "refund due" model is not in the PRD.
7. **Hold length.** Notion: fixed 10 minutes for the online checkout hold. PRD: the owner picks 10, 15 or 20 minutes (15 default), backup mode holds 60 minutes. (The PRD also still says 15 minutes in two older lines, 159 and 175. That is an internal inconsistency in the PRD, not a Notion point.)
8. **Language and dates.** Notion: Pilot is English only, Thai later; date format "Mon 19 Oct 2026". Design Brief mentions "Buddhist-era dates later". PRD and CLAUDE.md: Thai and English at launch, and the international year in both languages (never 2569). The Design Brief's Buddhist-era mention conflicts with the "never 2569" rule.
9. **Receipt numbering and content.** Notion: one sequence per branch with a branch prefix, marked "not a tax invoice", VAT shown per service. PRD: sequence per club (HTC-2027-000001) showing tax ID and branch, defaults to non-VAT with a setting for VAT tax invoices. Handoff: "Sequential number per club". The per-branch versus per-club sequence differs. The tax-invoice stance differs.
10. **Roles.**
    - Notion: Owner, Branch manager, Front desk, Staff, Customer, Platform admin. Staff are bookable without an account. Back-office sign-in is email and password, with 24-hour and 30-day session limits.
    - PRD: five roles, including a Coach role. Everyone signs in with LINE.
    - Notion has no Coach role and no LINE sign-in for staff. Auth models differ for staff.
11. **Customer key.** Notion: customer record per store, identified by email or LINE account, with email linking and merge flows. PRD and handoff: LINE user ID is the permanent key, a player at two clubs has two accounts. Email sign-in and manual merge are not in the PRD.
12. **Booking states.** Notion keeps checked-in and a check-in transition. CLAUDE.md and the PRD removed A3 Check-in and the Checked in status.
13. **Overall product shape.** Notion models staff-led services with variants, courses, deposits, approval flows and customer self-service. The PRD models a tennis club with courts, coaches, class packages, a wallet ledger, credit ledgers, waitlists and a coach and court solo class. Notion has no wallet, credit ledger, waitlist, coach rest rule or class template. Its "Course" is a prepaid session pack for one service with a refund option.
14. **Refund of package value.** Notion lets the Owner refund unused course sessions as money, up to the amount paid. CLAUDE.md says value never goes back as cash.
15. **Retention.** Notion: keep everything in Pilot, 2-year target for audit, about 5 years for payment records, to be confirmed. PRD and handoff give "daily backups" and no retention periods in the lines checked.
16. **Message editing and wording.** Notion's messaging domain is silent on message editing. PRD removed the message editor and fixes wording in code. CLAUDE.md puts wording in the locale files.

Not compared in detail: the hi-fi board IDs, the PRD requirement IDs (BOOK-, PAY-, AUTH-) versus Notion's feature IDs (BKG-, PAY-F, ACC-). The two ID schemes differ in prefix and number format and do not map one to one.

## 10. What the Notion pages do NOT say (architect's questions)

- **Table and column names:** not given. The only structural names are glossary and settings names in prose. There is no schema, ERD, DDL or field-level type list. The handoff's "keep the core's table names" cannot be followed from these pages; the real core codebase or database is the only source.
- **Tenant key:** the pages say only that "Store" is the boundary for accounts and data and that "Every query" scoping is by store. They do not name a column such as store_id, a Postgres RLS policy, or a schema-per-tenant design. "Multi-tenant" is stated as the architecture term only. Store membership and branch assignment are described in prose.
- **Live data:** the pages do not say whether a running Booq core instance exists or holds live data. They describe a Pilot that is specified and prototyped: the Design Brief says "Mock data only; no backend", "Production code and backend work" is out of scope for the prototype, and the proposal gives estimates, not a deployed system. The Product Reference status property is "Not started". Do not assume a live database with data. Ask the owner (Pirush) directly.
- **Migration tooling:** none named. Only CSV customer import (CRM-F06) and a "data migration services" exclusion appear.
- **Beam code and API:** nothing beyond product statements (Beam is the gateway, per-store merchants, PromptPay QR and card, refunds to PromptPay, fallback 2C2P or Ksher). No endpoints, SDK, signature scheme, callback fields or idempotency design.
- **Database engine, ORM, jobs/queue, API style, auth library, email provider, file storage for slips and receipts, PDF library:** not stated. Postgres or Supabase appears only in the BOOQ handoff and PRD as a "suggested stack". Notion never mentions Postgres or Supabase (searched).
- **Repo state:** the Design Brief describes a planned layout (`apps/web`, `apps/prototype`, `packages/ui`) in "one repo". Whether it exists, and whether it is this repo, is not stated.
- **Features database:** per-feature specs (e.g. STR-F03, PAY-F01) were not read here and may hold more detail, such as scenarios and Design sections. They are the next place to look for any field-level detail.
