import { useEffect, useRef, useCallback } from 'react';
import type { WsMessage } from '../api/types';

type MessageHandler = (msg: WsMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(onMessage);
  handlersRef.current = onMessage;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket('ws://localhost:8100/ws');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] connected');
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as WsMessage;
        handlersRef.current(msg);
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      console.log('[WS] disconnected, reconnecting in 5s');
      setTimeout(connect, 5000);
    };

    ws.onerror = (err) => {
      console.warn('[WS] error', err);
      ws.close();
    };

    // Ping every 30s
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    ws.addEventListener('close', () => clearInterval(ping));
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
