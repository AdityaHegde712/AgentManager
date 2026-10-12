# AgentRunner Tasks
  
1. [x] Initialize repository and freeze behavioral tests.
2. [x] Implement provider registry and OpenRouter adapter.
3. [x] Implement evidence, terminal, token, and session-concurrency services.
4. [x] Implement initial chat-first orchestration shell and single-server launch flow.
5. [x] Revisions and enhancements:
   - [x] Step 1: OpenRouter free models filter (`:free`), add `openrouter/free` router option, and explicit health/model error propagation in server & client.
   - [x] Step 2: Native Windows folder picker endpoint (`POST /api/v1/system/browse-folder`) via PowerShell dialog script with unit/integration test.
   - [x] Step 3: Conversational 2-step heuristic project inference helper and confirmation / clarification chat cards.
   - [x] Step 4: Registered project catalog inspection panel (view names and roots with click-to-view).
   - [x] Step 5: Independent scrolling for thread list, chat feed, and request controls rail + sticky composer.
6. [x] Quality gate: Run unit/integration tests, lint, and build.
7. [x] Usability & CLI Enhancements (Phase 1):
   - [x] Step 1: Tilde (`~`) path expansion in `ProjectRegistry`.
   - [x] Step 2: Inline 1-click project registration / discovery card when an unregistered path or candidate is detected.
   - [x] Step 3: True append-only chat history in `App.tsx` with composer clearing on submit.
   - [x] Step 4: Lightweight CLI debugging command (`npm run cli -- <args>`) to test backend flows without browser.
   - [x] Step 5: Playwright verification of Capstone handoff flow.
8. [x] Phase 2: Auto-Discovery, Ephemeral Progress, Project Persistence & Scan, Modern Dialog, and Uncompressed UI:
   - [x] Step 1: Backend evidence auto-discovery (`src/server/evidence/auto-discover.ts`) for `HANDOFF.md`, `.agent-tasks/`, and `git status`.
   - [x] Step 2: Project persistence (`projects.json`), folder scan endpoint (`POST /api/v1/projects/scan`), delete, and rename.
   - [x] Step 3: Modern Windows Explorer folder picker script in `src/server/system/folder-picker.ts`.
   - [x] Step 4: Ephemeral progress state in client chat feed & uncompressed (full-height ChatGPT-style) brief display.
   - [x] Step 5: Automated Playwright browser verification script testing Capstone auto-discovery, folder scan, and uncompressed UI.

All Phase 2 steps completed and verified with Playwright end-to-end browser automation!

9. [x] Phase 3: Project Path Deduplication & Notification Banner:
   - [x] Step 1: Backend deduplication by canonical root path in `ProjectRegistry` (`add`, `scanDirectory`, and `load`), returning `duplicate_ignored: boolean` on add and counting duplicates in scan.
   - [x] Step 2: Frontend temporary red notification banner (`#ff0f0f` background, white text) with message: "One or more duplicates were attempted to be added and were ignored."
   - [x] Step 3: Unit and integration tests for path deduplication and API contracts.
   - [x] Step 4: Automated Playwright browser verification testing duplicate registration triggers the red banner.

10. [x] Phase 4: UI Polish, Emulated Streaming, and Non-persistent Confirmation:
   - [x] Step 1: Add margin and gap between composer text area and action button row in `src/client/styles.css`.
   - [x] Step 2: Make project confirmation cards non-persistent in `src/client/App.tsx` (remove card from chat feed immediately on click).
   - [x] Step 3: Implement client-side word-by-word emulated streaming in `src/client/App.tsx` at ~100 words per second (~10ms/word).
   - [x] Step 4: Automated Playwright browser verification testing word-by-word streaming, composer gap, and confirmation dismissal.
   - [x] Step 5: Run unit/integration tests, ESLint, and production build.
   - [x] Step 6: Git commit with conventional prefixes and push `feature/assistant-v0-1` to origin.

All Phase 4 tasks completed, tested, and verified.

## Sprint 2 Tasks

