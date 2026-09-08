# Standards

Rules and contracts to preserve.

- [Data Schema & API Contract](data-schema.md) — the `src/db/` schema and
  function signatures that downstream features depend on.
- [WorkDay Import HTTP API](import-http-api.md) — the `/api/preview` and
  `/api/confirm` request/response contract.
- [Headcount HTTP API](headcount-http-api.md) — the read-only
  `GET /api/headcount` contract and its accepted data-exposure risk.
- [Employee Details HTTP API](employee-details-http-api.md) — the read-only
  `GET /api/employee-details` contract, its `rating_period`-to-key mapping,
  and its `Cache-Control: no-store` header.
- [Location Colour Buckets](location-colour-buckets.md) — the country →
  colour mapping and its fixed, contrast-checked colour values.
