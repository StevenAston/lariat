import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import winston from 'winston';
import { log, addLogListener, winstonLogger } from './logger';

describe('Logger', () => {
  const logDir = path.resolve(__dirname, '../../logs');
  const testLogFile = path.join(logDir, 'test-sync.log');

  beforeEach(() => {
    if (fs.existsSync(testLogFile)) {
      fs.unlinkSync(testLogFile);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hooks are called', () => {
    const mockListener = vi.fn();
    addLogListener(mockListener);
    log.info('testSource', 'testMessage', { key: 'value' });
    expect(mockListener).toHaveBeenCalledWith('info', 'testSource', 'testMessage', { key: 'value' });
  });

  it('writes structured JSON to file at or above level, and ignores below level', async () => {
    // Add a synchronous file transport for testing
    const fileTransport = new winston.transports.File({
      filename: testLogFile,
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    });
    winstonLogger.add(fileTransport);
    
    // Log info (should write)
    log.info('testSource', 'this is an info message', { foo: 'bar' });
    
    // Log debug (should NOT write because transport level is info)
    log.debug('testSource', 'this is a debug message');

    // Wait for Winston to flush to file
    await new Promise(resolve => setTimeout(resolve, 200));
    winstonLogger.remove(fileTransport);

    const content = fs.readFileSync(testLogFile, 'utf8');
    
    // Info should be present
    expect(content).toContain('this is an info message');
    expect(content).toContain('"foo":"bar"');
    expect(content).toContain('"source":"testSource"');
    expect(content).toContain('"level":"info"');
    expect(content).toContain('"timestamp"');

    // Debug should NOT be present
    expect(content).not.toContain('this is a debug message');
  });
});
