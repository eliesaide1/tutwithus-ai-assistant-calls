# TutWithUs API

The API is a Node.js/TypeScript modular monolith. It serves the public voice
session API and staff/admin APIs, and owns the persistence and server-side
integrations used by both browser voice calls and the optional WhatsApp calling
worker. The browser voice UI and admin console live in `apps/web`. The separate
`apps/whatsapp-console` is currently a local-data prototype and is not connected
to these APIs.

## Architecture

- **HTTP and application modules:** Express routes validate requests and apply
  authentication/authorization before calling business services. Feature
  services and repositories are organized under `src/modules/`; cross-module
  rules are enforced by ESLint.
- **Browser voice:** `src/transports/browser/` coordinates the WebRTC session
  handshake with OpenAI Realtime. `src/core/` owns transport-independent call
  control, tool authorization, retrieval, and session behavior. The API keeps
  provider credentials and the server-side sideband connection.
- **WhatsApp calling:** When `WHATSAPP_CALLING_ENABLED=true`, the API starts and
  manages a LiveKit agent as a child process. It shares the call tools,
  knowledge, session persistence, and TutWithUs integration; it is not a
  separate backend service. All supported WhatsApp locales use OpenAI Realtime
  for transcription, reasoning, and speech output. Saudi Arabic uses the
  locale-specific instructions and configured OpenAI voice.
- **Persistence and integrations:** MongoDB stores application records and is
  required for readiness. Redis is optional for queued maintenance jobs and
  cross-process call capacity. The server calls the TutWithUs API directly
  through the external-service adapter. OpenAI and LiveKit credentials stay on
  the server.
- **Contracts:** Zod schemas in `src/contracts/` define API contracts and feed
  the generated OpenAPI document in `openapi/openapi.json`. That document
  covers the shared public/browser voice contracts, not every admin route. It
  is generated for documentation/tooling and does not serve requests at runtime.

The browser requests microphone access only after the visitor accepts the
consent notice and presses Continue.

## Source structure

Each business feature keeps its routes, rules, persistence and model in one
folder under `modules/`. See
[`docs/architecture/API-STRUCTURE-CHANGES.md`](../../docs/architecture/API-STRUCTURE-CHANGES.md)
for the history of the layout.

```text
src/
  server.ts                    # Process startup, Mongo retry, shutdown
  container.ts                 # Composition root: optional Redis, clients, repositories
  config/env.ts                # Validates and exposes the environment
  contracts/                   # Shared schemas and OpenAPI registry
  db/                          # Mongo connection and readiness check
  http/
    app.ts                     # Express setup and global middleware
    app-dependencies.ts        # Dependency bag passed to route composition
    routes/api.routes.ts       # Builds feature services and mounts /api/v1 routers
    errors.ts                  # ApiError, error envelope, central error handler
    validation.ts              # parseInput(), ObjectIdSchema, UuidSchema
    health.routes.ts           # /healthz and /readyz
    middleware/                # request-context, validate-body, rate-limit
  lib/                         # Optional Redis, tokens, OpenAI clients (+ unit tests)
  external/                    # Server-side TutWithUs API integration
  jobs/                        # API-managed BullMQ consumer and HTTP fallback routes
  whatsapp/                    # LiveKit calling agent, started as an API child process
  core/                        # Transport-independent call logic
    session/                   #   SessionController (sideband events, limits, tamper check), call registry
    tools/                     #   Tool registry + policy-enforcing ToolGateway
    agent/, retrieval/         #   Prompt builder, knowledge retriever
  transports/browser/          # SDP connect: creates the call, opens the sideband, starts a SessionController
  platform/                    # Customer-directory and tutor-availability ports/adapters
  modules/
    admin-auth/                # Login, JWT cookies, CSRF, authorize(), role policies, passwords
    admin-users/               # Administrator-only user management
    audit/                     # Audit writer (hashes request IPs) and audit log
    bookings/                  # Booking queue, assignment and status rules
    escalations/               # Escalation status and ownership rules
    settings/                  # Versioned agent settings drafts and activation
    knowledge/                 # Document ingestion, text extraction, review lifecycle
    conversations/             # Admin transcript views (reads voice-sessions service)
    voice-sessions/            # Consent, session tokens, transcript, end
    tool-invocations/          # Audit record of every tool decision (TTL)
    public-config/             # Public locale/consent/duration config
openapi/openapi.json           # Generated OpenAPI 3.2 document
scripts/                       # Build, admin, maintenance, and OpenAPI commands
```

