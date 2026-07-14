import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { z } from 'zod';

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const configSchema = z.object({
  env: z.object({
    PORT: z.coerce.number().default(3000),
    QBT_HOST: z.string().min(1),
    QBT_PORT: z.coerce.number().default(8080),
    QBT_API_KEY: z.string().optional(),
    QBT_USER: z.string().optional(),
    QBT_PASS: z.string().optional(),
    SONARR_URL: z.string().url(),
    SONARR_API_KEY: z.string().min(1),
    RADARR_URL: z.string().url(),
    RADARR_API_KEY: z.string().min(1),
  }),
  yaml: z.object({
    logFile: z.string().default('logs/lariat.log'),
    videoExtensions: z.array(z.string()).default(['.mkv', '.mp4', '.avi', '.m4v']),
    importMode: z.enum(['copy', 'move']).default('copy'),
    debounceMs: z.coerce.number().default(5000),
    thresholds: z.object({
      theta: z.coerce.number().default(0.1),
      w: z.coerce.number().default(0.05),
      r: z.coerce.number().default(0.05),
    }).default({ theta: 0.1, w: 0.05, r: 0.05 }),
    integrity: z.object({
      enabled: z.boolean().default(true),
      hashThrottleMs: z.coerce.number().default(10), // ms yield per 1MiB read
      wBytes: z.coerce.number().default(33554432), // 32 MiB
      r: z.coerce.number().default(4),
    }).default({ enabled: true, hashThrottleMs: 10, wBytes: 33554432, r: 4 }),
    drivePool: z.object({
      enabled: z.boolean().default(false),
      mount: z.string().default('M:\\'),
      disks: z.array(z.string()).default([]),
    }).default({ enabled: false, mount: 'M:\\', disks: [] }),
    timeouts: z.object({
      recheck: z.coerce.number().default(3600),
    }).default({ recheck: 3600 }),
    schedules: z.object({
      healthCheck: z.string().default('0 * * * *'),
    }).default({ healthCheck: '0 * * * *' }),
  })
});

export function loadConfig() {
  const configPath = path.resolve(__dirname, '../../config.yaml');
  let yamlContent = {};
  if (fs.existsSync(configPath)) {
    yamlContent = yaml.parse(fs.readFileSync(configPath, 'utf8')) || {};
  }

  const parsed = configSchema.safeParse({
    env: process.env,
    yaml: yamlContent,
  });

  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Configuration missing or invalid: ${errorDetails}`);
  }

  return {
    ...parsed.data.env,
    ...parsed.data.yaml,
  };
}

// Global config instance
export const config = loadConfig();

/**
 * Normalizes a path for consistent comparison:
 * - lower-cases drive letter
 * - normalizes backslashes to forward slashes
 * - trims whitespace
 * - Unicode Normalization Form C (NFC)
 */
export function normalisePath(p: string): string {
  // Lowercase the entire path for case-insensitive comparison on Windows
  return p.trim().normalize('NFC').replace(/\\/g, '/').toLowerCase();
}
