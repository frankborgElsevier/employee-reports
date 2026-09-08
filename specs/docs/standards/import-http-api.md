# WorkDay Import HTTP API

The request/response contract for `src/server/app.ts` (spec
[002-workday-import](../../features/002-workday-import/spec.md)). Both
routes require a matching `Origin` header (localhost-only, no other
authentication) and reject a missing or mismatched one with `403`.

## `POST /api/preview`

`multipart/form-data`, one file under the field name `file`. Never commits
anything — always a dry run.

| Status | Meaning | Body |
| --- | --- | --- |
| `200` | The preview was computed — check `outcome` | `{ outcome: "success", counts, token }` or `{ outcome: "failure", error }` |
| `400` | The server couldn't even attempt a preview | `{ error }` — no file, wrong field name, or the workbook itself is unparseable/missing required headers/has zero data rows |
| `403` | `Origin` header missing or mismatched | `{ error }` |
| `409` | Another import is already pending confirmation | `{ error }` |
| `413` | Upload exceeds the compressed size limit (Multer), or the ZIP-preflight/row-count limits | `{ error }` |

`outcome: "success"` means the reconciliation *would* succeed — `counts` is
`{ added, updated, inactivated }`, and `token` is required to confirm.
`outcome: "failure"` means a specific row's content is invalid (or a spec
001 integrity error, e.g. a supervisor cycle) — `error` names it; no token
is issued, since there's nothing to confirm.

Counts and reconciliation scope include WorkDay-imported employees only.
Manually entered contractors are not updated, inactivated, matched, reviewed,
or included in `counts`.

## `POST /api/confirm`

`application/json`, body `{ "token": "..." }`.

| Status | Meaning | Body |
| --- | --- | --- |
| `200` | Re-ran and committed (or the retained file's reconciliation now fails) | `{ outcome: "success", counts }` or `{ outcome: "failure", error }` |
| `400` | Unknown or expired token | `{ error }` |
| `403` | `Origin` header missing or mismatched | `{ error }` |

A successful confirm's `counts` should always match the preview's, since
the pending-import guard (`409` above) prevents anything else from writing
to the database in between. The retained upload is deleted after a commit,
a confirm-time failure, or the token's 5-minute expiry — never left behind.
