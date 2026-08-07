# Meridian Mutual — Claims Mapping Spec (1-mapping crossover variant)

The crossover cell designed to make S+ lose (PRD §Phase 0.5, "Include a cell
designed to lose"). One mapping, one minimal claim. The 6813-token agent
reference plus per-call CLI round-trips are unamortised, so S+ should lose
here. Authored at M0 (tidy): one table, fixed columns, one row per field.

## Schema: claim_header (source)

| Field | Type | Required | Notes |
|---|---|---|---|
| claim_id | VARCHAR(20) | Y | PK |
| policy_no | VARCHAR(30) | Y | |
| claim_type | VARCHAR(15) | Y | enum: auto, home, life, health |
| reported_at | TIMESTAMPTZ | Y | |
| loss_amount | DECIMAL(14,2) | N | |
| currency | CHAR(3) | N | default USD |
| status | VARCHAR(20) | Y | |

## Schema: fx_rates (lookup)

| Field | Type | Required |
|---|---|---|
| currency | CHAR(3) | Y (PK) |
| rate_to_usd | DECIMAL(10,6) | Y |

## Schema: claim_fact (target)

| Field | Type | Required |
|---|---|---|
| claim_key | VARCHAR(20) | PK |
| policy_ref | VARCHAR(30) | indexed |
| claim_type_code | VARCHAR(2) | N |
| reported_date | TIMESTAMP_NTZ | N |
| loss_usd | DECIMAL(14,2) | Y |
| loss_source | VARCHAR(10) | N |
| is_open | BOOLEAN | N |

## Mapping: claim_normalisation

Source: claim_header, fx_rates → Target: claim_fact

| Source path | Target path | Transform |
|---|---|---|
| claim_header.claim_id | claim_key | direct |
| claim_header.policy_no | policy_ref | direct |
| claim_header.claim_type | claim_type_code | map {auto: AU, home: HO, life: LI, health: HE} |
| claim_header.reported_at | reported_date | to_utc |
| claim_header.loss_amount | loss_usd | Convert to USD using @fx_rates lookup on @claim_header.currency, then round \| round 2 |
| claim_header.loss_amount | loss_source | coalesce 0 |
| (computed — no source) | is_open | True if @claim_header.status is 'open' or 'under_review', false otherwise. |
