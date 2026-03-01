import { WebSocket } from 'ws';
import { createConnection } from 'net';
import { execSync, spawn } from 'child_process';

interface TaskDesktop {
  display: string;
  vncPort: number;
}

const taskDesktops = new Map<string, TaskDesktop>();
let nextDisplayNum = 100;

export async function startTaskDesktop(taskId: string, workspace: string): Promise<TaskDesktop | null> {
  if (taskDesktops.has(taskId)) return taskDesktops.get(taskId)!;

  if (!commandExists('Xvfb') || !commandExists('x11vnc')) {
    return null;
  }

  const displayNum = nextDisplayNum++;
  const display = `:${displayNum}`;
  const vncPort = 5900 + displayNum;

  try {
    const env: Record<string, string> = { ...process.env as Record<string, string>, DISPLAY: display };

    // 1. Xvfb
    spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-ac', '-nolisten', 'tcp'], {
      stdio: 'ignore', detached: true,
    }).unref();
    await sleep(600);

    // 2. dbus session
    if (commandExists('dbus-launch')) {
      try {
        const out = execSync('dbus-launch --sh-syntax', { env, timeout: 3000 }).toString();
        for (const line of out.split('\n')) {
          const m = line.match(/^(\w+)='?([^';\s]+)/);
          if (m) env[m[1]] = m[2];
        }
      } catch { /* continue */ }
    }

    // 3. Window manager (xfwm4 only, no full xfce4-session to keep it fast)
    if (commandExists('xfwm4')) {
      spawn('xfwm4', [], { stdio: 'ignore', detached: true, env }).unref();
    } else if (commandExists('fluxbox')) {
      spawn('fluxbox', [], { stdio: 'ignore', detached: true, env }).unref();
    }
    await sleep(400);

    // 4. Panel
    if (commandExists('xfce4-panel')) {
      spawn('xfce4-panel', [], { stdio: 'ignore', detached: true, env }).unref();
    }

    // 5. Set solid dark background (distinguish from system desktop)
    if (commandExists('xsetroot')) {
      try { execSync(`xsetroot -solid "#1e293b"`, { env, timeout: 2000 }); } catch {}
    }
    await sleep(300);

    // 6. VNC
    spawn('x11vnc', [
      '-display', display, '-nopw', '-forever', '-shared',
      '-rfbport', String(vncPort), '-noxdamage', '-cursor', 'arrow',
    ], { stdio: 'ignore', detached: true, env }).unref();
    await sleep(600);

    // 7. Open file manager + terminal showing agent workspace
    if (commandExists('thunar')) {
      spawn('thunar', [workspace], { stdio: 'ignore', detached: true, env }).unref();
    }
    if (commandExists('xfce4-terminal')) {
      spawn('xfce4-terminal', ['--working-directory', workspace, '--title', `Agent Workspace`], {
        stdio: 'ignore', detached: true, env,
      }).unref();
    }

    const desktop = { display, vncPort };
    taskDesktops.set(taskId, desktop);
    console.log(`  [Desktop] Task ${taskId.slice(0, 8)} → display ${display}, VNC port ${vncPort}`);
    return desktop;
  } catch (err) {
    console.log('  [Desktop] Failed:', (err as Error).message);
    return null;
  }
}

export function getTaskDisplay(taskId: string): string | undefined {
  return taskDesktops.get(taskId)?.display;
}

export function handleDesktopConnection(ws: WebSocket, taskId: string): void {
  const desktop = taskDesktops.get(taskId);
  if (!desktop) {
    ws.close(1008, 'No desktop for this task');
    return;
  }

  const tcp = createConnection({ host: 'localhost', port: desktop.vncPort });

  tcp.on('connect', () => {
    tcp.on('data', (chunk: Buffer) => {
      try { if (ws.readyState === WebSocket.OPEN) ws.send(chunk); }
      catch { /* ignore */ }
    });
  });

  ws.on('message', (data: Buffer) => {
    try { tcp.write(data); }
    catch { /* ignore */ }
  });

  tcp.on('end', () => { try { ws.close(); } catch {} });
  tcp.on('error', () => { try { ws.close(); } catch {} });
  ws.on('close', () => tcp.destroy());
  ws.on('error', () => tcp.destroy());
}

export function hasDesktopSupport(): boolean {
  return commandExists('Xvfb') && commandExists('x11vnc');
}

function commandExists(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
