# Zenhyre 2.0

Spec: docs/superpowers/specs/2026-11-05-zenhyre-2-design.md

## Dev
pnpm install
pnpm test:db:start          # local Postgres 16 on :5433
export DATABASE_URL=postgres://zenhyre:zenhyre@localhost:5433/zenhyre
pnpm db:migrate && pnpm db:seed
pnpm -r build && pnpm test
pnpm --filter @zenhyre/api dev   # API on :4000 (emails go to an in-memory transport when RESEND_API_KEY is unset)

## Web app (candidate, company and association seats)
APP_BASE_URL=http://localhost:3000 pnpm --filter @zenhyre/api dev   # API on :4000, prints sign-in links
pnpm --filter @zenhyre/prototype dev                                 # app on :3000
pnpm --filter @zenhyre/api issue:association -- --campus IITD --email admin@alumni.example --name "IIT Delhi Alumni Association"   # creates an association login
See apps/prototype/README.md (login, sessions, what is live) and apps/prototype/DESIGN.md.
