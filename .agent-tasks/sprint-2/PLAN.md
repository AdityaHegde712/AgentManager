# Sprint 2 Plan: Terminal Supervision, Thread Persistence, and Workspace Polish (Revised)

## 1. Architectural Diagnostics & Evaluated Revisions

### 1.1 Terminal Surface & Native Codex Picker (Rating: 5 / 5 - Principal)
- **Architectural Shift**:
  - Instead of brittle reverse-engineering of `~/.codex/sessions` (which contains nested date hierarchies and non-trivial project associations), **delegate session picking directly to Codex CLI's native TUI picker**.
  - Codex CLI natively features an interactive terminal picker when invoked with `codex resume` (or `codex resume --all`).
  - It natively handles search, keyboard selection, timestamps, and workspace detection inside the ConPTY/xterm.js work surface.
  - If the user presses `Esc` to cancel the picker, Codex exits or falls back cleanly, enabling a seamless transition to a new session.
- **Launch Configuration Modal**:
  - Render an interactive launch options dialog upon clicking **"Launch Codex Picker"**:
    1. **Session Mode**:
       - `Resume Existing Session`: Spawns `codex resume --all --no-alt-screen [-m <model>] [-c model_reasoning_effort="<level>"]`.
       - `Start New Session`: Spawns `codex --no-alt-screen [-m <model>] [-c model_reasoning_effort="<level>"]`.
    2. **Model Selection**:
       - Default: `gpt-5.6-terra`. Configurable via input / dropdown.
    3. **Reasoning Effort**:
       - Default: `medium` (Options: `low`, `medium`, `high`).
- **Binary Resolution**:
  - Resolve `codex.exe` explicitly via `where.exe codex`, `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`, `%APPDATA%\npm\codex.cmd`, or `process.env.CODEX_COMMAND`.

### 1.2 Conversation Threading & Multi-Thread Lifecycle (Rating: 5 / 5 - Principal)
- **Problem**: The "+ New orchestration thread" button on the left sidebar is currently an inert static placeholder.
- **Implementation**:
  - Support multiple persistent orchestration threads.
  - Wire "+ New orchestration thread" to generate a new thread (`thread-${uuid}`), reset active chat while preserving historical threads, and update the left rail.
  - Allow switching between threads in the left sidebar with instantaneous context restoration.

### 1.3 Persistent Conversation Transcripts (Rating: 5 / 5 - Principal)
- **Problem**: Message history is currently stored in ephemeral component memory (`useState<ChatMessage[]>`). Server restarts or browser refreshes erase past chat messages.
- **Implementation**:
  - Backend storage service (`src/server/threads/thread-storage.ts`) writing `.agent-tasks/conversations/{threadId}.json`.
  - Automatic persistence after every user deliverable submission and assistant brief draft.
  - Automatic rehydration upon server restart or thread navigation.

### 1.4 Codex-Style Markdown Conversation Export (Rating: 5 / 5 - Principal)
- **Format**:
  ```markdown
  # AgentRunner Conversation - {ISO_TIMESTAMP}

  ## Metadata
  - **Thread**: {threadId}
  - **Project**: {projectAlias} ({projectRoot})
  - **Exported**: {timestamp}

  ## User
  {User prompt / deliverable text}

  ## Agent
  {Continuation brief or assistant response}
  ```
- Triggered via dedicated "Export conversation (.md)" button in chat header.

### 1.5 Frontend Catalog & Rail Polish
- **Project Catalog Truncation**: Display first 4–5 projects by default with a toggle ("Show all N projects" / "Show fewer"). "Register a project" and "Scan Directory" remain permanently visible.
- **Provider Route Radio Styling**: Reduce bullet radio container width in `.provider-route` to eliminate wasted horizontal space.
- **Context Packet Pruning**: Remove redundant manual input fields (`handoff.md`, `.agent-tasks`, `git status`) since auto-discovery is operational. Retain optional transcript field, styled to expand up to `max-height: 240px` and scroll internally beyond that.

---

## 2. Feature Review & Ratings Matrix

