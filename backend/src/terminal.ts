import { WebSocket } from 'ws';
import { getTaskDisplay } from './desktop.js';

let ptyModule: typeof import('node-pty') | null = null;
try {
  ptyModule = await import('node-pty');
} catch {
  console.warn('[Terminal] node-pty not available, interactive terminal disabled');
}

const activePtys = new Map<string, ReturnType<NonNullable<typeof ptyModule>['spawn']>>();

export function handleTerminalConnection(ws: WebSocket, taskId: string, workspace: string) {
  if (!ptyModule) {
    ws.send(JSON.stringify({ type: 'terminal_error', data: 'node-pty not available' }));
    return;
  }

  const existing = activePtys.get(taskId);
  if (existing) {
    existing.kill();
    activePtys.delete(taskId);
  }

  const taskDisplay = getTaskDisplay(taskId);
  const pty = ptyModule.spawn('bash', [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: workspace,
    env: { ...process.env, TERM: 'xterm-256color', ...(taskDisplay ? { DISPLAY: taskDisplay } : {}) } as Record<string, string>,
  });

  activePtys.set(taskId, pty);

  pty.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal_data', data }));
    }
  });

  pty.onExit(() => {
    activePtys.delete(taskId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminal_exit' }));
    }
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'terminal_input') {
        pty.write(msg.data);
      } else if (msg.type === 'terminal_resize') {
        pty.resize(msg.cols || 120, msg.rows || 30);
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    pty.kill();
    activePtys.delete(taskId);
  });
}

export function killTerminal(taskId: string) {
  const pty = activePtys.get(taskId);
  if (pty) {
    pty.kill();
    activePtys.delete(taskId);
  }
}
