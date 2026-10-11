# Project Handoff

> Schema version: 1

## Handoff metadata

- **Project:** `C:\Users\hifia\Projects\AgentRunner`
- **Last updated:** `2026-10-10 18:01 -07:00`
- **Status:** `Complete (Phase 3 Project Path Deduplication & Notification Banner Verified)`
- **Evidence boundary:** Workspace files, Git metadata, and test/lint/build/playwright runs verified on 2026-10-10. No `.env` file was inspected or searched.

## Mission and scope

- **Goal:** Deliver a local-only coding-agent hub that prepares an approved continuation brief and hands the user into Codex's native cross-project resume picker.
- **In scope:** TypeScript Fastify/WebSocket backend, OpenRouter assistant provider with free model routing (`openrouter/free` and `:free`), project aliases with folder picker browse, tilde path expansion (`~/...`), project directory scanning (`POST /api/v1/projects/scan`), persistent project storage (`.agent-tasks/projects.json`), project path deduplication by canonical root, temporary red duplicate notification banner (`#ff0f0f`), auto-discovery of project evidence (`HANDOFF.md`, `.agent-tasks/`, `git status`), real-time ephemeral progress states in-feed, uncompressed ChatGPT-style brief layout, inline 1-click project registration card in chat feed, multi-turn chat history, CLI debug tool (`npm run cli`), Codex PTY control, local single-server dashboard with 3 independent scroll regions, sticky composer, and embedded terminal takeover.
- **Out of scope:** Additional assistant providers, Antigravity adapter, Codex transcript/session indexing, LAN/cloud deployment, autonomous completion, and unsafe Codex bypass flags.

## Current state

Workspace-confirmed: Repository on branch `feature/assistant-v0-1`.
Workspace-confirmed: All 18 test suites (65 tests) pass cleanly (`vitest run`).
Workspace-confirmed: ESLint clean (0 errors, 0 warnings).
Workspace-confirmed: Production build clean (`tsc --noEmit && vite build`).
Workspace-confirmed: Playwright browser verification passed:
  1. `~/Projects` directory scan (26+ repositories registered) & Capstone auto-discovery ([.agent-tasks/phase2-capstone-autodiscovered-brief.png](.agent-tasks/phase2-capstone-autodiscovered-brief.png)).
  2. Duplicate path detection rendering red banner `#ff0f0f` with white text ([.agent-tasks/duplicate-banner-verified.png](.agent-tasks/duplicate-banner-verified.png)).

## Completed work

- Initial repository setup and frozen behavioral contracts.
- Backend services: Fastify application, launch-token verification, HttpOnly terminal session cookie, project registry with `~` path expansion, session manager, ConPTY terminal supervisor.
- Project persistence, scan & deduplication:
  - Canonical root path deduplication on `add()`, `scanDirectory()`, and `load()`.
  - Atomic disk persistence (`.agent-tasks/projects.json`), directory scanning (`POST /api/v1/projects/scan`), rename (`PATCH`), and delete (`DELETE`).
  - Existing duplicates in storage (`agentrunner` and `my-app`) sanitized on load.
- Evidence auto-discovery: Backend automatically reads `HANDOFF.md`, `.agent-tasks/` documents (`PLAN.md`, `DECISIONS.md`, `TASKS.md`), and executes `git status --short` in project root.
- Modern folder picker: Migrated to Windows File Explorer dialog style (`System.Windows.Forms.OpenFileDialog` with `FileName = 'Select Folder'`).
- Interactive CLI debug utility: `src/cli/main.ts` (`npm run cli -- <args>`) supporting `status`, `projects`, `register`, `brief`, and `terminals`.
- React UI:
  - 3-column dark flat layout (#121212/#171717) with independent scrolling for thread history, chat feed, and request controls.
  - Sticky composer at the bottom that clears on submit.
  - Append-only multi-turn chat message history.
  - Temporary `#ff0f0f` red duplicate notification banner ("One or more duplicates were attempted to be added and were ignored.").
  - Ephemeral in-feed progress status indicator during brief generation.
  - Uncompressed (full-height ChatGPT-style) brief response display.
  - "Scan Directory..." button and per-project rename & delete buttons.
  - Conversational project inference with disambiguation across multiple registered projects.
  - Embedded xterm.js terminal with WebSocket cookie auth.

## Verification evidence

| Check | Command or manual procedure | Result | Evidence level |
| --- | --- | --- | --- |
| Tests | `npm test` | 18 test files passed, 65 tests passed | Verified |
| Linter | `npm run lint` | ESLint passed (0 errors, 0 warnings) | Verified |
| Typecheck & Build | `npm run build` | `tsc --noEmit && vite build` passed clean | Verified |
| CLI Tool | `npm run cli -- help` | Help output rendered, commands verified | Verified |
| Playwright Phase 2 Flow | `python .agent-tasks/verify_phase2_flow.py` | 26 projects scanned, Capstone evidence auto-discovered, uncompressed brief verified | Verified |
| Playwright Duplicate Banner | `python .agent-tasks/verify_duplicate_banner.py` | Verified `#ff0f0f` background, `#ffffff` text, single banner limit, duplicate rejected | Verified |

## Relevant files

- [src/server/projects/project-registry.ts](file:///C:/Users/hifia/Projects/AgentRunner/src/server/projects/project-registry.ts) — Deduplicating, persistent project registry.
- [src/client/App.tsx](file:///C:/Users/hifia/Projects/AgentRunner/src/client/App.tsx) — Main React UI with `#ff0f0f` duplicate banner & uncompressed cards.
- [src/client/styles.css](file:///C:/Users/hifia/Projects/AgentRunner/src/client/styles.css) — Duplicate banner styling (`#ff0f0f`).
- [start.sh](file:///C:/Users/hifia/Projects/AgentRunner/start.sh) — Single-server launcher script.

## Owner-only actions

- Run `bash start.sh` and open the printed `http://127.0.0.1:4310/#token=...` URL.
- Test registering a project with an already registered path to view the `#ff0f0f` notification banner.
