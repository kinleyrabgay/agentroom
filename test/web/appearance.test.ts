import { describe, expect, it } from 'vitest';
import { accentTokens, buildStylesheet, dominantHue, msToNextSwitch, rgbToOklch, sceneFor } from '../../web/features/appearance/lib/appearance.js';

describe('appearance', () => {
  it('clamps chroma so any accent stays legible', () => {
    expect(accentTokens(250, 0.5, false)['--brand']).toBe('oklch(0.6 0.19 250)');
    expect(accentTokens(250, 0.01, true)['--brand']).toBe('oklch(0.77 0.09 250)');
  });

  it('picks the time-of-day scene and the next switch', () => {
    const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m);
    expect([3, 6, 13, 21].map((h) => sceneFor('time', at(h)))).toEqual(['nebula', 'dawn', 'ocean', 'dusk']);
    expect(msToNextSwitch(at(11, 30))).toBe(30 * 60 * 1000);
    expect(msToNextSwitch(at(19))).toBe(5 * 3600 * 1000);
    expect(sceneFor('none')).toBeNull();
  });

  it('converts sRGB to OKLCH', () => {
    const red = rgbToOklch(255, 0, 0);
    expect(red.l).toBeCloseTo(0.628, 2);
    expect(red.c).toBeCloseTo(0.258, 2);
    expect(red.h).toBeCloseTo(29.2, 0);
    expect(rgbToOklch(128, 128, 128).c).toBeLessThan(0.001);
  });

  it('finds the colourful hue and ignores greys', () => {
    const px = (rgb: number[], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat();
    const blueish = new Uint8ClampedArray([...px([40, 90, 220], 30), ...px([128, 128, 128], 300)]);
    const hue = dominantHue(blueish, 1)!;
    expect(hue).toBeGreaterThan(250);
    expect(hue).toBeLessThan(275);
    expect(dominantHue(new Uint8ClampedArray(px([90, 90, 90], 50)), 1)).toBeUndefined();
  });

  it('builds both themes and flags a wallpaper', () => {
    const plain = buildStylesheet({ accent: 'blue', wallpaper: 'none', scale: 1.1 });
    expect(plain.wallpaper).toBe(false);
    expect(plain.css).toContain('--ui-scale:1.1');
    expect(plain.css).toContain('html.dark{');
    const scene = buildStylesheet({ accent: 'wallpaper', wallpaper: 'forest', scale: 1 });
    expect(scene.wallpaper).toBe(true);
    expect(scene.css).toContain('--wallpaper:radial-gradient');
    expect(scene.css).toContain('--brand:oklch(0.6 0.14 130)');
  });
});
