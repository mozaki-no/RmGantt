require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/journal_history_snapshot_builder'

RSpec.describe RedmineCanvasGantt::JournalHistorySnapshotBuilder do
  IssueRow = Struct.new(:id, :start_date, :due_date, :done_ratio, :status_id, :created_on, keyword_init: true)

  let(:project) { Struct.new(:id).new(1) }
  let(:at) { Time.utc(2026, 9, 21, 14, 59, 59) }
  let(:date) { Date.new(2026, 9, 21) }
  let(:issue) do
    IssueRow.new(id: 10, start_date: Date.new(2026, 10, 5), due_date: Date.new(2026, 10, 20),
                 done_ratio: 60, status_id: 3, created_on: Time.utc(2026, 9, 1))
  end
  let(:rows) { [] }
  let(:received) { [] }

  subject(:builder) do
    described_class.new(journal_detail_rows: lambda { |ids, time|
      received << [ids, time]
      rows
    })
  end

  it 'uses the oldest change after the moment as the value at that moment' do
    rows.replace([
      [10, 'due_date', '2026-10-10'],
      [10, 'done_ratio', '20'],
      [10, 'due_date', '2026-10-15'],
      [10, 'status_id', '1']
    ])

    snapshot = builder.build(project: project, issues: [issue], at: at, date: date)

    expect(received).to eq([[[10], at]])
    expect(snapshot).to include(scope: 'history', history_date: '2026-09-21', snapshot_id: 'history-2026-09-21', project_id: 1)
    expect(snapshot[:tasks_by_issue_id]['10']).to eq(
      issue_id: 10,
      baseline_start_date: '2026-10-05',
      baseline_due_date: '2026-10-10',
      baseline_done_ratio: 20,
      baseline_status_id: 1
    )
  end

  it 'keeps blank past values as nil and unchanged attributes as current values' do
    rows.replace([[10, 'start_date', nil]])

    task = builder.build(project: project, issues: [issue], at: at, date: date)[:tasks_by_issue_id]['10']

    expect(task[:baseline_start_date]).to be_nil
    expect(task[:baseline_due_date]).to eq('2026-10-20')
    expect(task[:baseline_done_ratio]).to eq(60)
  end

  it 'leaves out issues created after the moment' do
    later = IssueRow.new(id: 11, start_date: nil, due_date: nil, done_ratio: 0, status_id: 1, created_on: at + 1)

    snapshot = builder.build(project: project, issues: [issue, later], at: at, date: date)

    expect(snapshot[:tasks_by_issue_id].keys).to eq(['10'])
    expect(received.first.first).to eq([10])
  end
end
