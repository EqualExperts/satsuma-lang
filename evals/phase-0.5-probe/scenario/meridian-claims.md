# Meridian Mutual — Claims Mapping Spec

Field-level mapping from the claims management system nightly export into the
`analytics.claims` schema (Snowflake). Authored at M0 (tidy): one table per
mapping, fixed columns, one row per field-level arrow.

## Schemas

### claim_header (source — inbound claim intake)

| Field | Type | Required | Notes |
|---|---|---|---|
| claim_id | VARCHAR(20) | Y | PK |
| policy_no | VARCHAR(30) | Y | |
| claim_type | VARCHAR(15) | Y | auto \| home \| life \| health |
| reported_at | TIMESTAMPTZ | Y | |
| incident_at | TIMESTAMPTZ | N | |
| loss_amount | DECIMAL(14,2) | N | |
| currency | CHAR(3) | N | default USD |
| adjuster_id | VARCHAR(20) | N | |
| status | VARCHAR(20) | Y | |
| vehicles | list_of record | N | nested |
| vehicles[].vin | VARCHAR(17) | Y | |
| vehicles[].make | VARCHAR(40) | N | |
| vehicles[].model | VARCHAR(40) | N | |
| vehicles[].year | INT | N | |
| vehicles[].damage_extent | VARCHAR(15) | N | enum: none, minor, moderate, severe, total, scratch |
| vehicles[].estimate | DECIMAL(12,2) | N | |
| vehicles[].photos | list_of record | N | nested |
| vehicles[].photos[].photo_id | VARCHAR(36) | Y | |
| vehicles[].photos[].angle | VARCHAR(10) | N | enum: front, rear, left, right, interior |
| parties | list_of record | N | nested |
| parties[].party_role | VARCHAR(20) | Y | |
| parties[].name | VARCHAR(120) | N | |
| parties[].contact_phone | VARCHAR(20) | N | PII |

### policy_dim (lookup)

| Field | Type | Required |
|---|---|---|
| policy_no | VARCHAR(30) | Y (PK) |
| product_code | VARCHAR(10) | Y |
| policyholder_id | VARCHAR(20) | Y |
| effective_date | DATE | N |
| expiry_date | DATE | N |
| territory | VARCHAR(10) | N |

### fx_rates (lookup)

| Field | Type | Required |
|---|---|---|
| currency | CHAR(3) | Y (PK) |
| rate_to_usd | DECIMAL(10,6) | Y |

### claim_fact (target)

| Field | Type | Required |
|---|---|---|
| claim_key | VARCHAR(20) | PK |
| policy_ref | VARCHAR(30) | indexed |
| claim_type_code | VARCHAR(2) | N |
| reported_date | TIMESTAMP_NTZ | N |
| loss_usd | DECIMAL(14,2) | Y |
| loss_source | VARCHAR(10) | N |
| vehicle_count | INT | N |
| party_count | INT | N |
| max_damage | VARCHAR(15) | N |
| photos | list_of record | N |
| photos[].photo_ref | VARCHAR(36) | Y |
| photos[].view | VARCHAR(10) | N |
| adjuster_ref | VARCHAR(20) | N |
| is_open | BOOLEAN | N |

### party_dim (target)

| Field | Type | Required |
|---|---|---|
| claim_key | VARCHAR(20) | Y |
| rows | list_of record | N |
| rows[].role | VARCHAR(20) | Y |
| rows[].display_name | VARCHAR(120) | N |
| rows[].phone_e164 | VARCHAR(20) | N |

### vehicle_dim (target)

| Field | Type | Required |
|---|---|---|
| claim_key | VARCHAR(20) | Y |
| rows | list_of record | N |
| rows[].vin | VARCHAR(17) | Y |
| rows[].description | VARCHAR(100) | N |
| rows[].damage_class | VARCHAR(15) | N |
| rows[].estimate_usd | DECIMAL(12,2) | N |

### claim_status_snapshot (target)

