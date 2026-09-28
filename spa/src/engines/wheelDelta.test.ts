import { describe, expect, it } from 'vitest';
import { wheelDeltaToPixels } from './wheelDelta';

describe('wheelDeltaToPixels', () => {
    it('keeps pixel deltas as they are', () => {
        expect(wheelDeltaToPixels(120, 0, 600)).toBe(120);
    });

    it('converts line deltas to pixels', () => {
        expect(wheelDeltaToPixels(3, 1, 600)).toBe(48);
    });

    it('converts page deltas using the page size', () => {
        expect(wheelDeltaToPixels(-1, 2, 600)).toBe(-600);
    });
});
