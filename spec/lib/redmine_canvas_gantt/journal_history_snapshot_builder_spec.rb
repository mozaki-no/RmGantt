require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/journal_history_snapshot_builder'

RSpec.describe RedmineCanvasGantt::JournalHistorySnapshotBuilder do
  IssueRow = Struct.new(:id, :parent_id, :start_date, :due_date, :done_ratio, :status_id, :estimated_hours, :created_on,
                        keyword_init: true)

  let(:project) { Struct.new(:id).new(1) }
  let(:at) { Time.utc(2026, 9, 21, 14, 59, 59) }
  let(:date) { Date.new(2026, 9, 21) }
  let(:issue) do
    IssueRow.new(id: 10, start_date: Date.new(2026, 10, 5), due_date: Date.new(2026, 10, 20),
                 done_ratio: 60, status_id: 3, created_on: Time.utc(2026, 9, 1))
  end
  let(:rows) { [] }
  let(:received) { [] }
  let(:rules) do
    described_class::DerivationRules.new(
      dates_derived: true, done_ratio_derived: true, use_status_for_done_ratio: false,
      closed_status_ids: [5], default_done_ratio_by_status_id: {}
    )
  end

  subject(:builder) do
    described_class.new(rules: rules, journal_detail_rows: lambda { |ids, time|
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

  describe 'parent issues, whose derived values Redmine does not journal' do
    def row(id, parent_id: nil, start_date: nil, due_date: nil, done_ratio: 0, status_id: 1, estimated_hours: nil)
      IssueRow.new(id: id, parent_id: parent_id, start_date: start_date, due_date: due_date, done_ratio: done_ratio,
                   status_id: status_id, estimated_hours: estimated_hours, created_on: Time.utc(2026, 9, 1))
    end

    # Current values are consistent with Redmine's rules: dates span the
    # children, progress 85 = (30h * 100 + 10h * 40) / (20h * 2).
    let(:parent) { row(1, start_date: Date.new(2026, 10, 1), due_date: Date.new(2026, 10, 30), done_ratio: 85) }
    let(:child_a) do
      row(2, parent_id: 1, start_date: Date.new(2026, 10, 1), due_date: Date.new(2026, 10, 10), done_ratio: 100, estimated_hours: 30)
    end
    let(:child_b) do
      row(3, parent_id: 1, start_date: Date.new(2026, 10, 5), due_date: Date.new(2026, 10, 30), done_ratio: 40, estimated_hours: 10)
    end

    it 'rebuilds dates and weighted progress from the children as they were' do
      rows.replace([
        [2, 'done_ratio', '50'],
        [3, 'due_date', '2026-10-20'],
        [3, 'estimated_hours', '30.0']
      ])

      tasks = builder.build(project: project, issues: [parent, child_a, child_b], at: at, date: date)[:tasks_by_issue_id]

      expect(tasks['1']).to include(baseline_start_date: '2026-10-01', baseline_due_date: '2026-10-20', baseline_done_ratio: 45)
    end

    it 'derives grandparents from their child parents and counts closed children as done' do
      middle = row(3, parent_id: 1, start_date: Date.new(2026, 11, 1), due_date: Date.new(2026, 11, 5), done_ratio: 100)
      grandchild = row(4, parent_id: 3, start_date: Date.new(2026, 11, 1), due_date: Date.new(2026, 11, 5), status_id: 5)
      top = row(1, start_date: Date.new(2026, 10, 1), due_date: Date.new(2026, 11, 5), done_ratio: 100)
      rows.replace([[4, 'due_date', '2026-11-20'], [4, 'status_id', '1'], [2, 'done_ratio', '0'], [2, 'estimated_hours', nil]])

      tasks = builder.build(project: project, issues: [top, child_a, middle, grandchild], at: at, date: date)[:tasks_by_issue_id]

      expect(tasks['3']).to include(baseline_start_date: '2026-11-01', baseline_due_date: '2026-11-20', baseline_done_ratio: 0)
      expect(tasks['1']).to include(baseline_start_date: '2026-10-01', baseline_due_date: '2026-11-20', baseline_done_ratio: 0)
    end

    it 'keeps journaled values for a parent whose current values the rules do not reproduce' do
      # Progress written straight onto the parent (e.g. by a script), not derived from the children.
      written = row(1, start_date: Date.new(2026, 10, 1), due_date: Date.new(2026, 10, 30), done_ratio: 50)
      rows.replace([[1, 'done_ratio', '20'], [2, 'done_ratio', '10']])

      tasks = builder.build(project: project, issues: [written, child_a, child_b], at: at, date: date)[:tasks_by_issue_id]

      expect(tasks['1']).to include(baseline_done_ratio: 20, baseline_due_date: '2026-10-30')
    end

    it 'keeps journaled values when Redmine does not derive parent attributes' do
      rules.dates_derived = false
      rules.done_ratio_derived = false

      tasks = builder.build(project: project, issues: [parent, child_a, child_b], at: at, date: date)[:tasks_by_issue_id]

      expect(tasks['1']).to include(baseline_due_date: '2026-10-30', baseline_done_ratio: 85)
    end
  end
end
