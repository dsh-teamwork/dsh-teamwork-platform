import { describe, expect, it } from 'vitest';
import { frameBatch } from '../frame-batch';

describe('frameBatch', () => {
  it('hands over everything pushed before a frame at once, in order, now when asked, and nothing once stopped', () => {
    const frames: Array<() => void> = [];
    const flushed: number[][] = [];
    const batch = frameBatch<number>((items) => flushed.push(items), (run) => frames.push(run));
    batch.push(1);
    batch.push(2);
    batch.push(3);
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(flushed).toEqual([[1, 2, 3]]);
    batch.push(4);
    batch.flush();
    expect(flushed).toEqual([[1, 2, 3], [4]]);
    frames.shift()!();
    expect(flushed).toEqual([[1, 2, 3], [4]]);
    batch.push(6);
    expect(frames).toHaveLength(1);
    batch.stop();
    frames.shift()!();
    batch.push(5);
    expect(flushed).toEqual([[1, 2, 3], [4]]);
  });
});
