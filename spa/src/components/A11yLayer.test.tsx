import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore } from '../stores/TaskStore';
import type { Task } from '../types';
import { A11yLayer } from './A11yLayer';

const buildTasks = (count: number): Task[] => Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    subject: `Task ${index + 1}`,
    startDate: Date.UTC(2026, 0, 5),
    dueDate: Date.UTC(2026, 0, 6),
    ratioDone: 0,
    statusId: 1,
    lockVersion: 0,
    editable: true,
    rowIndex: index,
    hasChildren: false
}));

const listedIds = (container: HTMLElement) => Array.from(container.querySelectorAll('li')).map(item => item.getAttribute('data-id'));

describe('A11yLayer', () => {
    const initialState = useTaskStore.getState();

    beforeEach(() => {
        useTaskStore.setState({
            tasks: buildTasks(10_000),
            rowCount: 10_000,
            selectedTaskId: null,
            viewport: { ...initialState.viewport, scrollY: 0, height: 360, rowHeight: 36 }
        });
    });

    afterEach(() => {
        useTaskStore.setState(initialState, true);
    });

    it('lists only the rows around the visible part of the chart', () => {
        const { container } = render(<A11yLayer />);

        const ids = listedIds(container);
        expect(ids[0]).toBe('1');
        expect(ids).toContain('11');
        expect(ids.length).toBeLessThan(200);
    });

    it('moves the listed window with the scroll position', () => {
        const { container } = render(<A11yLayer />);

        act(() => {
            useTaskStore.setState(state => ({ viewport: { ...state.viewport, scrollY: 36 * 5000 } }));
        });

        const ids = listedIds(container);
        expect(ids).toContain('5001');
        expect(ids).toContain('5010');
        expect(ids).not.toContain('1');
    });

    it('keeps the selected task listed when it is outside the window', () => {
        useTaskStore.setState({ selectedTaskId: '9000' });

        const { container } = render(<A11yLayer />);

        expect(listedIds(container)).toContain('9000');
    });
});
