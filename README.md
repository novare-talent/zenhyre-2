# Zenhyre 2.0

Spec: docs/superpowers/specs/2026-11-05-zenhyre-2-design.md

## Dev
pnpm install
pnpm test:db:start          # local Postgres 16 on :5433
export DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre
pnpm db:migrate && pnpm db:seed
pnpm -r build && pnpm test
pnpm --filter @zenhyre/api dev   # API on :4000 (emails go to an in-memory transport when RESEND_API_KEY is unset)
