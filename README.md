# TutWithUs AI Receptionist

This pnpm monorepo contains the API, production web app, a separate WhatsApp
console prototype, and a scripted evaluation harness. The system is based on
the TutWithUs architecture described in
`docs/architecture/TutWithUs-AI-Receptionist-Architecture.pdf`.

```bash
git clone https://github.com/eliesaide1/tutwithus-ai-assistant-calls.git
cd tutwithus-ai-assistant-calls
```

> **A note on `docs/`.** The documentation tree is excluded from version
> control by `.gitignore`, so every `docs/...` path mentioned below exists
> only in a local working copy — not in this repository. Paths are written as
> code rather than links for that reason.

## Architecture

| Project | Responsibility |
| --- | --- |
| [`apps/api`](apps/api/README.md) | Node.js 24 / TypeScript Express modular monolith. Serves public voice and admin APIs, applies business rules, persists data, and owns provider integrations. |
| [`apps/web`](apps/web/README.md) | Production React + Vite frontend: public voice experience at `/` and staff admin console at `/admin/*`, including knowledge, conversation, booking, escalation, settings, user, and audit workflows. |
| [`apps/whatsapp-console`](apps/whatsapp-console/README.md) | Separate React + Vite staff-console prototype. It currently uses local demo data and is not integrated with Meta messaging, staff authentication, or LiveKit staff calls. |
| [`evals`](evals/README.md) | Scripted evaluations of the receptionist's instructions and tool behavior. Live model evaluations require an OpenAI key and incur provider usage. |

The API is a **modular monolith with DDD-lite module boundaries**, not a
separate gateway plus microservices. Business modules contain the relevant
routes, services, repositories, and models. The browser voice transport and
WhatsApp agent share server-side call logic and tools. MongoDB stores
voice-session, knowledge, and staff-workflow data. Redis is optional for
background jobs and shared call-capacity limits. The API calls the TutWithUs
platform API through a server-side adapter.

The production voice page obtains explicit consent before starting a call. The
API creates the Realtime session, keeps the provider credentials, and controls
server-side tools; caller and assistant transcripts are persisted when
available, but audio recordings are not. English and French use OpenAI Realtime
audio. For Saudi Arabic, OpenAI Realtime supplies caller transcription and
assistant text, while the browser streams synthesized speech from ElevenLabs
through the API.

When `WHATSAPP_CALLING_ENABLED=true`, the API starts and manages a LiveKit
WhatsApp calling agent as a child process. This automated inbound-call worker
is separate from the WhatsApp console prototype. Live WhatsApp use also
requires valid Meta webhook and LiveKit SIP configuration; see
`docs/whatsapp-call-webhooks.md`.

OpenAI, ElevenLabs, and LiveKit credentials belong in the API environment.
Never put provider secrets in frontend `VITE_` variables.

## Local development

Requirements: Node.js 24 (see `.nvmrc`), Corepack, and MongoDB. Install
workspace dependencies and create the API environment file only if it does
not already exist:

```powershell
corepack pnpm install
if (-not (Test-Path apps/api/.env)) {
  Copy-Item apps/api/.env.example apps/api/.env
}
```

Set `MONGODB_URI` in `apps/api/.env` to a MongoDB instance reachable from your
machine. Redis is optional; without it, maintenance work runs inline and call
capacity limits are process-local. Leave `VITE_API_BASE_URL` unset or empty for
local development so Vite proxies `/api`, `/healthz`, and `/readyz` to the API
on port 3000.

Start the API and production web app together:

```powershell
corepack pnpm dev:stack
```

Open `http://localhost:5173`. This command does not start the separate
WhatsApp console or enable the WhatsApp agent. The agent remains disabled
unless `WHATSAPP_CALLING_ENABLED=true` and its required configuration is
provided.

| Command | Starts |
| --- | --- |
| `corepack pnpm dev` | Production web app (Vite) on port 5173 |
| `corepack pnpm dev:api` | API on port 3000 |
| `corepack pnpm --filter @tutwithus/whatsapp-console dev` | Console prototype on port 5174 |
| `corepack pnpm job:ping` | Admin diagnostic job; requires configured admin credentials |

The API logs to stdout and local rotating files under `apps/api/logs/`.
Render collects stdout; its local filesystem is ephemeral unless a persistent
disk is configured.

## Checks

| Command | Runs |
| --- | --- |
| `corepack pnpm check` | Lint, formatting check, typecheck, tests, and builds |
| `corepack pnpm lint` | ESLint, including architecture import boundaries |
| `corepack pnpm format:check` | Prettier check |
| `corepack pnpm typecheck` | TypeScript checks for workspace packages |
| `corepack pnpm test` | Vitest suites for workspace packages |
| `corepack pnpm build` | Web and console bundles, API server bundle, and WhatsApp agent bundle |
| `corepack pnpm eval` | Live scripted model evaluation; requires `OPENAI_API_KEY` and incurs usage |

## Deployment

Two targets are declared in this repository. Both inject `PORT`, which
`apps/api/src/config/env.ts` reads ahead of `API_PORT`; local API development
uses `API_PORT` from `apps/api/.env`. In either case, configure API secrets in
the host's environment dashboard and never in the frontend build environment.

### Render

The root [render.yaml](render.yaml) declares the API service and static sites
for the production web app and console prototype. Set `VITE_API_BASE_URL` to
the public API origin for the deployed web app; it is a public URL, not a
secret.

### DigitalOcean App Platform

[.do/app.yaml](.do/app.yaml) declares the API as a service and the production
web app as a static site in a single app, with the frontend routed at `/` and
the API at `/api` behind `preserve_path_prefix`. Because both share one origin,
`VITE_API_BASE_URL` stays unset so the bundle calls relative `/api` paths, and
no CORS allowlist is required.

```bash
doctl apps spec validate .do/app.yaml --schema-only   # offline schema check
doctl apps create --spec .do/app.yaml
doctl apps update <APP_ID> --spec .do/app.yaml
```

The spec intentionally contains no secret values. The keys it expects —
including the ones the API refuses to start without in production — are listed
in a comment block at the bottom of the file. Note that the WhatsApp console
prototype is not included in this spec; serving a second SPA under a subpath
would require a Vite `base` setting.

## Documentation

Start at `docs/README.md`. It links to the API,
WhatsApp readiness, admin, evaluation, and tool guides. See
`docs/assistant-readiness.md` for deployment checks and
provider/configuration requirements.
