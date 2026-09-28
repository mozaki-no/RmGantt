import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useTaskStore } from '../../stores/TaskStore';
import { wheelDeltaToPixels } from '../../engines/wheelDelta';

/**
 * Scrolls the Gantt rows when the wheel turns over the sidebar body.
 *
 * The listener is registered natively with `passive: false` so it can call
 * `preventDefault()`. React's `onWheel` is passive, so the same wheel event used to
 * scroll both the chart and the Redmine page behind it, which made the view jitter.
 */
export const useSidebarWheelScroll = (bodyRef: RefObject<HTMLElement | null>): void => {
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            // Leave Ctrl/Cmd + wheel to the browser (page zoom).
            if (e.ctrlKey || e.metaKey) return;
            e.preventDefault();

            const { viewport, updateViewport } = useTaskStore.getState();
            const deltaY = wheelDeltaToPixels(e.deltaY, e.deltaMode, viewport.height);
            if (deltaY === 0) return;
            updateViewport({ scrollY: Math.max(0, viewport.scrollY + deltaY) });
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [bodyRef]);
};
