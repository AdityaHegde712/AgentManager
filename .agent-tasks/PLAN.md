# AgentRunner v0.1 Plan

## Active phase
- Implementation of the user-requested revisions:
  1. OpenRouter free models filter (`:free`), inclusion of `openrouter/free` router option, and explicit health/model error propagation.
  2. Windows folder picker endpoint (`POST /api/v1/system/browse-folder`) and client integration.
  3. Conversational project inference: 2-step matching (regex/keyword against registered aliases -> clarification choice if multiple -> confirmation card).
  4. Project catalog inspector panel (view all registered aliases, click to view details and root path).
  5. UI scroll ergonomics: 3 independent scroll containers (left thread list, center chat feed, right request controls) + sticky composer.

## Exit criteria
- Tests pass (unit & integration).
- Typecheck and lint pass.
- Clean build of client and server.
- Visual inspection / responsive layouts intact.
