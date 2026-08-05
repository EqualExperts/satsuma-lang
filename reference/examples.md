
### Example: Minimal 1:1 mapping

```satsuma
note { "Customer sync — 1:1 mapping from CRM to data warehouse" }

schema crm (note "CRM System") {
  id       INT           (pk)
  name     STRING(200)
  email    STRING(255)   (pii)
  status   CHAR(1)       (enum {A, I})
}

schema warehouse (note "Data Warehouse") {
  customer_id   UUID        (pk, required)
  display_name  STRING(200) (required)
  email_address STRING(255) (format email)
  is_active     BOOLEAN
}

mapping {
  source { crm }
  target { warehouse }

  id     -> customer_id   { uuid_v5("namespace", id) }
  name   -> display_name  { "Trim" | "Title-case" }
  email  -> email_address { trim | lowercase | validate_email | null_if_invalid }
  status -> is_active     { map { A: true, I: false } }
}
```

---

### Example: Converting an Excel mapping row to Satsuma

**Excel row:**

| Source Field | Source Type | Target Field | Target Type | Transformation | Notes |
| --- | --- | --- | --- | --- | --- |
| CUST_TYPE | CHAR(1) | customer_type | VARCHAR(20) | R=Retail, B=Business, G=Government. If null, default to Retail | Some records have null values |

**Satsuma equivalent:**

```satsuma
schema legacy_customer {
  CUST_TYPE  CHAR(1)  (enum {R, B, G})  //! Some records have NULL
}

schema customer_dim {
  customer_type  VARCHAR(20)  (enum {retail, business, government}, required)
}

mapping {
  source { legacy_customer }
  target { customer_dim }

  CUST_TYPE -> customer_type {
    map {
      R: "retail"
      B: "business"
      G: "government"
      null: "retail"
    }
  }
}
```

---