11. [x] Sprint 2 - Phase 1: Context Rail Cleanup, Catalog Truncation & UI Polish:
   - [x] Step 1: Prune manual handoff, state documents, and git status textareas from Context Packet in `src/client/App.tsx`, retaining only the optional transcript input.
   - [x] Step 2: Style transcript textarea in `src/client/styles.css` to be vertically expandable up to `max-height: 240px` with internal vertical scrolling beyond that.
   - [x] Step 3: Fix Provider route radio layout in `src/client/styles.css` to eliminate excessive bullet width.
   - [x] Step 4: Implement project catalog truncation in `src/client/App.tsx` (show first 5 projects by default with "Show all ({total})" / "Show fewer" toggle, keeping registration and directory scan permanently visible).
   - [x] Step 5: Automated Playwright browser verification testing catalog truncation, transcript textarea sizing, and provider radio width.
   - [x] Step 6: Run unit/integration tests (`npm test`), ESLint (`npm run lint`), and build (`npm run build`).
   - [x] Step 7: Git commit on `dev` branch with conventional message.

All Sprint 2 Phase 1 tasks completed, tested, and verified.

12. [x] Sprint 2 - Phase 2: Conversation Threading, Server Persistence & Markdown Export:
   - [x] Milestone 1: Backend thread storage service (`src/server/threads/thread-storage.ts`) and REST endpoints (`/api/v1/threads`) with integration tests (`tests/integration/thread-storage.test.ts`).
   - [x] Milestone 2: Frontend thread management in `src/client/App.tsx` and `src/client/api.ts` (`+ New orchestration thread`, left rail switcher, persistent message sync).
   - [x] Milestone 3: Codex-formatted Markdown conversation export (`# AgentRunner Conversation - {timestamp}`, `## User`, `## Agent`) and download trigger.
   - [x] Milestone 4: Automated Playwright browser verification testing thread lifecycle, restart persistence, and markdown export with screenshot.
   - [x] Milestone 5: Full test suite (`npm test`), ESLint (`npm run lint`), build (`npm run build`), and milestone commits on `dev`.

All Sprint 2 Phase 2 tasks completed, tested, and verified.

13. [x] Sprint 2 - Phase 3: Interactive Codex Launch Dialog & PTY Parameterization:
   - [x] Milestone 1: Binary resolution service (`src/server/system/binary-resolver.ts`), parameterized codex command builder (`src/server/terminals/codex-command.ts`), and updated `POST /api/v1/terminals` route with unit/integration tests.
   - [x] Milestone 2: Interactive Codex Launch Configuration Modal in `src/client/App.tsx` (mode selector, model defaulting to `gpt-5.6-terra`, reasoning effort defaulting to `medium`).
   - [x] Milestone 3: Playwright browser verification script testing launch dialog, parameter transmission, and terminal canvas mounting with proof screenshot.
   - [x] Milestone 4: Full quality gate (`npm test`, `npm run lint`, `npm run build`), milestone commits, and push to `origin/dev`.

All Sprint 2 Phase 3 tasks completed, tested, and verified.

14. [x] Sprint 2 - Phase 4: Thread Lifecycle Controls & Dynamic Multi-Project Scoping:
   - [x] Milestone 1: Dynamic project re-scoping in `src/client/App.tsx` (evaluate project inference on every prompt; trigger resolution if a different project or path is detected rather than forcing previous scope).
   - [x] Milestone 2: Unused thread guard in `src/client/App.tsx` (clicking "+ New orchestration thread" re-routes to existing empty/unused thread if present; at most 1 unused thread).
   - [x] Milestone 3: Thread rename and delete actions in `src/client/App.tsx` and `src/client/styles.css` (hover pencil icon for renaming, delete button, sync with backend `updateThread` and `deleteThread`).
   - [x] Milestone 4: Automated Playwright browser verification testing multi-project switching within a thread, unused thread guard, and rename/delete.
   - [x] Milestone 5: Full quality gate (`npm test`, `npm run lint`, `npm run build`), milestone commits, and push to `origin/dev`.

All Sprint 2 Phase 4 tasks completed, tested, and verified.

