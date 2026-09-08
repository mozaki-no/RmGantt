require_relative '../../spec_helper'

RSpec.describe RedmineCanvasGantt::DataPayloadBuilder do
  it 'requires set explicitly for to_set usage' do
    source = File.read(File.expand_path('../../../lib/redmine_canvas_gantt/data_payload_builder.rb', __dir__))
    expect(source).to include("require 'set'")
  end

  describe '#build' do
    it 'builds stable filter options for descendant projects and assignees' do
      custom_field_extractor = instance_double(
        RedmineCanvasGantt::CustomFieldExtractor,
        build_project_custom_fields: []
      )
      current_user = instance_double(User)
      builder = described_class.new(custom_field_extractor: custom_field_extractor, current_user: current_user)
      allow(Version).to receive_message_chain(:visible, :where).and_return([])
      allow(IssueStatus).to receive(:sorted).and_return([])

      project = instance_double(Project, id: 1, name: 'Root', start_date: nil, due_date: nil)
      child_project = instance_double(Project, id: 2, name: 'Child')
      root_project = instance_double(Project, id: 1, name: 'Root')
      alice = instance_double(User, name: 'Alice')
      bob = instance_double(User, name: 'Bob')
      issue_a = instance_double(Issue, assigned_to_id: 7, assigned_to: alice, project_id: 1, tracker_id: nil, tracker: nil)
      issue_b = instance_double(Issue, assigned_to_id: 8, assigned_to: bob, project_id: 2, tracker_id: nil, tracker: nil)
      issue_c = instance_double(Issue, assigned_to_id: nil, assigned_to: nil, project_id: 2, tracker_id: nil, tracker: nil)

      payload = builder.build(
        project: project,
        permissions: { editable: true, viewable: true, baseline_editable: false },
        project_ids: [1, 2],
        issues: [],
        filter_option_projects: [child_project, root_project],
        filter_option_assignees: [issue_a, issue_b, issue_c],
        business_calendar: { status: 'ok', revision: 'revision' }
      )

      expect(payload[:filter_options]).to eq(
        projects: [
          { id: 2, name: 'Child' },
          { id: 1, name: 'Root' }
        ],
        assignees: [
          { id: nil, name: nil, project_ids: ['2'] },
          { id: 7, name: 'Alice', project_ids: ['1'] },
          { id: 8, name: 'Bob', project_ids: ['2'] }
        ],
        trackers: []
      )
      expect(payload[:businessCalendar]).to eq(status: 'ok', revision: 'revision')
    end

    it 'builds tracker candidates from the unfiltered candidate membership set' do
      custom_field_extractor = instance_double(
        RedmineCanvasGantt::CustomFieldExtractor,
        build_project_custom_fields: []
      )
      builder = described_class.new(custom_field_extractor: custom_field_extractor, current_user: instance_double(User))
      allow(Version).to receive_message_chain(:visible, :where).and_return([])
      allow(IssueStatus).to receive(:sorted).and_return([])

      candidates = [
        { id: 3, name: 'Bug', project_id: 1 },
        { id: 4, name: 'Feature', project_id: 2 },
        { id: 3, name: 'Bug', project_id: 2 }
      ]

      payload = builder.build(
        project: instance_double(Project, id: 1, name: 'Root', start_date: nil, due_date: nil),
        permissions: {},
        project_ids: [1, 2],
        issues: [],
        filter_option_projects: [],
        filter_option_assignees: [],
        filter_option_trackers: candidates
      )

      expect(payload[:filter_options][:trackers]).to eq([
        { id: 3, name: 'Bug', project_ids: %w[1 2] },
        { id: 4, name: 'Feature', project_ids: ['2'] }
      ])
    end
  end

  describe '#build_assignee_options' do
    let(:builder) do
      described_class.new(
        custom_field_extractor: instance_double(RedmineCanvasGantt::CustomFieldExtractor),
        current_user: instance_double(User)
      )
    end

    it 'accepts the distinct (assigned_to_id, project_id) projection' do
      candidates = [
        { id: 7, project_id: 1, name: 'Alice' },
        { id: 8, project_id: 2, name: 'Bob' },
        { id: 7, project_id: 2, name: 'Alice' },
        { id: nil, project_id: 2, name: nil }
      ]

      expect(builder.build_assignee_options(candidates)).to eq([
        { id: nil, name: nil, project_ids: ['2'] },
        { id: 7, name: 'Alice', project_ids: %w[1 2] },
        { id: 8, name: 'Bob', project_ids: ['2'] }
      ])
    end

    it 'still accepts issue-like records so existing callers keep working' do
      alice = instance_double(User, name: 'Alice')
      issue = instance_double(Issue, assigned_to_id: 7, assigned_to: alice, project_id: 1)

      expect(builder.build_assignee_options([issue])).to eq([
        { id: 7, name: 'Alice', project_ids: ['1'] }
      ])
    end
  end

  describe '#build_tasks' do
    it 'resolves :edit_issues once per project rather than once per issue' do
      current_user = instance_double(User)
      extractor = instance_double(RedmineCanvasGantt::CustomFieldExtractor)
      builder = described_class.new(custom_field_extractor: extractor, current_user: current_user)

      project = instance_double(Project, id: 1, name: 'Root')
      issues = Array.new(5) do |index|
        instance_double(
          Issue,
          id: index + 1, subject: "Task", project_id: 1, project: project,
          start_date: nil, due_date: nil, done_ratio: 0,
          status_id: 1, status: instance_double(IssueStatus, name: 'New'),
          assigned_to_id: nil, assigned_to: nil, parent_id: nil, lock_version: 0,
          tracker_id: 1, tracker: nil, fixed_version_id: nil, fixed_version: nil,
          priority_id: 1, priority: nil, author_id: 1, author: nil,
          category_id: nil, category: nil, estimated_hours: nil,
          created_on: nil, updated_on: nil, spent_hours: 0.0, editable?: true
        )
      end

      allow(extractor).to receive(:build_task_custom_field_values).and_return({})
      # Serialization must stay query-free; the preload happens where the
      # collection is loaded, not here.
      expect(RedmineCanvasGantt::SpentHoursPreloader).not_to receive(:call)
      expect(current_user).to receive(:allowed_to?).with(:edit_issues, project).once.and_return(true)
      expect(current_user).to receive(:allowed_to?).with(:log_time, project).once.and_return(true)

      tasks = builder.build_tasks(issues)

      expect(tasks.map { |task| task[:editable] }).to all(be(true))
    end

    it 'skips Issue#editable? entirely when the project denies :edit_issues' do
      current_user = instance_double(User)
      extractor = instance_double(RedmineCanvasGantt::CustomFieldExtractor)
      builder = described_class.new(custom_field_extractor: extractor, current_user: current_user)

      project = instance_double(Project, id: 1, name: 'Root')
      issue = instance_double(
        Issue,
        id: 1, subject: 'Task', project_id: 1, project: project,
        start_date: nil, due_date: nil, done_ratio: 0,
        status_id: 1, status: instance_double(IssueStatus, name: 'New'),
        assigned_to_id: nil, assigned_to: nil, parent_id: nil, lock_version: 0,
        tracker_id: 1, tracker: nil, fixed_version_id: nil, fixed_version: nil,
        priority_id: 1, priority: nil, author_id: 1, author: nil,
        category_id: nil, category: nil, estimated_hours: nil,
        created_on: nil, updated_on: nil, spent_hours: 0.0
      )

      allow(extractor).to receive(:build_task_custom_field_values).and_return({})
      allow(current_user).to receive(:allowed_to?).with(:edit_issues, project).and_return(false)
      allow(current_user).to receive(:allowed_to?).with(:log_time, project).and_return(false)
      expect(issue).not_to receive(:editable?)

      expect(builder.build_tasks([issue]).first[:editable]).to be(false)
    end
  end

  describe '#build_relations' do
    it 'returns only relations where both endpoints are visible' do
      builder = described_class.new(
        custom_field_extractor: instance_double(RedmineCanvasGantt::CustomFieldExtractor),
        current_user: instance_double(User)
      )

      visible_relation = instance_double(IssueRelation, issue_from_id: 1, issue_to_id: 2, id: 10, relation_type: 'precedes', delay: 0)
      hidden_relation = instance_double(IssueRelation, issue_from_id: 1, issue_to_id: 99, id: 11, relation_type: 'precedes', delay: 1)
      issue_a = instance_double(Issue, id: 1, relations: [visible_relation, hidden_relation])
      issue_b = instance_double(Issue, id: 2, relations: [visible_relation])

      expect(builder.build_relations([issue_a, issue_b])).to eq([
        { id: 10, from: 1, to: 2, type: 'precedes', delay: 0 }
      ])
    end

    it 'serializes an explicitly bounded relation collection without touching issue associations' do
      builder = described_class.new(
        custom_field_extractor: instance_double(RedmineCanvasGantt::CustomFieldExtractor),
        current_user: instance_double(User)
      )
      relation = instance_double(
        IssueRelation,
        issue_from_id: 1,
        issue_to_id: 2,
        id: 10,
        relation_type: 'precedes',
        delay: 0
      )

      expect(builder.build_relations_from([relation])).to eq([
        { id: 10, from: 1, to: 2, type: 'precedes', delay: 0 }
      ])
    end
  end

  describe '#build_tasks' do
    it 'keeps can_log_time permission work constant for 100 and 500 issues in one project' do
      current_user = instance_double(User)
      extractor = instance_double(RedmineCanvasGantt::CustomFieldExtractor, build_task_custom_field_values: {})
      builder = described_class.new(
        custom_field_extractor: extractor,
        current_user: current_user
      )

      project1 = instance_double(Project, id: 1, name: 'Project 1')
      project2 = instance_double(Project, id: 2, name: 'Project 2')

      allow(current_user).to receive(:allowed_to?).with(:log_time, project1).and_return(true)
      allow(current_user).to receive(:allowed_to?).with(:log_time, project2).and_return(false)
      allow(current_user).to receive(:allowed_to?).with(:edit_issues, any_args).and_return(true)

      now = Time.now
      issue1 = instance_double(
        Issue,
        id: 101,
        subject: 'Task 1',
        start_date: nil,
        due_date: nil,
        done_ratio: 0,
        status_id: 1,
        status: instance_double(IssueStatus, name: 'New', is_closed: false),
        lock_version: 1,
        project: project1,
        project_id: 1,
        tracker_id: 1,
        tracker: instance_double(Tracker, name: 'Bug'),
        priority_id: 1,
        priority: instance_double(IssuePriority, name: 'Normal', position: 1),
        assigned_to_id: nil,
        assigned_to: nil,
        author_id: 1,
        author: instance_double(User, name: 'Admin'),
        fixed_version_id: nil,
        fixed_version: nil,
        category_id: nil,
        category: nil,
        estimated_hours: nil,
        spent_hours: 0.0,
        created_on: now,
        updated_on: now,
        parent_id: nil,
        custom_field_values: [],
        rgt: 2,
        lft: 1,
        editable?: true
      )

      issue2 = instance_double(
        Issue,
        id: 102,
        subject: 'Task 2',
        start_date: nil,
        due_date: nil,
        done_ratio: 0,
        status_id: 1,
        status: instance_double(IssueStatus, name: 'New', is_closed: false),
        lock_version: 1,
        project: project2,
        project_id: 2,
        tracker_id: 1,
        tracker: instance_double(Tracker, name: 'Bug'),
        priority_id: 1,
        priority: instance_double(IssuePriority, name: 'Normal', position: 1),
        assigned_to_id: nil,
        assigned_to: nil,
        author_id: 1,
        author: instance_double(User, name: 'Admin'),
        fixed_version_id: nil,
        fixed_version: nil,
        category_id: nil,
        category: nil,
        estimated_hours: nil,
        spent_hours: 0.0,
        created_on: now,
        updated_on: now,
        parent_id: nil,
        custom_field_values: [],
        rgt: 4,
        lft: 3,
        editable?: true
      )

      tasks_100 = builder.build_tasks(Array.new(100, issue1))
      tasks_500 = builder.build_tasks(Array.new(500, issue1))

      expect(tasks_100.first[:can_log_time]).to eq(true)
      expect(tasks_500.last[:can_log_time]).to eq(true)
      expect(current_user).to have_received(:allowed_to?).with(:log_time, project1).twice
    end
  end
  describe '#build_versions' do
    let(:custom_field_extractor) do
      instance_double(RedmineCanvasGantt::CustomFieldExtractor, build_project_custom_fields: [])
    end
    let(:version) do
      instance_double(
        Version,
        id: 9,
        name: 'Sprint 1',
        effective_date: Date.new(2026, 6, 30),
        project_id: 3,
        status: 'open'
      )
    end

    before do
      allow(Version).to receive_message_chain(:visible, :where, :to_a).and_return([version])
    end

    it 'serializes the preloaded progress instead of querying each Version' do
      preloader = double(
        'VersionProgressPreloader',
        call: {
          9 => RedmineCanvasGantt::VersionProgressPreloader::Progress.new(
            completed_percent: 42.5,
            start_date: Date.new(2026, 6, 1)
          )
        }
      )
      builder = described_class.new(
        custom_field_extractor: custom_field_extractor,
        current_user: instance_double(User),
        version_progress_preloader: preloader
      )

      expect(builder.build_versions([3])).to eq(
        [{
          id: 9,
          name: 'Sprint 1',
          effective_date: Date.new(2026, 6, 30),
          start_date: Date.new(2026, 6, 1),
          completed_percent: 42.5,
          project_id: 3,
          status: 'open'
        }]
      )
    end

    it 'falls back to Redmine when the preloader declines a Version' do
      allow(version).to receive(:completed_percent).and_return(17)
      allow(version).to receive(:start_date).and_return(Date.new(2026, 5, 4))
      preloader = double('VersionProgressPreloader', call: {})
      builder = described_class.new(
        custom_field_extractor: custom_field_extractor,
        current_user: instance_double(User),
        version_progress_preloader: preloader
      )

      entry = builder.build_versions([3]).first

      expect(entry[:completed_percent]).to eq(17)
      expect(entry[:start_date]).to eq(Date.new(2026, 5, 4))
    end
  end
end
