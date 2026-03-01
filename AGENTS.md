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
- `pnpm.onlyBuiltDependencies` in root `package.json` allowlists esbuild for non-interactive install
