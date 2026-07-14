import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from './config';
import path from 'path';

// Define custom levels
export const levels = {
  critical: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const colors = {
  critical: 'red',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

// Define a type for detail which is an optional object
type Detail = Record<string, any>;

// Define listeners for WebSocket hook point and DB hook
export type LogListener = (level: string, source: string, message: string, detail?: Detail) => void;
const listeners: LogListener[] = [];

export function addLogListener(listener: LogListener) {
  listeners.push(listener);
}

// Custom format
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf((info) => {
    let output = `[${info.timestamp}] [${info.level}] [${info.source}]: ${info.message}`;
    if (info.detail) {
      output += ` | ${JSON.stringify(info.detail)}`;
    }
    return output;
  })
);

// Winston instance
export const winstonLogger = winston.createLogger({
  levels,
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: customFormat,
    }),
    new DailyRotateFile({
      filename: path.isAbsolute(config.logFile) ? config.logFile : path.resolve(__dirname, '../../', config.logFile),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// Create our facade
export const log = {
  _log(level: string, source: string, message: string, detail?: Detail) {
    winstonLogger.log({ level, source, message, detail });
    // Trigger hooks
    listeners.forEach(fn => fn(level, source, message, detail));
  },
  debug(source: string, message: string, detail?: Detail) {
    this._log('debug', source, message, detail);
  },
  info(source: string, message: string, detail?: Detail) {
    this._log('info', source, message, detail);
  },
  warn(source: string, message: string, detail?: Detail) {
    this._log('warn', source, message, detail);
  },
  error(source: string, message: string, detail?: Detail) {
    this._log('error', source, message, detail);
  },
  critical(source: string, message: string, detail?: Detail) {
    this._log('critical', source, message, detail);
  },
  async close() {
    return new Promise<void>((resolve) => {
      winstonLogger.on('finish', () => resolve());
      winstonLogger.end();
    });
  }
};
