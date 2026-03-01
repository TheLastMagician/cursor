import { WebSocket } from 'ws';
import { createConnection } from 'net';
import { execSync, spawn } from 'child_process';

const VNC_HOST = process.env.VNC_HOST || 'localhost';
const VNC_PORT = parseInt(process.env.VNC_PORT || '5900', 10);
const DISPLAY = process.env.DISPLAY || ':99';
const RESOLUTION = process.env.DESKTOP_RESOLUTION || '1280x720x24';

let desktopStarted = false;

export async function startDesktop(): Promise<boolean> {
  if (desktopStarted) return true;

  if (!commandExists('Xvfb') || !commandExists('x11vnc')) {
    console.log('  Desktop: Xvfb/x11vnc not found — install with: apt-get install -y xvfb x11vnc fluxbox');
    return false;
  }

  try {
    if (!displayActive(DISPLAY)) {
      const xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', RESOLUTION, '-ac', '-nolisten', 'tcp'], {
        stdio: 'ignore', detached: true,
      });
      xvfb.unref();
      await sleep(800);
    }

    if (commandExists('fluxbox')) {
      const wm = spawn('fluxbox', [], {
        stdio: 'ignore', detached: true,
        env: { ...process.env, DISPLAY },
      });
      wm.unref();
    }

    if (!(await portOpen(VNC_PORT))) {
      const vnc = spawn('x11vnc', [
        '-display', DISPLAY, '-nopw', '-forever', '-shared',
        '-rfbport', String(VNC_PORT), '-noxdamage', '-cursor', 'arrow',
      ], {
        stdio: 'ignore', detached: true,
        env: { ...process.env, DISPLAY },
      });
      vnc.unref();
      await sleep(800);
    }

    desktopStarted = true;
    console.log(`  Desktop: Virtual desktop on ${DISPLAY}, VNC port ${VNC_PORT}`);
    return true;
  } catch (err) {
    console.log('  Desktop: Failed —', (err as Error).message);
    return false;
  }
}

export function handleDesktopConnection(ws: WebSocket): void {
  const tcp = createConnection({ host: VNC_HOST, port: VNC_PORT });

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

export function isDesktopAvailable(): Promise<boolean> {
  return portOpen(VNC_PORT);
}

function commandExists(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function displayActive(display: string): boolean {
  try { execSync(`xdpyinfo -display ${display}`, { stdio: 'ignore', timeout: 2000 }); return true; }
  catch { return false; }
}

function portOpen(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise(resolve => {
    const s = createConnection({ host, port });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
