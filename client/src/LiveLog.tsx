import { useEffect, useState, useRef } from 'react';
import { Box, Card, Flex, Badge, Text, ScrollArea, Select } from '@radix-ui/themes';

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  detail?: Record<string, any>;
}

const levelColors: Record<string, 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'gray'> = {
  critical: 'red',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue'
};

const levelPriority: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4
};

export function LiveLog() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [minLevel, setMinLevel] = useState('info');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Determine the websocket URL based on the current window location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // When running in Vite dev server (port 5173), fallback to localhost:3000
    // When running in production (served by Express), use the current host
    const host = window.location.port === '5173' ? 'localhost:3000' : window.location.host;
    
    const ws = new WebSocket(`${protocol}//${host}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'log') {
          setLogs((prev) => [...prev, payload.data].slice(-500)); // Keep last 500
        }
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const filteredLogs = logs.filter(
    log => (levelPriority[log.level] ?? 0) >= (levelPriority[minLevel] ?? 0)
  );

  return (
    <Card size="2" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Flex justify="between" align="center" mb="3">
        <Text weight="bold">Live Log</Text>
        <Select.Root value={minLevel} onValueChange={setMinLevel}>
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="debug">Debug</Select.Item>
            <Select.Item value="info">Info</Select.Item>
            <Select.Item value="warn">Warn</Select.Item>
            <Select.Item value="error">Error</Select.Item>
          </Select.Content>
        </Select.Root>
      </Flex>
      <ScrollArea type="always" scrollbars="vertical" style={{ height: '300px' }}>
        <Box pr="4">
          {filteredLogs.length === 0 ? (
            <Text color="gray" size="2">No logs yet...</Text>
          ) : (
            filteredLogs.map((log, i) => (
              <Flex key={i} gap="2" mb="2" align="start" style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>
                <Text color="gray" style={{ minWidth: '80px' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Text>
                <Badge color={levelColors[log.level] || 'gray'} variant="soft">
                  {log.level.toUpperCase()}
                </Badge>
                <Text weight="bold" style={{ minWidth: '100px' }}>
                  [{log.source}]
                </Text>
                <Box>
                  <Text>{log.message}</Text>
                  {log.detail && (
                    <Text color="gray" size="1" style={{ display: 'block', marginTop: '2px' }}>
                      {JSON.stringify(log.detail)}
                    </Text>
                  )}
                </Box>
              </Flex>
            ))
          )}
          <div ref={bottomRef} />
        </Box>
      </ScrollArea>
    </Card>
  );
}
