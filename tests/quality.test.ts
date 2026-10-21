import { describe, expect, it } from 'vitest';
import { FrameWatch } from '../src/render/quality';

/** Feed `seconds` worth of frames at a steady rate; returns whether the watch fired. */
function run(watch: FrameWatch, fps: number, seconds: number): boolean {
  let fired = false;
  for (let t = 0; t < seconds; t += 1 / fps) fired = watch.sample(1 / fps) || fired;
  return fired;
}

describe('FrameWatch', () => {
  it('stays quiet at a smooth frame rate', () => {
    expect(run(new FrameWatch(), 60, 30)).toBe(false);
  });

  it('fires after the grace period when the game runs under 40 fps', () => {
    const watch = new FrameWatch();
    expect(run(watch, 25, 4)).toBe(false);
    expect(run(watch, 25, 6)).toBe(true);
  });

  it('ignores long hitches such as loading or a hidden tab', () => {
    const watch = new FrameWatch();
    run(watch, 60, 6);
    for (let k = 0; k < 10; k++) {
      expect(watch.sample(0.8)).toBe(false);
      expect(run(watch, 60, 1)).toBe(false);
    }
  });
});
