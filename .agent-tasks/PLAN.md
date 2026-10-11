# AgentRunner v0.1 Plan

## Completed phases
- Phase 1: Core chat-first orchestration shell, ConPTY terminal supervisor, and OpenRouter free model routing.
- Phase 2: Evidence auto-discovery, ephemeral progress states, project persistence, directory scan, modern folder picker, and uncompressed chat brief display.
- Phase 3: Project path deduplication and red notification banner (#ff0f0f).

## Active phase
- Phase 4: UI Polish, Emulated Streaming, and Non-persistent Confirmation Cards:
  1. Frontend Emulated Streaming:
     - Receive brief text single-pass from backend as is.
     - Emulate streaming output in the frontend by typing word-by-word at ~100 words per second (~10ms/word).
     - Provide immediate completion on approval or click.
  2. Spacing Polish:
     - Add clean margin/gap between composer text box and "Draft continuation brief" / action buttons.
  3. Non-Persistent Project Confirmation:
     - Ensure project confirmation card disappears immediately from chat history once clicked (matching ephemeral progress behavior).
  4. Playwright Browser Verification & Git Milestone:
     - Verify streaming animation, spacing, and card dismissal in automated Playwright test.
     - Stage commits with conventional prefixes and push `feature/assistant-v0-1` to origin.

## Exit criteria
- Unit & integration tests pass (100% green).
- ESLint and TypeScript build pass clean.
- Automated Playwright browser verification confirms word-by-word streaming, composer gap, and confirmation card dismissal.
- Working tree committed and pushed to origin on `feature/assistant-v0-1`.
