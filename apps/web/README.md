# TutWithUs Web

The production React + Vite frontend for the public voice experience and staff
admin console. It uses the API in `apps/api`; it does not contain provider
credentials or call OpenAI directly.

## Architecture

- `/` renders the public voice page. It loads public configuration, obtains
  explicit consent, and uses the API to create and manage a short-lived voice
  session. The browser handles the WebRTC media connection; the API keeps the
  provider key and controls the server-side session.
- `/admin/*` renders the staff console for authentication and administration.
  Its pages call the API's authenticated admin endpoints.
- `apps/whatsapp-console` is a separate preview app. The production web app and
  the preview console do not share runtime state.

## Source layout

```text
src/
  main.tsx                     # React mount and global styles
  App.tsx                      # Browser routes: / and /admin/*
  AP_App.tsx                   # Compatibility export for App
  components/ui/               # Shared UI components
  interceptors/                # Axios client and request/response interceptors
  screen/
    voice/                     # Public voice UI and browser call helpers
    admin/                     # Staff UI, admin API client, and admin pages
  shared/                      # Public API client, translations, and brand data
    locales/                   # ar-SA, en, and fr translations
  main.css                     # Global styles and design tokens
tests/                          # Vitest and Testing Library tests
public/                         # Static assets served as-is
```

## Local development

Install dependencies from the repository root, then start the app:

```powershell
corepack pnpm install
corepack pnpm --filter @tutwithus/web dev
```

Vite runs on port 5173 and proxies `/api`, `/healthz`, and `/readyz` to the API
on port 3000 when `VITE_API_BASE_URL` is unset. Set `VITE_API_BASE_URL` to the
public API origin when deploying separately. It is embedded at build time and
must never contain a secret. The root `render.yaml` supplies the deployment
configuration.

OpenAI, ElevenLabs, and LiveKit credentials belong only in the API environment,
never in this app's Vite variables.

## Checks

```powershell
corepack pnpm --filter @tutwithus/web typecheck
corepack pnpm --filter @tutwithus/web test
corepack pnpm --filter @tutwithus/web build
```
