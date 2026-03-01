import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { mkdirSync, existsSync } from 'fs';
import { store } from './store.js';
import { runAgent, getProviderInfo } from './agent.js';
import type { Task, AgentEvent, WsClientMessage } from './types.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEFAULT_WORKSPACE = process.env.AGENT_WORKSPACE || '/tmp/agent-workspace';

if (!existsSync(DEFAULT_WORKSPACE)) {
  mkdirSync(DEFAULT_WORKSPACE, { recursive: true });
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/tasks', (_req, res) => {
  res.json(store.list());
});

app.get('/api/tasks/:id', (req, res) => {
  const task = store.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.get('/api/health', (_req, res) => {
  const info = getProviderInfo();
  res.json({
    status: 'ok',
    provider: info.provider,
    model: info.model,
    workspace: DEFAULT_WORKSPACE,
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const activeAbortControllers = new Map<string, AbortController>();

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected');

  ws.send(JSON.stringify({
    type: 'task_list',
    data: { tasks: store.list() },
  }));

  ws.on('message', async (raw: Buffer) => {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'task_error', data: { error: 'Invalid message format' } }));
      return;
    }

    if (msg.type === 'create_task') {
      const taskId = uuid();
      const workspace = msg.data.workspace || DEFAULT_WORKSPACE;

      if (!existsSync(workspace)) {
        mkdirSync(workspace, { recursive: true });
      }

      const task: Task = {
        id: taskId,
        prompt: msg.data.prompt,
        workspace,
        status: 'running',
        createdAt: new Date().toISOString(),
        events: [],
      };

      store.create(task);

      const send = (payload: Record<string, unknown>) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      };

      send({ type: 'task_created', data: { taskId, status: 'running' } });

      broadcast(wss, ws, { type: 'task_list', data: { tasks: store.list() } });

      const controller = new AbortController();
      activeAbortControllers.set(taskId, controller);

      const emit = (event: AgentEvent) => {
        store.addEvent(taskId, event);
        send({ type: 'agent_event', data: { taskId, event } });
      };

      try {
        await runAgent(msg.data.prompt, workspace, emit, controller.signal);
        store.updateStatus(taskId, 'completed');
        emit({ type: 'status', status: 'completed', timestamp: new Date().toISOString() });
        send({ type: 'task_completed', data: { taskId } });
      } catch (err) {
        store.updateStatus(taskId, 'failed');
        const errorMsg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', content: errorMsg, timestamp: new Date().toISOString() });
        send({ type: 'task_error', data: { taskId, error: errorMsg } });
      } finally {
        activeAbortControllers.delete(taskId);
        broadcast(wss, ws, { type: 'task_list', data: { tasks: store.list() } });
      }
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

function broadcast(wssInstance: WebSocketServer, exclude: WebSocket, payload: Record<string, unknown>) {
  const msg = JSON.stringify(payload);
  wssInstance.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  const info = getProviderInfo();
  const mode = info.provider === 'mock'
    ? '🟡 Mock (Demo mode)'
    : `🟢 ${info.provider} (${info.model})`;
  console.log(`
╔══════════════════════════════════════════════╗
║         Agent Cloud Backend Server           ║
╠══════════════════════════════════════════════╣
║  HTTP API:  http://localhost:${PORT}            ║
║  WebSocket: ws://localhost:${PORT}/ws           ║
║  Mode:      ${mode.padEnd(32)}║
║  Workspace: ${DEFAULT_WORKSPACE.padEnd(32)}║
╚══════════════════════════════════════════════╝
  `);
});
