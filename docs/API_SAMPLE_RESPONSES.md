# Customer-API sample responses

Captured live against `https://labelhub-gamma.vercel.app` on 2026-05-14
via `npm run test:customer-api`. Use these as a reference for integrating;
re-run the script after deploys to refresh.

All requests authenticate with the public demo bearer:

```
Authorization: Bearer lh_ws_7fTnxnfKRZ7yP2BrOCD2W8E14GIQ6cFf-TgvU5pwTNQ
```

---

## 1. `GET /api/annotations?limit=3`

**Status**: `200`

```json
{
  "annotations": [
    {
      "id": "a8dca059-b051-4cb9-b89f-caae8733340f",
      "trajectoryId": "00000000-0000-0000-0000-000000020004",
      "userId": "00000000-0000-0000-0000-000000000001",
      "userEmail": "demo-admin@labelhub.local",
      "userDisplayName": "Demo Admin",
      "status": "approved",
      "submittedAt": null,
      "reviewVerdict": null,
      "reviewFeedback": null,
      "reviewedAt": null,
      "trajectoryMarks": {},
      "stepMarks": {
        "64210f2e-911a-422c-b0e3-7796367167bb": {
          "step_quality": {
            "scale": "likert",
            "value": 5,
            "reason": "Correctly identified the need to call get_weather before answering."
          }
        },
        "e765d7ef-29f8-41c8-952d-b6ac30b74b0d": {
          "step_quality": {
            "scale": "likert",
            "value": 3,
            "reason": "Args reasonable; could have asked user for unit preference."
          }
        },
        "00000000-0000-0000-0000-000000021031": {
          "tool_choice": {
            "scale": "likert",
            "value": 5,
            "reason": "smoke-test: looks correct"
          },
          "safety": { "scale": "bool", "value": true }
        }
      }
    }
    // ... 2 more annotations
  ],
  "total": 11,
  "limit": 3,
  "offset": 0,
  "hasMore": true
}
```

The `stepMarks` object is keyed by **trajectory step UUID**; each step's
inner object is keyed by **rubric id**. Each value is a canonical `Mark`
(`{scale, value, reason?}`) — the same shape stored in
`step_annotations.payload` server-side.

---

## 2. `GET /api/annotations/<id>`

**Status**: `200`

```json
{
  "annotation": {
    "id": "a8dca059-b051-4cb9-b89f-caae8733340f",
    "trajectoryId": "00000000-0000-0000-0000-000000020004",
    "userId": "00000000-0000-0000-0000-000000000001",
    "userEmail": "demo-admin@labelhub.local",
    "userDisplayName": "Demo Admin",
    "status": "approved",
    "submittedAt": null,
    "reviewVerdict": null,
    "reviewFeedback": null,
    "reviewedAt": null,
    "trajectoryMarks": {},
    "stepMarks": {
      "64210f2e-911a-422c-b0e3-7796367167bb": {
        "step_quality": {
          "scale": "likert",
          "value": 5,
          "reason": "Correctly identified the need to call get_weather before answering."
        }
      }
      // ... more step buckets
    }
  }
}
```

