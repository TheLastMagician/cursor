import { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor } from 'lucide-react';

type Status = 'connecting' | 'connected' | 'disconnected' | 'unavailable';

interface Props {
  taskId?: string;
}

export default function VncDesktop({ taskId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<InstanceType<typeof import('@novnc/novnc/lib/rfb.js').default> | null>(null);
  const [status, setStatus] = useState<Status>('connecting');

  const connect = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    if (rfbRef.current) {
      try { rfbRef.current.disconnect(); } catch {}
      rfbRef.current = null;
    }

    while (container.firstChild) container.removeChild(container.firstChild);
    setStatus('connecting');

    try {
      const { default: RFB } = await import('@novnc/novnc/lib/rfb.js');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const tid = taskId || 'default';
      const url = `${protocol}//${window.location.host}/ws/desktop?taskId=${tid}`;

      const rfb = new RFB(container, url, {
        scaleViewport: true,
        resizeSession: false,
      });

      rfb.background = '#f3f4f6';
      rfb.focusOnClick = true;

      rfb.addEventListener('connect', () => setStatus('connected'));
      rfb.addEventListener('disconnect', () => setStatus('disconnected'));

      rfbRef.current = rfb;
    } catch {
      setStatus('unavailable');
    }
  }, [taskId]);

  useEffect(() => {
    connect();
    return () => {
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch {}
        rfbRef.current = null;
      }
    };
  }, [connect, taskId]);

  return (
    <div className="relative h-full">
      {status !== 'connected' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50">
          {status === 'connecting' && (
            <div className="text-center">
              <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full mx-auto mb-3" />
              <p className="text-sm text-gray-500">Connecting to desktop...</p>
            </div>
          )}
          {(status === 'disconnected' || status === 'unavailable') && (
            <div className="text-center px-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 flex items-center justify-center">
                <Monitor size={24} className="text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">桌面未就绪</p>
              <p className="text-xs text-gray-400 mb-4 max-w-[220px]">
                虚拟机尚未启动，请先提交任务，系统会自动初始化虚拟桌面环境。
              </p>
              <button
                onClick={() => connect()}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
              >
                Retry connection
              </button>
            </div>
          )}
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
