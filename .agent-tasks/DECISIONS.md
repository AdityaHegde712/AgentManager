# AgentRunner Decisions

1. Use a local TypeScript web app for the embedded terminal and dashboard.
2. Implement OpenRouter only; isolate all LLM behavior behind a provider contract.
3. Read `OPENROUTER_API_KEY` only from the process environment; never persist secrets.
4. Use an approved evidence ladder: deliverable, selected handoff, selected `.agent-tasks` documents, transcript fallback, Git state.
5. Allow two coding PTYs overall and one active PTY per repository root.
6. Launch `codex resume --all` for v0.1. Defer local Codex session indexing.
7. Treat the assistant as one persistent local orchestration thread, not one assistant instance per project. Project scope is explicit per continuation request.
8. Keep v0.1 chat-shaped only: OpenRouter may draft continuation briefs but must not provide general assistant replies or implicit project-context recall.
9. Keep the embedded terminal for v0.1 behind a `TerminalSurface` contract. vNext may offer a user-triggered, tokenized browser pop-out attached to the same PTY; it must not start a second assistant or CLI session.
10. Do not expose a project selector in the chat shell. Derive the active project context from the current orchestration thread; project registration, folder scanning under `~/Projects/`, and assisted project creation are deferred features.
11. Store the current v0.1 thread's explicit workspace attachment in the `project` URL query parameter. If absent, auto-attach only when exactly one project is registered; never guess among multiple projects.
12. Authenticate normal API requests from the launch-token header and browser WebSocket upgrades from the launch-token query value. Both paths use timing-safe launch-token verification.
13. Support local dotenv ingestion only at server startup. Load `.env` with `override: false` so a deliberately exported process variable remains authoritative; never persist or log provider keys.
14. Replace the two-port Vite/backend launch with one loopback Fastify origin that serves the built UI. The bootstrap capability is printed only in a URL fragment and moved to browser session storage immediately; it is never accepted as a normal HTTP query parameter.
15. Do not put the launch capability in terminal WebSocket URLs. An authenticated terminal-start response sets a SameSite=Strict, HttpOnly cookie scoped to `/api/v1/terminals`; the WebSocket route verifies only that cookie.
16. Add a native Windows folder picker endpoint (`POST /api/v1/system/browse-folder`) executed securely via a backend script (PowerShell .NET FolderBrowserDialog), preventing manual path typos.
17. In the conversation flow, implement two-step heuristic project inference: regex/keyword match against registered project aliases. If multiple match, prompt user with explicit clarification choices. If one matches, show a confirmation card before locking for handoff.
18. Support OpenRouter free routing and models: include `openrouter/free` as a default virtual free-router option, and filter all fetched models to only those ending with `:free` (or zero-cost pricing). Expose full error diagnostic strings if provider status or model fetching fails.
19. Enforce three independent scroll containers: left thread history, center chat feed, and right request controls rail, with composer pinned at bottom (`position: sticky; bottom: 0`). Add a registered projects inspector panel showing names and roots with click-to-view details.
