import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitRedmineRootHeight, installRedmineRootHeightFit, MIN_ROOT_HEIGHT_PX } from './redmineRootHeight';

type PageModel = {
    viewportHeight: number;
    rootTop: number;
    footerHeight: number;
    // Space below the root that the first estimate cannot see (paddings, margins).
    hiddenBelow: number;
    // Page height that does not depend on the root (e.g. a long Redmine sidebar).
    minPageHeight: number;
    scrollY: number;
};

const setup = (model: PageModel) => {
    document.body.innerHTML = `<div id="footer"></div><div id="redmine-canvas-gantt-root"></div>`;
    const root = document.getElementById('redmine-canvas-gantt-root') as HTMLElement;
    const footer = document.getElementById('footer') as HTMLElement;
    const rootHeight = () => Number.parseFloat(root.style.height || '0');
    const pageHeight = () => Math.max(
        model.minPageHeight,
        model.rootTop + rootHeight() + model.footerHeight + model.hiddenBelow
    );

    Object.defineProperty(footer, 'offsetHeight', { configurable: true, get: () => model.footerHeight });
    Object.defineProperty(root, 'offsetHeight', { configurable: true, get: () => rootHeight() });
    Object.defineProperty(root, 'clientHeight', { configurable: true, get: () => rootHeight() });
    root.getBoundingClientRect = () => ({ top: model.rootTop - model.scrollY } as DOMRect);
    const docEl = document.documentElement;
    Object.defineProperty(docEl, 'clientHeight', { configurable: true, get: () => model.viewportHeight });
    Object.defineProperty(docEl, 'scrollHeight', { configurable: true, get: () => Math.max(model.viewportHeight, pageHeight()) });
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => model.scrollY);

    return { root, rootHeight, overflow: () => docEl.scrollHeight - docEl.clientHeight };
};

const baseModel = (): PageModel => ({
    viewportHeight: 900,
    rootTop: 110,
    footerHeight: 30,
    hiddenBelow: 24,
    minPageHeight: 0,
    scrollY: 0
});

describe('fitRedmineRootHeight', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('removes the page overflow that paddings below the chart would cause', () => {
        const { root, rootHeight, overflow } = setup(baseModel());

        fitRedmineRootHeight({ root });

        expect(overflow()).toBe(0);
        expect(rootHeight()).toBe(900 - 110 - 30 - 24);
    });

    it('does not grow the chart when the page is already scrolled', () => {
        const model = { ...baseModel(), scrollY: 24 };
        const { root, rootHeight, overflow } = setup(model);

        fitRedmineRootHeight({ root });

        expect(overflow()).toBe(0);
        expect(rootHeight()).toBe(900 - 110 - 30 - 24);
    });

    it('keeps the estimate when shrinking the chart cannot remove the overflow', () => {
        const { root, rootHeight } = setup({ ...baseModel(), minPageHeight: 2000 });

        fitRedmineRootHeight({ root });

        expect(rootHeight()).toBe(900 - 110 - 30);
    });

    it('never goes below the minimum height', () => {
        const { root, rootHeight } = setup({ ...baseModel(), viewportHeight: 300 });

        fitRedmineRootHeight({ root });

        expect(rootHeight()).toBe(MIN_ROOT_HEIGHT_PX);
    });
});

describe('installRedmineRootHeightFit', () => {
    beforeEach(() => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('fits immediately and again when the window is resized', () => {
        const model = baseModel();
        const { root, rootHeight, overflow } = setup(model);

        const cleanup = installRedmineRootHeightFit(root);
        expect(overflow()).toBe(0);

        model.viewportHeight = 1000;
        window.dispatchEvent(new Event('resize'));
        expect(overflow()).toBe(0);
        expect(rootHeight()).toBe(1000 - 110 - 30 - 24);

        cleanup();
        model.viewportHeight = 800;
        window.dispatchEvent(new Event('resize'));
        expect(rootHeight()).toBe(1000 - 110 - 30 - 24);
    });
});
