# AgentRunner

AgentRunner is a localhost coding-agent hub that serves as a single-point-of-reference assistant for orchestrating local coding workflows. It indexes local repositories, auto-discovers evidence (`HANDOFF.md`, `.agent-tasks/`, `git status`), uses OpenRouter models to prepare reviewable continuation briefs, and hands off execution to Codex CLI via an embedded terminal surface.

---

## Architecture & Features

- **Project Catalog & Scanner**: Register local workspaces individually with native Windows File Explorer pickers, or bulk-scan directories (e.g. `~/Projects/`) with automatic canonical path deduplication and persistence (`.agent-tasks/projects.json`).
- **Evidence Auto-Discovery**: Automatically inspects project roots for `HANDOFF.md`, `.agent-tasks/PLAN.md`, `.agent-tasks/DECISIONS.md`, `.agent-tasks/TASKS.md`, and live `git status --short` to build high-signal context packets without manual copy-paste.
- **Continuation Brief Generator**: Prepares structured, reviewable handoff briefs using OpenRouter models, featuring default zero-cost routing (`openrouter/free`), ephemeral progress indicators, and client-side word-by-word streaming animation (~100 wps).
- **Embedded Work Surface (ConPTY)**: Supervised Windows ConPTY pseudo-terminal backend allowing immediate takeover with Codex CLI (`codex resume` / `codex`) right inside the chat shell.
- **Headless CLI Diagnostic Suite**: Built-in CLI tool (`npm run cli -- <command>`) for headless status checks, catalog inspection, and brief generation.

---

## Getting Started

### Prerequisites
- Node.js 20+ (Node 22+ recommended)
- Windows OS (PowerShell for native folder pickers and ConPTY terminal sessions)
- OpenRouter API key

### Installation
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Add your OpenRouter key to `.env`:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-...
   ```

3. Launch AgentRunner:
   ```bash
   # Development mode (Vite HMR + Fastify server):
   npm run dev

   # Production build and launch:
   npm run build
   npm start
   ```
   Or run using the root launch script:
   ```bash
   bash start.sh
   ```

---

## Headless CLI Usage

AgentRunner provides a CLI for inspecting and verifying the control plane without opening a browser:

```bash
# Check control plane and provider health
npm run cli -- health

# List registered projects in the catalog
npm run cli -- projects

# Register a new project
npm run cli -- add-project <alias> <path>

# Generate a continuation brief headlessly
npm run cli -- brief --project capstone --deliverable "Implement feature X"
```

---

## Verification & Testing

AgentRunner maintains strict TDD behavioral contracts and end-to-end browser verification:

```bash
# Run unit and integration tests (Vitest)
npm test

# Run ESLint check
npm run lint

# Run production TypeScript type-check and bundle build
npm run build
```

---

## License
MIT