| Proposed Feature | Rating (1–5) | Evaluation & Rationale |
| :--- | :---: | :--- |
| **Native Codex TUI Delegation (`codex resume`)** | **5 / 5** | Principal. Replaces fragile custom session file parsing with Codex CLI's battle-tested interactive picker. |
| **Model & Reasoning Parameterization** | **4.5 / 5** | Senior. Passes explicit CLI configuration flags (`-m`, `-c model_reasoning_effort=...`) safely to Codex spawn. |
| **Multi-Thread Lifecycle & UI Switcher** | **5 / 5** | Principal. Essential for isolating separate project tasks. |
| **Server-Side Thread Persistence** | **5 / 5** | Principal. Survives server restarts and enforces stateless handoff guarantees. |
| **Codex-Style Markdown Conversation Export** | **5 / 5** | Principal. Clean, standard documentation export matching user specification. |
| **Catalog Minimization / Truncation** | **4.5 / 5** | Senior. Prevents sidebar clutter as project count scales. |
| **Provider Radio & Context Rail Cleanup** | **5 / 5** | Senior. Tightens layout ergonomics and removes dead UI pathways. |

---

## 3. Sprint 2 Phased Execution Roadmap

### Phase 1: Context Rail Cleanup, Catalog Truncation & UI Polish (~1.5 hours)
1. Prune manual `handoff.md`, `.agent-tasks`, and `git status` textareas from Context Packet rail in `src/client/App.tsx`.
2. Style manual transcript input to expand up to `max-height: 240px` and scroll internally beyond that.
3. Fix Provider Route radio bullet styling in `src/client/styles.css` to remove excess horizontal width.
4. Add project list truncation (show 4–5 projects by default with expand/collapse toggle; keep registration and scan actions always visible).

### Phase 2: Conversation Threading, Persistence & Markdown Export (~2.5 hours)
1. Implement backend storage service (`src/server/threads/thread-storage.ts`) persisting threads and message logs to `.agent-tasks/conversations/{threadId}.json`.
2. Add thread REST endpoints:
   - `GET /api/v1/threads`: List saved threads.
   - `POST /api/v1/threads`: Create new thread.
   - `GET /api/v1/threads/:id`: Load thread state and messages.
   - `POST /api/v1/threads/:id/messages`: Append message.
3. Wire "+ New orchestration thread" button and thread switcher in the left rail.
4. Implement Codex-formatted Markdown Export button in chat header.

### Phase 3: Interactive Codex Launch Dialog & PTY Parameterization (~2.5 hours)
1. Add binary resolver in `src/server/system/binary-resolver.ts` to locate `codex.exe`.
2. Update `src/server/terminals/codex-command.ts` to support dynamic mode (`resume` vs `new`), model (`-m`), and reasoning effort (`-c model_reasoning_effort="<level>"`).
3. Build interactive Codex Launch Dialog modal in `src/client/App.tsx`.
4. Connect launch button to trigger PTY spawn with user-selected parameters.
5. End-to-end Playwright browser verification testing full launch, thread creation, persistence, and export flows.

### Phase 4: Thread Lifecycle Controls & Dynamic Multi-Project Scoping (~2 hours)
1. **Unused Thread Guard & Unique IDs**:
   - Guard against duplicate empty threads: when clicking `+ New orchestration thread`, if an unused thread (0 user messages) already exists, switch to it rather than spawning another.
   - Guarantee at most 1 unused orchestration thread at any time.
2. **Thread Renaming & Deletion**:
   - Provide clickable pencil icon on thread buttons in left sidebar visible on hover to rename thread.
   - Provide delete button on thread buttons to remove thread via `DELETE /api/v1/threads/:id`.
3. **Dynamic Multi-Project Scoping within Threads**:
   - Decouple thread from single-project lock.
   - Run project inference (`inferProject`, `detectUnregisteredPathOrCandidate`) on every message.
   - If user explicitly refers to a different registered project or path, trigger project confirmation/resolution for the new project rather than forcing the previously active project.
   - Update thread scope and draft brief for the newly resolved project upon confirmation.
4. **Playwright Browser Verification & Tests**:
   - Verify project switching within a single active thread.
   - Verify unused thread guard (clicking new thread repeatedly retains only 1 empty thread).
   - Verify thread renaming and deletion.
