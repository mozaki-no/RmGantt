const LINE_HEIGHT_PX = 16;

/**
 * Converts a WheelEvent delta to pixels. Firefox reports mouse wheels in lines
 * (deltaMode 1), and some devices report pages (deltaMode 2); treating those as
 * pixels makes the chart move only a few pixels per notch.
 */
export const wheelDeltaToPixels = (delta: number, deltaMode: number, pageSizePx: number): number => {
    if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
    if (deltaMode === 2) return delta * pageSizePx;
    return delta;
};
