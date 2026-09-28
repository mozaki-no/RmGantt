import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore } from '../../stores/TaskStore';
import { useSidebarWheelScroll } from './useSidebarWheelScroll';

const Harness: React.FC = () => {
    const ref = React.useRef<HTMLDivElement>(null);
    useSidebarWheelScroll(ref);
    return <div ref={ref} data-testid="wheel-target" />;
};

const wheel = (target: Element, init: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
};

describe('useSidebarWheelScroll', () => {
    const initialState = useTaskStore.getState();

    beforeEach(() => {
        useTaskStore.setState({
            rowCount: 1000,
            viewport: { ...initialState.viewport, scrollY: 0, height: 600, rowHeight: 36 }
        });
    });

    afterEach(() => {
        useTaskStore.setState(initialState, true);
    });

    it('scrolls the rows and keeps the wheel from scrolling the Redmine page', () => {
        const { getByTestId } = render(<Harness />);

        const event = wheel(getByTestId('wheel-target'), { deltaY: 120 });

        expect(event.defaultPrevented).toBe(true);
        expect(useTaskStore.getState().viewport.scrollY).toBe(120);
    });

    it('converts line-based deltas to pixels', () => {
        const { getByTestId } = render(<Harness />);

        wheel(getByTestId('wheel-target'), { deltaY: 3, deltaMode: 1 });

        expect(useTaskStore.getState().viewport.scrollY).toBe(48);
    });

    it('leaves Ctrl + wheel to the browser', () => {
        const { getByTestId } = render(<Harness />);

        const event = wheel(getByTestId('wheel-target'), { deltaY: 120, ctrlKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(useTaskStore.getState().viewport.scrollY).toBe(0);
    });
});
