import React, { useEffect, useRef } from 'react';
import { useTaskStore } from '../stores/TaskStore';
import { i18n } from '../utils/i18n';
import type { Task } from '../types';
import { toLocalDisplayDate } from '../utils/dateOnly';

const formatAriaDate = (date: number | undefined, notSetLabel: string): string => (
    (date && Number.isFinite(date)) ? toLocalDisplayDate(date).toLocaleDateString() : notSetLabel
);

const buildTaskAriaLabel = (task: Task): string => (
    i18n.t('label_task_aria_label', {
        subject: task.subject,
        start: formatAriaDate(task.startDate, i18n.t('label_not_set') || 'Not set'),
        end: formatAriaDate(task.dueDate, i18n.t('label_not_set') || 'Not set'),
        status: task.ratioDone
    }) || `Task: ${task.subject}. Start: ${formatAriaDate(task.startDate, 'Not set')}. End: ${formatAriaDate(task.dueDate, 'Not set')}. Status: ${task.ratioDone}%`
);

const handleItemFocus = (taskId: string) => {
    const { selectedTaskId, selectTask } = useTaskStore.getState();
    if (selectedTaskId !== taskId) {
        selectTask(taskId);
    }
};

const handleItemKeyDown = (e: React.KeyboardEvent, task: Task) => {
    if (e.key === 'Enter') {
        alert(i18n.t('label_task_details_for', { subject: task.subject }) || `Details for: ${task.subject}`);
    }
};

// Memoized per task object: the store replaces a task object only when that task changes,
// so a single edit or a selection change does not rebuild every item's label.
const A11yTaskItem = React.memo(({ task }: { task: Task }) => (
    <li
        tabIndex={0}
        data-id={task.id}
        onFocus={() => handleItemFocus(task.id)}
        onKeyDown={(e) => handleItemKeyDown(e, task)}
        aria-label={buildTaskAriaLabel(task)}
    >
        {task.subject}
    </li>
));
A11yTaskItem.displayName = 'A11yTaskItem';

// Memoized because GanttContainer re-renders on every scroll frame; the list only depends on tasks.
export const A11yLayer: React.FC = React.memo(() => {
    const tasks = useTaskStore(state => state.tasks);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);

    const listRef = useRef<HTMLUListElement>(null);

    // Update focus when selection changes via Canvas
    useEffect(() => {
        if (selectedTaskId && listRef.current) {
            const el = listRef.current.querySelector<HTMLElement>(`[data-id="${selectedTaskId}"]`);
            if (el && document.activeElement !== el) {
                el.focus({ preventScroll: true });
            }
        }
    }, [selectedTaskId]);

    return (
        <ul
            ref={listRef}
            style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                margin: 0,
                padding: 0
            }}
            aria-label={i18n.t('label_gantt_chart_task_list') || 'Gantt Chart Task List'}
        >
            {tasks.map(task => <A11yTaskItem key={task.id} task={task} />)}
        </ul>
    );
});
A11yLayer.displayName = 'A11yLayer';
