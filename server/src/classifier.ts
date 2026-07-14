import { normalisePath } from './config';

export enum Anomaly {
  Healthy = 'healthy',
  Unprocessed = 'unprocessed',
  OrphanSymlink = 'orphan_symlink',
  DoubleSymlink = 'double_symlink',
  WrongTarget = 'wrong_target',
  MissingRealFile = 'missing_real_file',
  NoTorrent = 'no_torrent',
  TorrentNoFile = 'torrent_no_file',
  UnmanagedTorrent = 'unmanaged_torrent',
  RecheckFailed = 'recheck_failed',
  IntegrityFail = 'integrity_fail',
  SwapFailed = 'swap_failed'
}

export interface ClassifierInput {
  qbtPresence: boolean;
  arrPresence: boolean;
  expectedPlexPath: string | null;

  qbtPathExists: boolean;
  qbtPathIsSymlink: boolean;
  qbtPathSymlinkTarget: string | null;

  plexPathExists: boolean;
  plexPathIsSymlink: boolean;
}

export function classifyAnomaly(input: ClassifierInput): Anomaly {
  // 1. If Arr expects a file but it's completely missing everywhere
  if (input.arrPresence && !input.plexPathExists && !input.qbtPathExists) {
    return Anomaly.MissingRealFile;
  }

  // If QBT torrent is present but its file is missing
  if (input.qbtPresence && !input.qbtPathExists) {
    return Anomaly.TorrentNoFile;
  }

  // If QBT torrent is present but not in Arr
  if (input.qbtPresence && !input.arrPresence) {
    return Anomaly.UnmanagedTorrent;
  }

  // If QBT torrent is missing, but we are managing this link/file
  if (!input.qbtPresence && (input.qbtPathExists || input.arrPresence)) {
    return Anomaly.NoTorrent;
  }

  // From here, we generally expect qbtPresence = true and arrPresence = true
  
  if (input.qbtPathIsSymlink) {
    // It is a symlink. Let's check the target.
    if (input.expectedPlexPath && input.qbtPathSymlinkTarget) {
      if (normalisePath(input.qbtPathSymlinkTarget) !== normalisePath(input.expectedPlexPath)) {
        return Anomaly.WrongTarget;
      }
    }

    if (!input.plexPathExists) {
      return Anomaly.OrphanSymlink;
    }

    if (input.plexPathIsSymlink) {
      return Anomaly.DoubleSymlink;
    }

    // Target matches, plex path exists and is not a symlink. Healthy!
    return Anomaly.Healthy;
  } else {
    // QBT path is NOT a symlink.
    // If it exists, and arrPresence is true, it's unprocessed (awaiting swap).
    if (input.qbtPathExists) {
      return Anomaly.Unprocessed;
    }

    // If QBT path doesn't exist, we'd have caught it in TorrentNoFile or NoTorrent.
    // If we reach here and Arr expects a file but it's completely missing:
    if (input.arrPresence && !input.plexPathExists) {
      return Anomaly.MissingRealFile;
    }
  }

  // Fallback for edge cases (e.g., both missing, no symlink, etc).
  if (input.arrPresence && !input.plexPathExists) {
    return Anomaly.MissingRealFile;
  }

  return Anomaly.Healthy; // Should ideally never reach here without matching a state
}
