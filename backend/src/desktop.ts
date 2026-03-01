import { WebSocket } from 'ws';
import { createConnection } from 'net';
import { execSync, spawn } from 'child_process';

interface TaskDesktop {
  display: string;
  vncPort: number;
}

const taskDesktops = new Map<string, TaskDesktop>();
let nextDisplayNum = 100;

export async function startTaskDesktop(taskId: string): Promise<TaskDesktop | null> {
  if (taskDesktops.has(taskId)) return taskDesktops.get(taskId)!;

  if (!commandExists('Xvfb') || !commandExists('x11vnc')) {
    return null;
  }

  const displayNum = nextDisplayNum++;
  const display = `:${displayNum}`;
  const vncPort = 5900 + displayNum;

  try {
    const env = { ...process.env, DISPLAY: display };

    // 1. Xvfb virtual framebuffer
    spawn('Xvfb', [display, '-screen', '0', '1280x720x24', '-ac', '-nolisten', 'tcp'], {
      stdio: 'ignore', detached: true,
    }).unref();
    await sleep(600);

    // 2. dbus session (required by xfce)
    let dbusEnv = env;
    if (commandExists('dbus-launch')) {
      try {
        const dbusOut = execSync('dbus-launch --sh-syntax', { env, timeout: 3000 }).toString();
        for (const line of dbusOut.split('\n')) {
          const m = line.match(/^(\w+)='?([^';\s]+)/);
          if (m) dbusEnv = { ...dbusEnv, [m[1]]: m[2] };
        }
      } catch { /* continue without dbus */ }
    }

    // 3. XFCE4 desktop environment
    if (commandExists('xfce4-session')) {
      spawn('xfce4-session', [], { stdio: 'ignore', detached: true, env: dbusEnv }).unref();
    } else if (commandExists('xfwm4')) {
      spawn('xfwm4', [], { stdio: 'ignore', detached: true, env: dbusEnv }).unref();
      if (commandExists('xfdesktop')) spawn('xfdesktop', [], { stdio: 'ignore', detached: true, env: dbusEnv }).unref();
      if (commandExists('xfce4-panel')) spawn('xfce4-panel', [], { stdio: 'ignore', detached: true, env: dbusEnv }).unref();
    } else if (commandExists('fluxbox')) {
      spawn('fluxbox', [], { stdio: 'ignore', detached: true, env: dbusEnv }).unref();
    }
    await sleep(1500);

    // 4. VNC server
    spawn('x11vnc', [
      '-display', display, '-nopw', '-forever', '-shared',
      '-rfbport', String(vncPort), '-noxdamage', '-cursor', 'arrow',
    ], { stdio: 'ignore', detached: true, env: dbusEnv }).unref();
    await sleep(600);

    const desktop = { display, vncPort };
    taskDesktops.set(taskId, desktop);
    console.log(`  [Desktop] Task ${taskId.slice(0, 8)} → display ${display}, VNC port ${vncPort} (xfce4)`);
    return desktop;
  } catch (err) {
    console.log('  [Desktop] Failed:', (err as Error).message);
    return null;
  }
}

export function getTaskDisplay(taskId: string): string | undefined {
  return taskDesktops.get(taskId)?.display;
}

export function getTaskVncPort(taskId: string): number | undefined {
  return taskDesktops.get(taskId)?.vncPort;
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
