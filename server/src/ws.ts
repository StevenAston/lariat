import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { addLogListener } from './logger';
import { getDb } from './db';

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });

  // Keep track of connected clients
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);

    // Initial connection ping
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // Listen to logger events and broadcast them to all connected clients
  addLogListener((level, source, message, detail) => {
    // Also save to db if not debug, but we can do that directly here since the task says "the events table".
    // Wait, let's just broadcast for now.
    const payload = JSON.stringify({
      type: 'log',
      data: {
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        detail
      }
    });

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  return wss;
}