### Module conventions

- **File names** are `<entity>.<role>.ts`, for example `booking.routes.ts`,
  `booking.service.ts`, `booking.repository.ts`, `booking.model.ts`.
- **Routes** handle HTTP only: authenticate, apply a named role policy from
  `admin-auth.policies.ts`, check CSRF on mutations, parse a size-limited JSON
  body with `express.json()`, validate input with `parseInput()`, call the
  service, write the audit entry, and map the response through a contract schema.
- **Services** hold business rules (state transitions, role rules, conflict
  checks) and throw `ApiError`. A route may call a repository directly only
  for plain reads or writes that have no rules (settings, audit log).
- **Repositories** are an interface named `<Entity>Repository` plus a
  `Mongo<Entity>Repository` class. Tests replace them with fakes.
  Narrow ports used by another layer get descriptive names
  (`AdminIdentityStore`, `PublishedKnowledgeSearchStore`).
- **Cross-module imports** may target another module's service or types, never
  its repository or model. ESLint enforces this rule.
- **Composition**: `container.ts` builds clients and repositories;
  `http/routes/api.routes.ts` builds services and mounts routers.
- **Tests**: pure unit tests sit next to the code (`*.test.ts`); HTTP route and
  app integration tests live in `tests/`.

## How a live call is controlled

1. `POST /voice/sessions/:id/connect` reserves a capacity slot (`MAX_CONCURRENT_CALLS`,
   counted in Redis when configured, per process otherwise), then creates the OpenAI call
   with the server-defined instructions and tools and reads the call ID from the
   `Location` header.
2. The API opens a sideband WebSocket to that call **before** returning the SDP
   answer, so no tool call can run unsupervised. If it cannot open, the call is
   hung up and the slot released.
3. A `SessionController` then owns the call. It runs tool calls through the
   `ToolGateway` (unknown tool, bad arguments or an exhausted per-tool limit are
   denied; every decision is written to `tool_invocations`), sends each result
   after the requesting response finishes, stores both sides of the transcript
   (assistant turns carry the cited source IDs) and records token usage.
4. It ends the call at `maxCallSec` and after `IDLE_TIMEOUT_SEC` of silence (90
   seconds by default; the agent says goodbye first), when the agent calls
   `end_call`, when the visitor ends the session, on shutdown, or when a
   `session.updated` event shows the instructions, tool list or output mode
   changed. A tampered session is flagged `session_tampered`.
5. After the caller confirms the booking, the external-service adapter sends `POST /courses`
   and uses the returned `courseId` with the prepared description in a JSON
   `POST /courses/upload`. The booking is reported complete only after both
   upstream requests succeed; the browser does not upload a file.

The `ToolGateway` enforces a policy-controlled set of knowledge, escalation,
account, booking, and call-control tools. Any caller may request a human
follow-up after clear consent. Verified callers use the phone number on their
server-verified account; other callers use the number collected when the call
started. Contact numbers are kept out of normal session reads, stored on
consented escalation tickets, and exposed only to authorized follow-up staff.
Contact numbers are redacted from tool-invocation logs.

## Tool access by caller role

Public tools are shown to everyone. `request_member_id` and `verify_member_id`
remain public so a caller can verify before the server knows their role. After
successful verification, the server updates the model's tool list with only the
tools assigned to the verified role. The `ToolGateway` independently enforces
the same assignment, so a hidden tool cannot be invoked by guessing its name.
Tool access is required in each `defineTool` call; a new tool cannot silently
inherit public access.

| Access set | Tools |
| ---------- | ----- |
| Public | `search_knowledge`, `escalate_to_human`, `end_call`, `request_member_id`, `verify_member_id`, `get_subjects`, `get_booking_levels` |
| Student/parent | `get_my_bootcamps`, `get_my_wallet`, `check_subject_eligibility`, `get_booking_subjects`, `find_booking_tutors`, `check_tutor_availability`, `book_course` |
| Tutor | `get_my_tutor_availability` |
| Other roles | Public tools only, until explicitly assigned |

`data.role` from the verified login is normalized and kept only in server-side
call memory; neither the role nor the access token is sent to the model or
persisted. On browser calls, the API sends a Realtime `session.update` after
verification. WhatsApp refreshes the LiveKit agent's tools through
`Agent.updateTools`.

