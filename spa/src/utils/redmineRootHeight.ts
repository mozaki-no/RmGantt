export const MIN_ROOT_HEIGHT_PX = 400;

type RootHeightEnvironment = {
    root: HTMLElement;
    doc?: Document;
    win?: Window;
};

const documentOverflow = (docEl: HTMLElement): number => Math.max(0, docEl.scrollHeight - docEl.clientHeight);

const setRootHeight = (root: HTMLElement, height: number) => {
    const next = `${Math.max(MIN_ROOT_HEIGHT_PX, Math.floor(height))}px`;
    if (root.style.height !== next) {
        root.style.height = next;
    }
};

/**
 * Sizes the Canvas Gantt root so the Redmine page itself does not scroll.
 *
 * When the page is even a few pixels taller than the window, Redmine gets its own
 * scrollbar next to the chart's, and a wheel turn over the chart edges scrolls the
 * page and the chart together, which is the "jitter" users see.
 *
 * The first estimate (window height minus what sits above the root and the footer)
 * does not know about paddings and margins below the root, so the page overflow is
 * measured afterwards and taken off the root height.
 */
export const fitRedmineRootHeight = ({ root, doc = document, win = window }: RootHeightEnvironment): void => {
    const docEl = doc.documentElement;
    const viewportHeight = docEl.clientHeight || win.innerHeight;
    // Document-relative, so a page that is already scrolled does not inflate the estimate.
    const rootTop = root.getBoundingClientRect().top + win.scrollY;
    const footerHeight = doc.getElementById('footer')?.offsetHeight ?? 0;
    // style.height is the content height unless the page uses border-box sizing.
    const chrome = win.getComputedStyle(root).boxSizing === 'border-box' ? 0 : root.offsetHeight - root.clientHeight;

    const estimate = viewportHeight - rootTop - footerHeight - chrome;
    setRootHeight(root, estimate);

    const overflow = documentOverflow(docEl);
    if (overflow <= 0) return;

    setRootHeight(root, estimate - overflow);
    // Something other than the chart (a long Redmine sidebar, a narrow window) makes
    // the page scroll; shrinking the chart does not help there, so keep the estimate.
    if (documentOverflow(docEl) >= overflow) {
        setRootHeight(root, estimate);
    }
};

/**
 * Keeps the root fitted while the window, the Redmine header, or anything else on the
 * page changes size. Returns a cleanup function.
 */
export const installRedmineRootHeightFit = (root: HTMLElement, doc: Document = document, win: Window = window): (() => void) => {
    let frame: number | null = null;
    const fit = () => fitRedmineRootHeight({ root, doc, win });
    const scheduleFit = () => {
        if (frame !== null) return;
        frame = win.requestAnimationFrame(() => {
            frame = null;
            fit();
        });
    };

    fit();
    win.addEventListener('resize', scheduleFit, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(scheduleFit);
        // The body covers flash messages and anything above or below the chart; the
        // fit itself converges, so the body resize it causes settles after one pass.
        resizeObserver.observe(doc.body);
        ['header', 'main-menu', 'footer'].forEach((id) => {
            const el = doc.getElementById(id);
            if (el) resizeObserver.observe(el);
        });
        observer = resizeObserver;
    }

    return () => {
        win.removeEventListener('resize', scheduleFit);
        observer?.disconnect();
        if (frame !== null) win.cancelAnimationFrame(frame);
    };
};
