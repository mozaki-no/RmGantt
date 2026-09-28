import { describe, expect, it } from 'vitest';
import { pickKeys } from './pickKeys';

describe('pickKeys', () => {
    it('keeps only the requested keys and their values', () => {
        const source = { a: 1, b: 'two', c: [3] };
        const picked = pickKeys(source, ['a', 'c']);

        expect(picked).toEqual({ a: 1, c: [3] });
        expect(picked.c).toBe(source.c);
        expect('b' in picked).toBe(false);
    });
});
