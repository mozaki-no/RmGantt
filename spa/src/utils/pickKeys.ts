/**
 * Returns an object holding only the given keys of `source`.
 * Meant for `useStore(useShallow(state => pickKeys(state, [...])))`, so a component
 * that needs many store fields re-renders only when one of those fields changes,
 * instead of on every store update (e.g. each scroll frame's viewport change).
 */
export const pickKeys = <T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> => {
    const picked = {} as Pick<T, K>;
    for (const key of keys) {
        picked[key] = source[key];
    }
    return picked;
};
