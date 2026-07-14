import { describe, it, expect } from 'vitest';
import { classifyAnomaly, Anomaly, ClassifierInput } from './classifier';

describe('Anomaly Classifier', () => {
  const baseInput: ClassifierInput = {
    qbtPresence: true,
    arrPresence: true,
    expectedPlexPath: 'C:\\plex\\file.mkv',
    qbtPathExists: true,
    qbtPathIsSymlink: true,
    qbtPathSymlinkTarget: 'C:\\plex\\file.mkv',
    plexPathExists: true,
    plexPathIsSymlink: false
  };

  it('classifies Healthy', () => {
    expect(classifyAnomaly(baseInput)).toBe(Anomaly.Healthy);
  });

  it('classifies Unprocessed', () => {
    expect(classifyAnomaly({
      ...baseInput,
      qbtPathIsSymlink: false, // it's a real file in QBT
      qbtPathSymlinkTarget: null
    })).toBe(Anomaly.Unprocessed);
  });

  it('classifies OrphanSymlink', () => {
    expect(classifyAnomaly({
      ...baseInput,
      plexPathExists: false // Target missing
    })).toBe(Anomaly.OrphanSymlink);
  });

  it('classifies DoubleSymlink', () => {
    expect(classifyAnomaly({
      ...baseInput,
      plexPathIsSymlink: true // Target is itself a symlink
    })).toBe(Anomaly.DoubleSymlink);
  });

  it('classifies WrongTarget', () => {
    expect(classifyAnomaly({
      ...baseInput,
      qbtPathSymlinkTarget: 'C:\\plex\\other.mkv'
    })).toBe(Anomaly.WrongTarget);
  });

  it('classifies TorrentNoFile', () => {
    expect(classifyAnomaly({
      ...baseInput,
      qbtPathExists: false
    })).toBe(Anomaly.TorrentNoFile);
  });

  it('classifies UnmanagedTorrent', () => {
    expect(classifyAnomaly({
      ...baseInput,
      arrPresence: false
    })).toBe(Anomaly.UnmanagedTorrent);
  });

  it('classifies NoTorrent', () => {
    expect(classifyAnomaly({
      ...baseInput,
      qbtPresence: false
    })).toBe(Anomaly.NoTorrent);
  });

  it('classifies MissingRealFile', () => {
    expect(classifyAnomaly({
      ...baseInput,
      qbtPathExists: false,
      plexPathExists: false,
      qbtPathIsSymlink: false,
      qbtPathSymlinkTarget: null
    })).toBe(Anomaly.MissingRealFile);
  });
});
