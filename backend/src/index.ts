import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import { mkdirSync, existsSync, readdirSync, statSync, createReadStream } from 'fs';
import { join, resolve, basename } from 'path';
import { store } from './store.js';
import { runAgent, getProviderInfo } from './agent.js';
import { toolDefinitions } from './tools.js';
import { handleTerminalConnection } from './terminal.js';
import { handleDesktopConnection, startTaskDesktop, hasDesktopSupport } from './desktop.js';
import { setWorkspaceEnv } from './tools.js';
import type { Task, AgentEvent, WsClientMessage } from './types.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const DEFAULT_WORKSPACE = process.env.AGENT_WORKSPACE || '/tmp/agent-workspace';
if (!existsSync(DEFAULT_WORKSPACE)) mkdirSync(DEFAULT_WORKSPACE, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

// REST endpoints
app.get('/api/tasks', (_req, res) => res.json(store.list()));
app.get('/api/tasks/:id', (req, res) => {
  const task = store.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});
app.delete('/api/tasks/:id', (req, res) => {
  const controller = activeAbortControllers.get(req.params.id);
  if (controller) controller.abort();
  store.delete(req.params.id);
  res.json({ ok: true });
});
app.get('/api/health', (_req, res) => {
  const info = getProviderInfo();
  res.json({ status: 'ok', provider: info.provider, model: info.model, workspace: DEFAULT_WORKSPACE });
});

app.get('/api/files', (req, res) => {
  const workspace = (req.query.workspace as string) || DEFAULT_WORKSPACE;
  const relPath = (req.query.path as string) || '/';
  const fullPath = resolve(workspace, relPath.replace(/^\//, ''));
  if (!fullPath.startsWith(resolve(workspace))) return res.status(403).json({ error: 'Path traversal' });
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'Not found' });
  try {
    const entries = readdirSync(fullPath).filter(n => !n.startsWith('.')).map(name => {
      const fp = join(fullPath, name);
      try {
        const s = statSync(fp);
        return { name, type: s.isDirectory() ? 'directory' as const : 'file' as const, size: s.size, modified: s.mtime.toISOString() };
      } catch { return { name, type: 'file' as const, size: 0, modified: '' }; }
    });
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    res.json({ path: relPath, entries });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.get('/api/files/download', (req, res) => {
  const workspace = (req.query.workspace as string) || DEFAULT_WORKSPACE;
  const relPath = (req.query.path as string) || '';
  const fullPath = resolve(workspace, relPath.replace(/^\//, ''));
  if (!fullPath.startsWith(resolve(workspace))) return res.status(403).json({ error: 'Path traversal' });
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'Not found' });
  try {
    const s = statSync(fullPath);
    if (s.isDirectory()) return res.status(400).json({ error: 'Cannot download directory' });
    res.setHeader('Content-Disposition', `attachment; filename="${basename(fullPath)}"`);
    res.setHeader('Content-Length', s.size);
    createReadStream(fullPath).pipe(res);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
const termWss = new WebSocketServer({ noServer: true });
const desktopWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  if (pathname === '/ws/terminal') {
    termWss.handleUpgrade(request, socket, head, (ws) => termWss.emit('connection', ws, request));
  } else if (pathname.startsWith('/ws/desktop')) {
    desktopWss.handleUpgrade(request, socket, head, (ws) => desktopWss.emit('connection', ws, request));
  } else if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

const activeAbortControllers = new Map<string, AbortController>();

wss.on('connection', (ws: WebSocket) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ type: 'task_list', data: { tasks: store.list() } }));

  ws.on('message', async (raw: Buffer) => {
    let msg: WsClientMessage;
    try { msg = JSON.parse(raw.toString()); }
    catch { ws.send(JSON.stringify({ type: 'task_error', data: { error: 'Invalid JSON' } })); return; }

    const send = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };

    // ─── Create Task ──────────────────────────
    if (msg.type === 'create_task') {
      const taskId = uuid();
      const workspace = msg.data.workspace || DEFAULT_WORKSPACE;
      if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });

      const task: Task = {
        id: taskId, prompt: msg.data.prompt, workspace,
        status: 'running', createdAt: new Date().toISOString(), events: [],
      };
      store.create(task);
      send({ type: 'task_created', data: { taskId, status: 'running', prompt: msg.data.prompt } });
      broadcast(wss, ws, { type: 'task_list', data: { tasks: store.list() } });

      await executeAgent(taskId, msg.data.prompt, workspace, ws, wss);
    }

    // ─── Follow Up ────────────────────────────
    if (msg.type === 'follow_up' && msg.data.taskId) {
      const taskId = msg.data.taskId;
      const task = store.get(taskId);
      if (!task) { send({ type: 'task_error', data: { taskId, error: 'Task not found' } }); return; }

      task.status = 'running';
      const emit = (event: AgentEvent) => { store.addEvent(taskId, event); send({ type: 'agent_event', data: { taskId, event } }); };
      emit({ type: 'user_message', content: msg.data.prompt, timestamp: new Date().toISOString() });

      await executeAgent(taskId, msg.data.prompt, task.workspace, ws, wss, store.getConversation(taskId));
    }

    // ─── Cancel Task ──────────────────────────
    if (msg.type === 'cancel_task' && msg.data.taskId) {
      const controller = activeAbortControllers.get(msg.data.taskId as string);
      if (controller) {
        controller.abort();
        store.updateStatus(msg.data.taskId as string, 'cancelled');
        send({ type: 'task_completed', data: { taskId: msg.data.taskId } });
      }
    }
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
});

async function executeAgent(
  taskId: string,
  prompt: string,
  workspace: string,
  ws: WebSocket,
  wssInstance: WebSocketServer,
  existingMessages?: ReturnType<typeof store.getConversation>,
) {
  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const controller = new AbortController();
  activeAbortControllers.set(taskId, controller);

  const emit = (event: AgentEvent) => {
    store.addEvent(taskId, event);
    send({ type: 'agent_event', data: { taskId, event } });
  };

  try {
    // VM initialization
    if (!existingMessages && hasDesktopSupport()) {
      emit({ type: 'message', content: '🖥️ Initializing virtual machine...', timestamp: new Date().toISOString() });
      const desktop = await startTaskDesktop(taskId, workspace);
      if (desktop) {
        setWorkspaceEnv(workspace, 'DISPLAY', desktop.display);
        emit({ type: 'message', content: `✅ Virtual machine ready — desktop \`${desktop.display}\` on port \`${desktop.vncPort}\``, timestamp: new Date().toISOString() });
      }
    }

    const messages = await runAgent(prompt, workspace, emit, controller.signal, existingMessages);
    if (messages.length > 0) store.setConversation(taskId, messages);
    store.updateStatus(taskId, 'completed');
    const t = store.get(taskId);
    emit({ type: 'status', status: 'completed', timestamp: new Date().toISOString() });
    send({ type: 'task_completed', data: { taskId, workedDuration: t?.workedDuration } });
  } catch (err) {
    store.updateStatus(taskId, 'failed');
    const errorMsg = err instanceof Error ? err.message : String(err);
    emit({ type: 'error', content: errorMsg, timestamp: new Date().toISOString() });
    send({ type: 'task_error', data: { taskId, error: errorMsg } });
  } finally {
    activeAbortControllers.delete(taskId);
    broadcast(wssInstance, ws, { type: 'task_list', data: { tasks: store.list() } });
  }
}

desktopWss.on('connection', (ws: WebSocket, req: import('http').IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const taskId = url.searchParams.get('taskId') || 'default';
  console.log(`[Desktop] VNC client connected for task ${taskId.slice(0, 8)}`);
  handleDesktopConnection(ws, taskId);
});

termWss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const taskId = url.searchParams.get('taskId') || 'default';
  const task = store.get(taskId);
  const workspace = task?.workspace || DEFAULT_WORKSPACE;
  console.log(`[Terminal] Connected for task ${taskId}`);
  handleTerminalConnection(ws, taskId, workspace);
});

function broadcast(wssInstance: WebSocketServer, exclude: WebSocket, payload: Record<string, unknown>) {
  const msg = JSON.stringify(payload);
  wssInstance.clients.forEach((c) => { if (c !== exclude && c.readyState === WebSocket.OPEN) c.send(msg); });
}

server.listen(PORT, '0.0.0.0', () => {
  const info = getProviderInfo();
  const mode = info.provider === 'mock' ? '🟡 Mock' : `🟢 ${info.provider} (${info.model})`;
  const desktop = hasDesktopSupport() ? '🟢 available (per-task)' : '🔴 not installed';
  console.log(`\n  Agent Cloud Backend — ${mode}\n  http://localhost:${PORT}\n  Tools: ${toolDefinitions.map(t => t.name).join(', ')}\n  Desktop: ${desktop}\n`);
});
