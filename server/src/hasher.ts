import fs from 'fs';
import path from 'path';
import xxhash from 'xxhash-wasm';
import { config, normalisePath } from './config';
import { getDb } from './db';

// Ensure xxhash-wasm is initialized
let hasherFactory: any = null;
xxhash().then(h => { hasherFactory = h; }).catch(console.error);

export async function getHasherFactory() {
  if (hasherFactory) return hasherFactory;
  hasherFactory = await xxhash();
  return hasherFactory;
}

/**
 * Resolves a virtual DrivePool path (e.g., M:\...) to its physical underlying path (e.g., V:\PoolPart.guid\...).
 * If DrivePool is not enabled or the file is not on the pool, returns the original path.
 */
export async function resolvePhysicalPath(virtualPath: string): Promise<{ physicalPath: string; driveLetter: string }> {
  const normPath = normalisePath(virtualPath);
  
  if (!config.drivePool.enabled) {
    const driveMatch = normPath.match(/^([a-z]):/i);
    return { 
      physicalPath: normPath, 
      driveLetter: driveMatch ? driveMatch[1].toLowerCase() : 'unknown' 
    };
  }

  const mountLower = normalisePath(config.drivePool.mount);
  if (!normPath.startsWith(mountLower)) {
    const driveMatch = normPath.match(/^([a-z]):/i);
    return { 
      physicalPath: normPath, 
      driveLetter: driveMatch ? driveMatch[1].toLowerCase() : 'unknown' 
    };
  }

  // It's on the pool. Find the physical path.
  let relativePath = normPath.substring(mountLower.length);
  if (relativePath.startsWith('/')) {
    relativePath = relativePath.substring(1);
  }

  for (const disk of config.drivePool.disks) {
    const diskLower = normalisePath(disk);
    try {
      // Find PoolPart folders on this disk
      const entries = await fs.promises.readdir(diskLower, { withFileTypes: true });
      const poolPartDirs = entries.filter(e => e.isDirectory() && e.name.toLowerCase().startsWith('poolpart.'));
      
      for (const pp of poolPartDirs) {
        const testPath = path.join(diskLower, pp.name, relativePath);
        try {
          const stat = await fs.promises.stat(testPath);
          if (stat.isFile()) {
            const driveMatch = testPath.match(/^([a-z]):/i);
            return {
              physicalPath: testPath,
              driveLetter: driveMatch ? driveMatch[1].toLowerCase() : 'unknown'
            };
          }
        } catch (e) {
          // File not on this PoolPart
        }
      }
    } catch (e) {
      // Disk might be inaccessible
      console.warn(`Failed to scan DrivePool disk ${diskLower}`, e);
    }
  }

  // Fallback to the virtual path if not found on underlying disks
  const driveMatch = normPath.match(/^([a-z]):/i);
  return { 
    physicalPath: normPath, 
    driveLetter: driveMatch ? driveMatch[1].toLowerCase() : 'unknown' 
  };
}

class ConcurrencyCoordinator {
  private activeTasks = new Map<string, Promise<void>>();

  async runExclusive<T>(driveLetter: string, task: () => Promise<T>): Promise<T> {
    // Wait for the current task on this drive to finish
    while (this.activeTasks.has(driveLetter)) {
      await this.activeTasks.get(driveLetter);
    }

    // Start our task and track it
    let resolver: () => void;
    const promise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    
    this.activeTasks.set(driveLetter, promise);

    try {
      return await task();
    } finally {
      // Cleanup and let the next task proceed
      this.activeTasks.delete(driveLetter);
      resolver!();
    }
  }
}

export const driveCoordinator = new ConcurrencyCoordinator();

export interface SparseHashResult {
  root: string;
  sizeAtHash: number;
  leaves: { offset: number; hash: string }[];
}

/**
 * Computes the sparse reverse-Merkle hash for a file.
 * Automatically throttles reads to avoid pegging the physical disk.
 */
export async function computeSparseMerkle(filePath: string, fileSize: number): Promise<SparseHashResult> {
  const { h64Raw, h64ToString } = await getHasherFactory();
  
  const w = config.integrity.wBytes;
  const r = config.integrity.r;
  const stride = r * w;
  
  let fd: fs.promises.FileHandle | null = null;
  const leaves: { offset: number; hash: string }[] = [];
  
  try {
    fd = await fs.promises.open(filePath, 'r');
    
    let k = 0;
    while (true) {
      const startOffset = fileSize - (k * stride) - w;
      const endOffset = fileSize - (k * stride);
      
      if (endOffset <= 0) {
        break; // We've moved past the beginning of the file
      }
      
      const actualStart = Math.max(0, startOffset);
      const readLength = endOffset - actualStart;
      
      const buffer = Buffer.alloc(readLength);
      
      // Throttle: read in 1 MiB chunks to allow event loop and other I/O to interleave
      const chunkSize = 1024 * 1024;
      let bytesReadTotal = 0;
      
      while (bytesReadTotal < readLength) {
        const toRead = Math.min(chunkSize, readLength - bytesReadTotal);
        await fd.read(buffer, bytesReadTotal, toRead, actualStart + bytesReadTotal);
        bytesReadTotal += toRead;
        
        if (config.integrity.hashThrottleMs > 0) {
          // Yield the event loop to throttle disk I/O
          await new Promise(res => setTimeout(res, config.integrity.hashThrottleMs));
        }
      }
      
      // Hash the full window
      const u8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      const hash = h64Raw(u8).toString(16).padStart(16, '0');
      leaves.push({ offset: actualStart, hash });
      
      k++;
      if (startOffset <= 0) {
        break; // Reached the beginning
      }
    }
    
    // Sort leaves by offset ascending
    leaves.sort((a, b) => a.offset - b.offset);
    
    // Compute root by hashing concatenated leaf hashes
    // For a reverse merkle, we can simply hash the ordered concatenation of leaf digests.
    // We'll concatenate their string representations and hash that.
    const concatStr = leaves.map(l => l.hash).join('');
    const root = h64ToString(concatStr);
    
    return {
      root,
      sizeAtHash: fileSize,
      leaves
    };
    
  } finally {
    if (fd) {
      await fd.close();
    }
  }
}
