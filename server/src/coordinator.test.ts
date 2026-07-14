import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounceRecheck, setRecheckCallback, clearAll } from './coordinator';

describe('Coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAll();
  });

  it('debounces 3 rapid swap-finish events for the same hash', () => {
    const cb = vi.fn();
    setRecheckCallback(cb);

    debounceRecheck('hash123', 5000);
    vi.advanceTimersByTime(2000); // at 2s
    
    debounceRecheck('hash123', 5000);
    vi.advanceTimersByTime(2000); // at 4s
    
    debounceRecheck('hash123', 5000);
    
    // Total elapsed: 4s. The last debounce was at 4s. It should fire at 9s.
    vi.advanceTimersByTime(4999);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('hash123');
  });
});
