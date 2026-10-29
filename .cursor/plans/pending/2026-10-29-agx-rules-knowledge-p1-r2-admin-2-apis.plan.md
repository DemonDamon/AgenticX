# R2 Admin A2 — writable APIs

## Goal
Admin APIs for session list/detail/respond/seed under `/api/admin/disambiguation/*`.

## Deliverables
- `GET/POST .../sessions`
- `GET .../sessions/[id]`
- `POST .../sessions/[id]/respond`
- `POST .../seed` (Brand-A reseed)
- Auth via `requireAdminScope`

## Done when
APIs return protocol-shaped JSON; respond completes/cancels sessions.

## Status
Done.
