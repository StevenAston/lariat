import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { computeSparseMerkle, resolvePhysicalPath } from './hasher';
import { config } from './config';

describe('Sparse Reverse-Merkle Hasher', () => {
  const tempDir = path.join(os.tmpdir(), 'lariat-hasher-test');
  const testFile1 = path.join(tempDir, 'test1.mkv');
  const testFile2 = path.join(tempDir, 'test2.mkv');
  
  beforeAll(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    
    // Create a 100MB dummy file
    const buffer = Buffer.alloc(100 * 1024 * 1024);
    // Fill it with some pseudo-random data to ensure hashes aren't all zero
    for (let i = 0; i < buffer.length; i += 4096) {
      buffer.writeUInt32LE(i % 1000000, i);
    }
    
    await fs.writeFile(testFile1, buffer);
    await fs.writeFile(testFile2, buffer);
  });
  
  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  
  it('should produce identical roots for identical files', async () => {
    const stat1 = await fs.stat(testFile1);
    const hash1 = await computeSparseMerkle(testFile1, stat1.size);
    
    const stat2 = await fs.stat(testFile2);
    const hash2 = await computeSparseMerkle(testFile2, stat2.size);
    
    expect(hash1.root).toEqual(hash2.root);
    expect(hash1.sizeAtHash).toEqual(stat1.size);
    // Since default w=32MB, r=4, S=128MB. For 100MB file, it should just read 1 chunk?
    // startOffset = 100 - (0*128) - 32 = 68MB
    // endOffset = 100MB
    // Next k=1: start = 100 - 128 - 32 = -60MB -> actualStart = 0, end = 100 - 128 = -28MB -> breaks.
    // So 1 leaf!
    expect(hash1.leaves.length).toEqual(1);
    expect(hash1.leaves[0].offset).toEqual(68 * 1024 * 1024);
  });
  
  it('should change root when a sampled region is modified', async () => {
    const stat1 = await fs.stat(testFile1);
    const originalHash = await computeSparseMerkle(testFile1, stat1.size);
    
    // Modify the last byte (which is in the k=0 sample)
    const fd = await fs.open(testFile1, 'r+');
    const b = Buffer.alloc(1);
    b[0] = 0xFF;
    await fd.write(b, 0, 1, stat1.size - 1);
    await fd.close();
    
    const modifiedHash = await computeSparseMerkle(testFile1, stat1.size);
    
    expect(modifiedHash.root).not.toEqual(originalHash.root);
    expect(modifiedHash.sizeAtHash).toEqual(originalHash.sizeAtHash);
  });
  
  it('should resolve DrivePool physical path if found (mocked)', async () => {
    // Setup a fake DrivePool structure
    const dpMount = 'M:\\';
    const dpDisk = path.join(tempDir, 'dpdisk');
    const pp = path.join(dpDisk, 'PoolPart.1234');
    await fs.mkdir(path.join(pp, 'Media', 'Movies'), { recursive: true });
    const realFile = path.join(pp, 'Media', 'Movies', 'test.mkv');
    await fs.writeFile(realFile, 'test');
    
    // Mock config
    config.drivePool.enabled = true;
    config.drivePool.mount = dpMount;
    config.drivePool.disks = [dpDisk];
    
    const virtualPath = 'M:\\Media\\Movies\\test.mkv';
    const result = await resolvePhysicalPath(virtualPath);
    
    // Should resolve to the physical path
    expect(result.physicalPath.toLowerCase()).toEqual(realFile.toLowerCase());
    
    // Cleanup config
    config.drivePool.enabled = false;
  });
});
