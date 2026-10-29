# R2 Portal P2 — writable APIs

## Goal
Portal APIs under `/api/disambiguation/*` using runtime store + session cookie auth.

## Deliverables
- `GET/POST .../sessions`
- `GET .../sessions/[id]`
- `POST .../sessions/[id]/respond`
- `POST .../seed` (Brand-A reseed)

## Done when
APIs return `{ code, message, data }`; respond completes/cancels.

## Status
Done.