| Field | Type | Required |
|---|---|---|
| claim_key | VARCHAR(20) | PK, ref claim_fact.claim_key |
| open_flag | BOOLEAN | N |
| total_exposure | DECIMAL(14,2) | N |

### payment_fact (target)

| Field | Type | Required |
|---|---|---|
| payment_id | VARCHAR(36) | PK |
| claim_key | VARCHAR(20) | ref claim_fact.claim_key |
| paid_amount | DECIMAL(14,2) | N |
| paid_at | TIMESTAMP_NTZ | N |

### fraud_flag (target)

| Field | Type | Required |
|---|---|---|
| claim_key | VARCHAR(20) | PK, ref claim_fact.claim_key |
| risk_score | INT | N |
| is_flagged | BOOLEAN | N |

## Mapping: claim_normalisation

Source: claim_header, policy_dim, fx_rates → Target: claim_fact

| Source path | Target path | Transform | Notes |
|---|---|---|---|
| claim_header.claim_id | claim_key | direct | |
| claim_header.policy_no | policy_ref | direct | |
| claim_header.claim_type | claim_type_code | map {auto: AU, home: HO, life: LI, health: HE} | |
| claim_header.reported_at | reported_date | to_utc | |
| claim_header.loss_amount | loss_usd | Convert to USD using @fx_rates lookup on @claim_header.currency, then round \| round 2 | |
| claim_header.loss_amount | loss_source | coalesce 0 | |
| claim_header.vehicles | vehicle_count | count | |
| claim_header.parties | party_count | count | |
| claim_header.vehicles.damage_extent | max_damage | Pick the worst damage across all vehicles on the claim | |
| claim_header.vehicles.photos (flatten) | photos | flatten | |
| vehicles.photos.photo_id | photos.photo_ref | trim | relative to the flatten block |
| vehicles.photos.angle | photos.view | lowercase | relative to the flatten block |
| claim_header.adjuster_id | adjuster_ref | trim | |
| (computed — no source) | is_open | True if @claim_header.status is 'open' or 'under_review', false otherwise. | |

## Mapping: party_extract

Source: claim_header → Target: party_dim (iterate parties list → rows)

| Source path | Target path | Transform |
|---|---|---|
| claim_header.claim_id | claim_key | direct |
| parties[].party_role | rows[].role | trim \| uppercase |
| parties[].name | rows[].display_name | trim |
| parties[].contact_phone | rows[].phone_e164 | Format to E.164, assuming US country code if no + prefix |

## Mapping: vehicle_extract

Source: claim_header → Target: vehicle_dim (iterate vehicles list → rows)

| Source path | Target path | Transform |
|---|---|---|
| claim_header.claim_id | claim_key | direct |
| vehicles[].vin | rows[].vin | uppercase |
| vehicles[].make | rows[].description | @vehicles.make \|\| ' ' \|\| @vehicles.model \|\| ' ' \|\| @vehicles.year |
| vehicles[].damage_extent | rows[].damage_class | map {none: N, minor: M, moderate: M, severe: S, total: T} |
| vehicles[].estimate | rows[].estimate_usd | round 2 |

## Mapping: status_snapshot

Source: claim_fact → Target: claim_status_snapshot

| Source path | Target path | Transform |
|---|---|---|
| claim_fact.claim_key | claim_key | direct |
| claim_fact.is_open | open_flag | direct |
| claim_fact.loss_usd | total_exposure | Sum exposure across all open claims for the same policy |

## Mapping: payment_extract

Source: claim_fact → Target: payment_fact

| Source path | Target path | Transform |
|---|---|---|
| claim_fact.claim_key | claim_key | direct |
| claim_fact.loss_usd | paid_amount | round 2 |
| claim_fact.reported_date | paid_at | to_utc |

## Mapping: fraud_assessment

Source: claim_fact, party_dim → Target: fraud_flag

| Source path | Target path | Transform |
|---|---|---|
| claim_fact.claim_key | claim_key | direct |
| claim_fact.party_count | risk_score | multiply 10 |
| claim_fact.party_count | is_flagged | True if @party_count > 7, false otherwise. |