The browser account form posts the member ID to
`POST /voice/sessions/:id/account-check`; the server verifies it against the
trusted call-start phone. The response exposes only the coarse result and
never includes a customer ID, role, or token. Three attempts per call, plus a
per-IP limit. Safety and wellbeing mentions remain available to any caller. Booking tools
are omitted when their required TutWithUs integrations are not configured.

Configure `TUTWITHUS_API_URL` for the external TutWithUs API. The API and
WhatsApp worker call it directly through the server-side external-service
adapter; no standalone gateway process is required. `MONGODB_URI` remains
reserved for this assistant's own persistence.

The browser starts the greeting by sending a bare `response.create` once its
data channel is open; the server cannot tell when the caller's audio is ready.

## Local setup

1. If `.env` does not already exist, copy `apps/api/.env.example` to
   `apps/api/.env`.
   Preserve any existing `.env` rather than overwriting it. The template has
   a host-local MongoDB URL and clearly marked development consent notices; do
   not use those notices in production.

   ```powershell
   if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
   ```
2. Set `MONGODB_URI` to a MongoDB instance reachable from the host. Redis is
   optional: set `REDIS_URL` to enable API-managed BullMQ processing; leave it
   blank to process maintenance requests directly in the authenticated HTTP
   request path. If configured Redis is unreachable, the API also falls back
   to inline processing. Redis is not part of `/readyz`.

3. Start the API and web app together from the repository root:

   ```powershell
   corepack pnpm dev:stack
   ```

4. Open `http://localhost:5173`. Vite forwards `/api`, `/healthz` and `/readyz`
   to the API on port 3000. The API uses nodemon for automatic restarts when
   its TypeScript source files change. When
   `WHATSAPP_CALLING_ENABLED=true`, the API starts and stops the dedicated
   LiveKit agent child process with its own API lifecycle.

Use your Atlas URI in `MONGODB_URI` to store voice-session records and
transcripts in Atlas.
MongoDB creates the `voice_sessions` collection when the first consented voice
session is inserted; starting the API alone does not create that collection.
Include a database name in the Atlas URI (for example, `/tutwithus_dev` before
any query options); if it is omitted, MongoDB uses the `test` database.

## Implemented endpoints

- `GET /healthz`: process liveness; touches no dependencies.
- `GET /readyz`: readiness; returns 503 if MongoDB is unavailable. Redis is
  optional and does not block API readiness.
- `GET /api/v1/public/config`: supported locales, consent version/text, and
  maximum call duration.
- `POST /api/v1/voice/sessions`: requires explicit consent acceptance and the
  current consent version. Creates a MongoDB voice-session record with an empty
  transcript, hashes the returned short-lived session token at rest, and
  returns a session ID/token and duration.
- `POST /api/v1/voice/sessions/:sessionId/connect`: requires that session's
  bearer token and one-time use. Validates consent/session state, relays the
  browser SDP offer to OpenAI Realtime over the server-only SDK, and returns only
  the SDP answer.
- `POST /api/v1/voice/sessions/:sessionId/end`: requires the session bearer
  token and marks the session ended. The browser also closes its peer
  connection and stops microphone tracks.
- `POST /api/v1/voice/sessions/:sessionId/transcript`: requires the active
  session bearer token and stores each completed caller or assistant
  transcription event in that session's `transcript` array. The realtime
  session enables input-audio transcription; audio itself is not persisted.
  Transcript entries expire with the session using the configured TTL.
- `GET /api/v1/admin/knowledge/documents`: lists stored knowledge sources for
  administrators and editors.
- `POST /api/v1/admin/knowledge/documents`: editors and administrators can
  upload PDF, DOCX, and TXT sources. New sources are saved as drafts and are
  not made searchable until an administrator publishes them.
- `PATCH /api/v1/admin/knowledge/documents/:sourceId/status`: applies the
  draft -> in-review -> approved -> published lifecycle. Publishing activates
  the indexed passages; archiving deactivates them. Mutations require CSRF.
- `GET /api/v1/admin/conversations`: lists retained sessions, with optional
  `locale` and `status` filters.
- `GET /api/v1/admin/conversations/:sessionId`: returns the stored transcript
  for an authorized admin, agent, or viewer. Transcripts follow the existing
  voice-session TTL and are not copied into a second collection.
- `GET /api/v1/admin/booking-requests`: lists bookings for administrators and
  agents, with an optional status filter. Contact fields are administrator-only.
- `POST /api/v1/voice/sessions/:sessionId/booking-requests`: submits a selected
  tutor/session request from an active, verified voice session. The customer ID
  comes from server-side verification, and the server enforces the two-day
  minimum notice.
