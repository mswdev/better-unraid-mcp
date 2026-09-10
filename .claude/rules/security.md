# Security

## No-Touch Zones

These files require **explicit approval** before any modification:

- `schema/unraid.graphql` — vendored SDL, regenerate via `npm run schema:update`, never hand-edit.
- `src/types/unraid/**` — generated, never hand-edit (run `npm run generate`).
- Never log `UNRAID_API_KEY` or include it in tool output/errors.
- Never execute a destructive GraphQL mutation without the `requireConfirmation` gate.

- Any `.env*` files, deployment configs, or CI/CD workflows
- Database migration files
- Authentication/authorization configuration
- Cryptography or encryption modules
- Financial calculation modules

## Security Rules

- **NEVER hardcode secrets in source code**
- **NEVER run destructive DB operations** (DROP, TRUNCATE, DELETE without WHERE)
- **Validate all API input** — NEVER TRUST CLIENT INPUT (use Joi, Zod, or equivalent)
- **Flag security concerns proactively** — exposed secrets, SQL injection, missing auth, XSS, CSRF, etc.
