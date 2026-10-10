# Project Handoff

> Schema version: 1

## Handoff metadata

- **Project:** `C:\Users\hifia\Projects\AgentRunner`
- **Last updated:** `2026-10-10 14:35 -07:00`
- **Status:** `Complete (v0.1 Implementation & Enhancements Ready for Owner Smoke)`
- **Evidence boundary:** Workspace files, Git metadata, and test/lint/build runs verified on 2026-10-10. No `.env` file was inspected or searched.

## Mission and scope

- **Goal:** Deliver a local-only coding-agent hub that prepares an approved continuation brief and hands the user into Codex's native cross-project resume picker.
- **In scope:** TypeScript Fastify/WebSocket backend, OpenRouter assistant provider with free model routing (`openrouter/free` and `:free`), project aliases with folder picker browse, heuristic project inference and clarification, evidence assembly, Codex PTY control, local single-server dashboard with 3 independent scroll regions, sticky composer, and embedded terminal takeover.
- **Out of scope:** Additional assistant providers, Antigravity adapter, Codex transcript/session indexing, LAN/cloud deployment, autonomous completion, and unsafe Codex bypass flags.

## Current state

Workspace-confirmed: Uncommitted repository on branch `feature/assistant-v0-1`.
Workspace-confirmed: All 14 test suites (33 tests) pass cleanly (`vitest run`).
Workspace-confirmed: ESLint clean (0 errors, 0 warnings).
Workspace-confirmed: Production build clean (`tsc --noEmit && vite build`).

## Completed work

- Initial repository setup and frozen behavioral contracts.
- Backend services: Fastify application, launch-token verification, HttpOnly terminal session cookie, project registry, session manager, ConPTY terminal supervisor.
- Provider integration: Extensible registry with OpenRouter adapter filtering `:free` models and supporting `openrouter/free`, plus descriptive error reporting.
- Native folder picker: `POST /api/v1/system/browse-folder` endpoint executing Windows PowerShell FolderBrowserDialog safely without injection vectors.
- Single-server runner: `start.sh` building UI and launching loopback Fastify server serving `dist/` with `#token=...` fragment bootstrap.
- React UI:
  - 3-column dark flat layout (#121212/#171717) with independent scrolling for thread history, chat feed, and request controls.
  - Sticky composer at the bottom.
  - 2-step heuristic project inference with confirmation and multi-project clarification cards.
  - Project catalog inspector panel displaying registered projects with click-to-view details and folder picker browse button.
  - Embedded xterm.js terminal with WebSocket cookie auth.

## Verification evidence

| Check | Command or manual procedure | Result | Evidence level |
| --- | --- | --- | --- |
| Tests | `npm test` | 14 test files passed, 33 tests passed | Verified |
| Linter | `npm run lint` | ESLint passed (0 errors, 0 warnings) | Verified |
| Typecheck & Build | `npm run build` | `tsc --noEmit && vite build` passed clean | Verified |

## Relevant files

- [src/server/app.ts](file:///C:/Users/hifia/Projects/AgentRunner/src/server/app.ts) — API endpoints & static server.
- [src/server/system/folder-picker.ts](file:///C:/Users/hifia/Projects/AgentRunner/src/server/system/folder-picker.ts) — Safe native folder browser dialog.
- [src/server/providers/openrouter-provider.ts](file:///C:/Users/hifia/Projects/AgentRunner/src/server/providers/openrouter-provider.ts) — Free model filter and OpenRouter adapter.
- [src/client/App.tsx](file:///C:/Users/hifia/Projects/AgentRunner/src/client/App.tsx) — Main React orchestration interface.
- [src/client/project-inference.ts](file:///C:/Users/hifia/Projects/AgentRunner/src/client/project-inference.ts) — Project inference logic.
- [src/client/styles.css](file:///C:/Users/hifia/Projects/AgentRunner/src/client/styles.css) — Independent scrolling layout & styling.
- [start.sh](file:///C:/Users/hifia/Projects/AgentRunner/start.sh) — Single-server launcher script.

## Owner-only actions

- Ensure `OPENROUTER_API_KEY` is placed in `.env` (using `.env.example` as guide).
- Run `bash start.sh` and open the printed `http://127.0.0.1:4310/#token=...` URL.
- Test browsing a folder, registering a project, drafting a brief, and taking over a Codex session in the terminal.