- `PATCH /api/v1/admin/booking-requests/:id`: lets an agent assign a booking to
  themselves and confirm or handle submitted requests; administrators may also
  assign bookings and cancel submitted requests. Confirmation enforces the
  two-day minimum again. Notes are limited and audited without recording their
  contents in the audit diff.
- `GET /api/v1/admin/escalations`: lists escalations for administrators and
  agents, with optional status and priority filters. Consented callback numbers
  are available only to administrators and agents who handle the queue.
- `PATCH /api/v1/admin/escalations/:id`: allows claiming, resolving, reopening
  closed tickets, and adding notes. Agents can resolve only escalations assigned
  to them; reopening a closed ticket is administrator-only and clears its former
  assignee.
- `GET /api/v1/admin/settings`, `PUT /api/v1/admin/settings/draft`, and
  `POST /api/v1/admin/settings/activate`: administrator-only versioned settings
  workflow. Settings are persisted, but are not yet applied to live calls.
- `GET /api/v1/admin/users`, `POST /api/v1/admin/users`, and
  `PATCH /api/v1/admin/users/:id`: administrator-only user management. The API
  protects the current administrator and the last enabled administrator.
- `GET /api/v1/admin/audit`: administrator-only audit history. Audit diffs
  exclude note contents and contact details.
- `POST /api/v1/admin/jobs/ping`: administrator-only diagnostic endpoint. It
  queues the ping when Redis is ready and returns `202`; without a working queue
  it processes inline and returns `200`. Mutations require the admin CSRF token.

Admin sessions support `admin`, `editor`, `agent`, and `viewer` role claims.
The role-specific admin pages and user provisioning workflow are available.
Existing databases have a unique role index from the single-admin bootstrap;
remove it before provisioning multiple users:

```powershell
corepack pnpm --filter @tutwithus/api admin:migrate-roles
```

Session creation is limited to five requests per API-observed IP per ten
minutes. Set `API_TRUST_PROXY_HOPS` only when the API is behind a trusted proxy.
Call limits use Redis across API processes when available and process-local
memory otherwise.

Connection attempts are limited to ten requests per API-observed IP per ten
minutes. The session token is accepted only in the `Authorization: Bearer`
header; it is retained in browser memory and is never placed in a URL or
persisted in clear text. Its expiry covers the start window, configured maximum
call duration, and a short cleanup grace period.

`OPENAI_API_KEY` is consumed only by the API process. The browser sends the SDP
offer to TutWithUs and never receives the provider key. The current provider
adapter uses the OpenAI Realtime WebRTC endpoint and expects the configured
`OPENAI_REALTIME_MODEL` to be a Realtime model enabled for the OpenAI project
(the development example is `gpt-realtime-2.1-mini`). Responses use the `marin`
voice by default or the voice selected in active Agent Settings. The server
session instructions are language-specific and prohibit unverified claims.
Knowledge search, escalation, ending the call, account checks, and direct
TutWithUs course booking run on the server through the sideband connection (see
"How a live call is controlled"). A booking is confirmed only when the upstream
TutWithUs API confirms it; local admin booking-request routes remain a separate
staff workflow.

The 30-day local record expiration follows the architecture PDF's stated
retention assumption. Confirm the actual retention policy and consent wording
with TutWithUs before production. The development notices in `.env.example`
are sample text only.

## Verification

Run the API tests and web tests from the repository root:

```powershell
corepack pnpm test
corepack pnpm build
```

Test the running local services:

```powershell
curl.exe -i http://localhost:3000/healthz
curl.exe -i http://localhost:3000/readyz
curl.exe -i http://localhost:3000/api/v1/public/config
```

After obtaining the current `consentVersion` from public config, create a
session with explicit consent. A real `/connect` request requires the SDP offer
generated by a browser peer connection; do not fabricate one for a provider
call.

```powershell
$body = @{
  locale = "en"
  consentVersion = "2026-11-04.1"
  consentAccepted = $true
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/api/v1/voice/sessions" `
  -ContentType "application/json" `
  -Body $body
```

Use the version returned by `/api/v1/public/config` if it differs from the
example above. Expected result: HTTP 201 and a session ID, a short-lived token,
and maximum duration. Try `consentAccepted = $false` or a stale version to
verify the API rejects the request. A real call additionally requires an
eligible OpenAI project key, access to the configured Realtime model,
microphone permission, and
localhost or HTTPS.
