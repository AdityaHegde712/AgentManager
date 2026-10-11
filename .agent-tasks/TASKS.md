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
