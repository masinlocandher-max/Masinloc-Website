# Masinloc POS — what is in this repository, and what is only in production

Written 2026-09-08. This file exists because the two drifted badly, and the
gap is not obvious from reading either one alone.

## The short version

The repository holds the POS **foundation**. Production runs something
considerably further along, and most of that later work was applied directly
to the live project without a migration here. Anyone rebuilding from this
repository gets a working but much smaller POS than the one that is live.

## What was closed

Recovered into `supabase/migrations/`, each read from the live schema and
verified against it:

| Object | Migration |
| --- | --- |
| `business_submissions` | `20260816000000` |
| `professional_submissions`, both challenge tables, `masinloc_profile_code_sequences`, `next_masinloc_profile_code()`, `sync_professional_employer_visibility()` | `20260816000001` |
| `story_submissions`, `resume_support_submissions` | `20260816000002` |
| `sync_professional_employer_visibility()` search_path realignment | `20260902090000` |
| Buyer accounts: `pos_orders.buyer_user_id`, `pos_chat_messages.sender_user_id`, the tightened `pos_chat_staff_insert` policy, and `pos_buyer_tracking_internal` / `pos_buyer_message_internal` / `pos_attach_buyer_to_order_internal` | `20260903000000` |

`scripts/pos-local-replay/04-recovered-schema-fidelity.sql` hashes the full
catalog state of those objects and compares it to the hash taken from
production. A from-zero replay of every migration now lands on exactly what
production has: 185 catalog lines, identical md5.

Recovered into `supabase/functions/`: `pos-order` and `pos-storefront`, both
of which had been live for weeks with no source in version control.

## What is still only in production

### Edge Functions

`supabase/functions/` now holds six. Production runs fourteen. Still missing:
`jobs-supply-sync`, `jobs-supply-sync-dmw`, `jobs-supply-sync-csc`,
`emergency-response`, `bootstrap-withlovefmb-admin`,
`send-withlovefmb-admin-link`, `delete-mobile-account`,
`emergency-responder-admin`.

### POS RPCs

Roughly thirty functions exist in production with no migration here. Grouped
by what they belong to:

- **Marketplace ordering** — `pos_marketplace_storefront`,
  `pos_public_marketplace_menu`, `pos_set_product_marketplace`,
  `pos_enforce_marketplace_publish_limit`.
- **Plans and billing** — `pos_effective_plan_code`, `pos_plan_access`,
  `pos_has_feature`, `pos_create_billing_checkout`,
  `pos_submit_billing_payment`, `pos_verify_billing_checkout`.
- **Staff** — `pos_staff_directory`, `pos_add_staff_by_email`,
  `pos_update_staff_access`.
- **Onboarding** — `pos_submit_access_application`,
  `pos_my_access_application`, `pos_admin_review_access_application`.
- **Merchant settings** — `pos_get_merchant_settings`,
  `pos_update_merchant_settings`, `pos_update_outlet_fulfillment`.
- **Retail and inventory** — `pos_create_retail_order`, `pos_transfer_stock`,
  `pos_create_supplier`, `pos_add_purchase_order_item`,
  `pos_receive_purchase_order`, `pos_inventory_insights`.
- **Refunds and reporting** — `pos_refund_order`, `pos_refund_order_partial`,
  `pos_report_summary`.
- **QA** — `pos_qa_teardown`.

Their supporting tables and columns (`pos_merchants.marketplace_lead_time_minutes`
and the rest) are missing with them.

## Consequences to keep in mind

1. **The merchant console is built against the repo's contract.** It works,
   but it does not use the richer production RPCs. Reports are aggregated
   client-side instead of through `pos_report_summary`; plan limits come from
   `pos_plan_limits` instead of `pos_plan_access`; there is no marketplace
   product-visibility control because `pos_set_product_marketplace` has no
   migration here.
2. **The remaining gap is feature surface, not the ordering path.** The public
   path — storefront, order, payment, kitchen, tracking, buyer chat — is now
   fully in version control and covered by the lifecycle test. What is still
   live-only is billing, staff management, onboarding applications, purchase
   orders, refunds and marketplace product publishing.

## How to recover an object

The method that produced everything above:

1. Read the live definition (`pg_get_functiondef`, `pg_get_constraintdef`,
   `pg_indexes`, `pg_policies`, `information_schema.role_table_grants`).
2. Write an idempotent migration — `create ... if not exists`, `create or
   replace`, `drop ... if exists` before `create` — so it is a no-op against
   production and builds the real thing against an empty database.
3. Add the object to `04-recovered-schema-fidelity.sql`, run
   `scripts/pos-local-replay/run.sh`, take the new expected hash from
   production, and confirm the rebuild matches.

Step 3 is not optional. It caught three defects in the first draft of the
`business_submissions` recovery that replaying without error did not: RLS
never enabled on one table, a policy missing its `WITH CHECK`, and two
function bodies that differed from the live ones.
