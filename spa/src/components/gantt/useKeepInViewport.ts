import React from 'react';

const VIEWPORT_MARGIN = 8;

/**
 * Shift an absolutely positioned dropdown horizontally so it stays inside the viewport.
 * Right-aligned menus opened from a button near the left edge (e.g. after the toolbar wraps)
 * would otherwise be cut off on the left side.
 */
export const keepElementInViewport = (element: HTMLElement, margin = VIEWPORT_MARGIN) => {
    element.style.transform = '';
    const rect = element.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;

    let shift = 0;
    if (rect.right > viewportWidth - margin) {
        shift = viewportWidth - margin - rect.right;
    }
    // The left edge wins when the menu is wider than the viewport, so its start stays readable.
    if (rect.left + shift < margin) {
        shift = margin - rect.left;
    }

    if (shift !== 0) {
        element.style.transform = `translateX(${Math.round(shift)}px)`;
    }
};

export const useKeepInViewport = <T extends HTMLElement>(open: boolean) => {
    const ref = React.useRef<T | null>(null);

    React.useLayoutEffect(() => {
        if (!open || !ref.current) return;
        const update = () => {
            if (ref.current) keepElementInViewport(ref.current);
        };
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, [open]);

    return ref;
};
