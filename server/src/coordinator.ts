import { log } from './logger';

export type RecheckCallback = (hash: string) => void;

interface State {
  timer: NodeJS.Timeout;
  importsSeen: Set<string>;
  videoFileCount: number;
}

const pendingRechecks = new Map<string, State>();
let recheckCallback: RecheckCallback | null = null;

export function setRecheckCallback(cb: RecheckCallback) {
  recheckCallback = cb;
}

export function getState(hash: string) {
  const state = pendingRechecks.get(hash);
  if (!state) return null;
  return {
    importsSeen: state.importsSeen.size,
    videoFileCount: state.videoFileCount
  };
}

export function getPendingCount() {
  return pendingRechecks.size;
}

export function debounceRecheck(hash: string, fileId: string, videoFileCount: number, delayMs: number = 5000) {
  let state = pendingRechecks.get(hash);
  
  if (state) {
    clearTimeout(state.timer);
    state.importsSeen.add(fileId);
  } else {
    state = {
      timer: setTimeout(() => {}, 0), // dummy init
      importsSeen: new Set([fileId]),
      videoFileCount
    };
    pendingRechecks.set(hash, state);
  }

  // Update videoFileCount in case it wasn't known before
  if (videoFileCount > 0) {
    state.videoFileCount = videoFileCount;
  }

  const fire = () => {
    pendingRechecks.delete(hash);
    log.info('Coordinator', `Firing recheck for ${hash}`);
    if (recheckCallback) {
      recheckCallback(hash);
    }
  };

  // C1: importsSeen === videoFileCount
  if (state.videoFileCount > 0 && state.importsSeen.size >= state.videoFileCount) {
    clearTimeout(state.timer);
    fire();
    return;
  }

  // C2: timer expiry
  state.timer = setTimeout(fire, delayMs);
}

export function clearAll() {
  for (const state of pendingRechecks.values()) {
    clearTimeout(state.timer);
  }
  pendingRechecks.clear();
}
