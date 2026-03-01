# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview
Agent Cloud — a web-based autonomous coding agent platform (like Cursor Agent Cloud). Monorepo with `frontend/` (React + Vite + Tailwind) and `backend/` (Express + WebSocket + Agent runtime).

### Running the dev servers
```bash
pnpm dev          # starts both backend (port 3001) and frontend (port 5173) concurrently
```
Or individually:
```bash
pnpm --filter backend dev    # backend only, port 3001
pnpm --filter frontend dev   # frontend only, port 5173, proxies /api and /ws to backend
```

### Key notes
- Without any LLM API key, the agent runs in **mock mode** (simulated tool calls for demo)
- With `MINIMAX_API_KEY` set, uses MiniMax M2.5 via OpenAI-compatible API (base URL: `api.minimaxi.com`)
- With `ANTHROPIC_API_KEY` set, uses Claude API for real autonomous agent execution
- Priority: MINIMAX_API_KEY > ANTHROPIC_API_KEY > mock mode
- Lint/typecheck: `pnpm run lint` (runs `tsc --noEmit` in both packages)
- The Vite proxy forwards `/api` and `/ws` from port 5173 → 3001; WebSocket target must use `http://` not `ws://` in Vite config
- Agent workspace defaults to `/tmp/agent-workspace` (configurable via `AGENT_WORKSPACE` env var)
- `pnpm.onlyBuiltDependencies` in root `package.json` allowlists esbuild and node-pty for non-interactive install

### Reference: Real Cursor Agent Cloud UI (cursor.com/cn/agents)
This project clones the Cursor Agent Cloud product. Key UI behaviors to match:

**Three-panel layout:**
- **Left sidebar** (~200px): Logo, "New Agent" button, "Dashboard" link, agent task list with status/diff counts
- **Center content** (flexible): Agent conversation stream — thinking blocks, tool call cards, walkthrough artifacts (videos + screenshots), summary, follow-up input at bottom
- **Right panel** (flexible): Tabbed view with **Setup**, **Secrets**, **Git**, **Desktop**, **Terminal** tabs

**Draggable divider:** A vertical splitter between center and right panels. Dragging left/right resizes both panels in real time. When the right panel narrows, tab labels collapse to icons only.

**Desktop tab:** Shows a **live remote desktop / VNC view** (rendered screenshots of the agent's visual environment — browser windows, UIs, etc.), NOT shell command output. The Terminal tab is the one for shell/CLI.

**Terminal tab:** Interactive xterm.js shell connected to the agent workspace via WebSocket PTY.

**Queue-based messaging:** Users can type and send follow-up messages while the agent is still working. Messages queue and are processed in order — no need to wait for the current step to complete. Input field reads "Add follow up for setup agent".

**Task list sidebar:** Each entry shows task name, status badge (Active/Done/Merged), and diff stats (+lines/-lines). Clicking loads the task detail in center panel.