Returns `404` when the id doesn't exist OR belongs to a different workspace
(deliberately ambiguous so cross-tenant existence doesn't leak).

---

## 3. `GET /api/quality/summary`

**Status**: `200`

```json
{
  "workspaceId": "00000000-0000-0000-0000-000000000010",
  "asOf": "2026-05-14T15:37:14.371Z",
  "iaa": {
    "annotatedSteps": 19,
    "multiRaterSteps": 19,
    "disputedSteps": 10,
    "agreementRate": 0.4737
  },
  "raterCount": 3,
  "raters": [
    {
      "userId": "00000000-0000-0000-0000-000000000002",
      "email": null,
      "displayName": "Demo Reviewer",
      "trust": {
        "source": "admin",
        "score": 0.7727,
        "positives": 6,
        "negatives": 0
      },
      "calibration": {
        "matched": 0,
        "diverged": 0,
        "score": 0.5,
        "goldsCovered": 2
      },
      "contribution": {
        "submitted": 0,
        "approved": 6,
        "rejected": 0,
        "pendingReview": 0
      }
    },
    {
      "userId": "00000000-0000-0000-0000-000000000001",
      "displayName": "Demo Admin",
      "trust": {
        "source": "peer",
        "score": 0.7292,
        "positives": 15,
        "negatives": 4
      },
      "calibration": null,
      "contribution": {
        "submitted": 0,
        "approved": 0,
        "rejected": 0,
        "pendingReview": 0
      }
    },
    {
      "userId": "00000000-0000-0000-0000-000000000003",
      "displayName": "Demo Junior",
      "trust": {
        "source": "admin",
        "score": 0.45,
        "positives": 2,
        "negatives": 3
      },
      "calibration": {
        "matched": 0,
        "diverged": 0,
        "score": 0.5,
        "goldsCovered": 2
      },
      "contribution": {
        "submitted": 0,
        "approved": 2,
        "rejected": 3,
        "pendingReview": 0
      }
    }
  ],
  "goldStandards": {
    "count": 2,
    "items": [
      {
        "id": "1dbd4550-a50b-4bb0-9ef3-73f7a813c069",
        "trajectoryId": "00000000-0000-0000-0000-000000020001",
        "promotedByUserId": "00000000-0000-0000-0000-000000000001",
        "promotedByDisplayName": "Demo Admin",
        "promotedAt": "2026-05-14T...",
        "rubricCount": 4
      }
      // ... 1 more gold standard
    ]
  },
  "criticalViolations": {
    "count": 2,
    "recent": [
      {
        "trajectoryId": "00000000-0000-0000-0000-000000020001",
        "rubricId": "safety",
        "rubricName": "Safety",
        "raterId": "00000000-0000-0000-0000-000000000003",
        "raterDisplayName": "Demo Junior",
        "ts": "2026-05-14T..."
      }
      // ... 1 more violation
    ]
  }
}
```

**Sanity reading**:

- Reviewer trust = `77%` (admin verdict): 6 approved / 0 rejected → solid.
- Admin trust = `73%` (peer consensus, dashed border on UI badge): no
  admin verdicts target the admin themselves; falls back to peer alignment.
- Junior trust = `45%` (admin verdict): 2 approved / 3 rejected → drifting.
- Critical violations: 2 — both safety flags raised by Junior.

---

## 4. `POST /api/webhooks`

**Status**: `201`

Request:

```bash
curl -X POST https://labelhub-gamma.vercel.app/api/webhooks \
  -H 'Authorization: Bearer lh_ws_...' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://webhook.site/test-customer-api-stub",
    "events": ["annotation.approved", "annotation.rejected"]
  }'
```

Response:

```json
{
  "webhook": {
    "id": "122de491-ff14-433f-ae4b-2d0d4d235368",
    "url": "https://webhook.site/test-customer-api-stub",
    "eventTypes": ["annotation.approved", "annotation.rejected"],
    "enabled": true,
    "createdAt": "2026-05-14T15:37:17.023Z",
    "secret": "PmkmkHXvF_1Yoq6a1ZleKttXwZaRkkQvkF_NaOhF2aU"
  }
}
```

**Save the `secret` immediately** — it's only returned once on creation
and is the only key that lets you verify HMAC signatures on incoming
deliveries.

---

## 5. `GET /api/webhooks`

**Status**: `200`

```json
{
  "webhooks": [
    {
      "id": "122de491-ff14-433f-ae4b-2d0d4d235368",
      "url": "https://webhook.site/test-customer-api-stub",
      "eventTypes": ["annotation.approved", "annotation.rejected"],
      "enabled": true,
      "createdAt": "2026-05-14T15:37:17.023Z",
      "lastDeliveryAt": null,
      "lastDeliveryStatus": null,
      "failureCount": 0
    }
  ]
}
```

The `secret` is **not** returned here — only `id` + telemetry fields. If
you lost the secret, revoke + re-register.

---

## 6. `DELETE /api/webhooks/<id>`

**Status**: `200`

```json
{ "ok": true, "id": "122de491-ff14-433f-ae4b-2d0d4d235368" }
```

Soft-revoke: row stays in DB with `revokedAt` stamped, future deliveries
are skipped. Re-running this on an already-revoked id returns `404`
(`NOT_FOUND`).

---

## Full end-to-end flow

```text
Customer's agent → POST /api/proxy/doubao/chat/completions  (LabelHub captures trajectory)
                ↓
LabelHub annotators rate it on the web UI
                ↓
Admin clicks "approve" → emits annotation.approved event
                ↓
Webhook fanout → POST to customer's URL with HMAC signature
                ↓
Customer verifies, then GET /api/annotations/<id> for full mark detail
                ↓
Customer pipeline trains on the approved mark set
```

All 6 endpoints round-tripped in < 10s end-to-end against prod on the
day of writing.
