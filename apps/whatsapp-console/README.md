# TutWithUs Connect

An optional, standalone React + TypeScript + Vite prototype for a staff
conversation console. It is separate from the production public/admin frontend
in `apps/web`.

## Current status and architecture

This is a **local-data preview**, not a live WhatsApp staff console. Chats,
contacts, and call history are demo data held in the browser; changes do not
persist across reloads. Calls display a preview overlay only.

The app is not integrated with Meta messaging, staff authentication, or a
LiveKit staff-call workflow. The API has a separate, server-managed LiveKit
agent for automated WhatsApp inbound calls, but this UI does not control that
agent. The Vite `/api` proxy is configured for future integration; the current
screens do not call the API. No Status screen is included.

```text
src/
  main.tsx                     # React entry point
  App.tsx                      # Shell, navigation, and in-memory demo state
  App.css                      # App shell and navigation styles
  components/                  # Shared UI components
  screen/                      # Chats, calls, contacts, and call preview
  shared/                      # Types and local demo data
  styles.css                   # Global styles
public/                         # Static assets, including the TutWithUs logo
```

## Run locally

From the repository root:

```powershell
corepack pnpm install
corepack pnpm --filter @tutwithus/whatsapp-console dev
```

Vite runs on port 5174. The optional static site is configured in the root
`render.yaml`. The `.env.example` is intentionally empty. Do not put OpenAI, LiveKit, or other provider credentials in this frontend; those
belong in the API environment.

## Checks

```powershell
corepack pnpm --filter @tutwithus/whatsapp-console typecheck
corepack pnpm --filter @tutwithus/whatsapp-console build
```
