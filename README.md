# HR Nexus — Phase 1

Enterprise SaaS HR & Workflow Platform foundation built from scratch for Cloudflare Workers + D1.

## Scope
Phase 1 establishes the application shell, RTL Arabic design system, employee UI foundation, tenant/authentication/authorization foundations, organization structure foundation, and D1 migration architecture.

Complex HR engines are intentionally not implemented yet.

## Database
- D1 binding: `DB`
- Database: `hr-nexu`
- Database ID: `6010e3ea-b8a7-44a6-bf79-bb45bdcba837`
- Migrations: `db/migrations`

## Local setup
```bash
npm install
npm run db:migrate:local
npm run dev
```

## Production migration
Run only when explicitly preparing a deployment:
```bash
npm run db:migrate:remote
```

## Build
```bash
npm run typecheck
npm run build
```

## Deployment
Deployment is intentionally not performed by this Phase 1 build. When approved:
```bash
npm run deploy
```
