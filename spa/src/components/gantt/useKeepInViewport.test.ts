import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepElementInViewport } from './useKeepInViewport';

const makeElement = (left: number, width: number) => {
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
        const match = /translateX\((-?\d+)px\)/.exec(element.style.transform);
        const offset = match ? Number(match[1]) : 0;
        return { left: left + offset, right: left + offset + width, top: 0, bottom: 10, width, height: 10, x: left + offset, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    return element;
};

describe('keepElementInViewport', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shifts a menu cut off on the left back into view', () => {
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1280);
        const element = makeElement(-114, 316);
        keepElementInViewport(element);
        expect(element.style.transform).toBe('translateX(122px)');
    });

    it('shifts a menu cut off on the right back into view', () => {
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
        const element = makeElement(900, 200);
        keepElementInViewport(element);
        expect(element.style.transform).toBe('translateX(-108px)');
    });

    it('leaves a menu that already fits untouched and clears a stale shift', () => {
        vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1280);
        const element = makeElement(400, 300);
        element.style.transform = 'translateX(50px)';
        keepElementInViewport(element);
        expect(element.style.transform).toBe('');
    });
});
