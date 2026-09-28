import React from 'react';

import { i18n } from '../utils/i18n';
import type { BaselineSaveScope } from '../types/baseline';
import { fontFamilies, designTokens } from '../styles/designTokens';
import { addCalendarDays, formatDateOnly, todayCalendarDate } from '../utils/dateOnly';

interface BaselineControlsProps {
    baselineSaveStatus: 'idle' | 'saving' | 'ready' | 'error';
    hasBaseline: boolean;
    showBaseline: boolean;
    baselineEditable: boolean;
    baselineViewable: boolean;
    baselineSaveMenuRef: React.RefObject<HTMLDivElement | null>;
    showBaselineSaveMenu: boolean;
    onToggleSaveMenu: () => void;
    onSaveBaseline: (scope: BaselineSaveScope) => void;
    onToggleBaseline: () => void;
    historyDate?: string | null;
    historyLoading?: boolean;
    onApplyHistory?: (date: string) => void;
    onClearHistory?: () => void;
}

const defaultHistoryDate = () => formatDateOnly(addCalendarDays(todayCalendarDate(), -7)) ?? '';

const menuItemStyle: React.CSSProperties = {
    width: '100%',
    border: 'none',
    background: 'transparent',
    color: designTokens.controlFg,
    textAlign: 'left',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    font: 'inherit'
};

export const BaselineControls: React.FC<BaselineControlsProps> = ({
    baselineSaveStatus,
    hasBaseline,
    showBaseline,
    baselineEditable,
    baselineViewable,
    baselineSaveMenuRef,
    showBaselineSaveMenu,
    onToggleSaveMenu,
    onSaveBaseline,
    onToggleBaseline,
    historyDate = null,
    historyLoading = false,
    onApplyHistory,
    onClearHistory
}) => {
    const [draftHistoryDate, setDraftHistoryDate] = React.useState<string>(() => historyDate ?? defaultHistoryDate());

    if (!baselineEditable && !baselineViewable) return null;

    const isSaving = baselineSaveStatus === 'saving';
    const isActive = showBaseline || isSaving;

    return (
        <div ref={baselineSaveMenuRef} style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={onToggleSaveMenu}
                aria-label={i18n.t('label_save_baseline') || 'Save Baseline'}
                title={i18n.t('label_save_baseline_tooltip') || 'Save a baseline snapshot'}
                aria-pressed={isActive}
                disabled={isSaving}
                data-testid="baseline-save-menu-button"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    padding: '0 8px',
                    borderRadius: '6px',
                    border: `1px solid ${isActive ? designTokens.controlActiveFg : designTokens.controlBorder}`,
                    backgroundColor: isActive ? designTokens.controlActiveBg : designTokens.controlBg,
                    color: isActive ? designTokens.controlActiveFg : designTokens.controlFg,
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                    height: '32px',
                    width: '40px'
                }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: isSaving ? 0.6 : 1 }}>
                    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            </button>

            {showBaselineSaveMenu && !isSaving && (
                <div
                    data-testid="baseline-save-menu"
                    style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '8px',
                        background: designTokens.controlBg,
                        border: `1px solid ${designTokens.controlBorder}`,
                        borderRadius: '8px',
                        boxShadow: designTokens.menuShadow,
                        padding: '8px',
                        zIndex: 20,
                        minWidth: '240px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        fontFamily: fontFamilies.ui,
                        fontSize: '13px',
                        lineHeight: 1.5
                    }}
                >
                    {baselineViewable && (
                        <label
                            data-testid="baseline-toggle-menu-item"
                            style={{
                                ...menuItemStyle,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'transparent',
                                color: hasBaseline ? designTokens.controlFg : designTokens.disabledFg,
                                cursor: hasBaseline ? 'pointer' : 'not-allowed',
                                opacity: hasBaseline ? 1 : 0.75
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={showBaseline}
                                onChange={onToggleBaseline}
                                disabled={!hasBaseline}
                                data-testid="baseline-toggle-checkbox"
                            />
                            <span>{i18n.t('label_show_baseline_tooltip') || 'Show baseline comparison'}</span>
                        </label>
                    )}
                    {baselineViewable && onApplyHistory && (
                        <div data-testid="baseline-history-section" style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 8px' }}>
                            <span style={{ color: designTokens.controlFg }}>
                                {i18n.t('label_history_compare') || 'Compare with issue history as of'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                    type="date"
                                    value={draftHistoryDate}
                                    max={formatDateOnly(todayCalendarDate()) ?? undefined}
                                    onChange={(event) => setDraftHistoryDate(event.target.value)}
                                    disabled={historyLoading}
                                    data-testid="baseline-history-date-input"
                                    style={{ flex: 1, font: 'inherit', height: '28px' }}
                                />
                                <button
                                    type="button"
                                    data-testid="baseline-history-apply-button"
                                    disabled={historyLoading || !draftHistoryDate}
                                    onClick={() => onApplyHistory(draftHistoryDate)}
                                    style={{ ...menuItemStyle, width: 'auto', border: `1px solid ${designTokens.controlBorder}` }}
                                >
                                    {historyLoading ? '…' : (i18n.t('label_history_apply') || 'Compare')}
                                </button>
                            </div>
                            {historyDate && onClearHistory && (
                                <button type="button" data-testid="baseline-history-clear-button" onClick={onClearHistory} style={menuItemStyle}>
                                    {(i18n.t('label_history_clear') || 'Stop comparing with %{date}').replace('%{date}', historyDate)}
                                </button>
                            )}
                        </div>
                    )}
                    {baselineEditable && (
                        <>
                            {baselineViewable && <div style={{ borderTop: `1px solid ${designTokens.borderSubtle}`, margin: '4px 0' }} />}
                            <button type="button" data-testid="baseline-save-filtered-button" onClick={() => onSaveBaseline('filtered')} style={menuItemStyle}>
                                {i18n.t('label_save_baseline_filtered') || 'Save filtered view as baseline'}
                            </button>
                            <button type="button" data-testid="baseline-save-project-button" onClick={() => onSaveBaseline('project')} style={menuItemStyle}>
                                {i18n.t('label_save_baseline_project') || 'Save whole project as baseline'}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
