require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/version_progress_preloader'

RSpec.describe RedmineCanvasGantt::VersionProgressPreloader, type: :model do
  fixtures :projects, :users, :roles, :members, :member_roles,
           :trackers, :issue_statuses, :workflows, :enumerations, :issues

  let(:current_user) { User.find(2) }
  let(:project) { Project.find(1) }
  let(:tracker) { project.trackers.first }
  let(:priority) { IssuePriority.first }
  let(:open_status) { IssueStatus.where(is_closed: false).first }
  let(:closed_status) { IssueStatus.where(is_closed: true).first }

  before do
    User.current = current_user
  end

  def sql_query_count
    count = 0
    subscriber = lambda do |_name, _start, _finish, _id, payload|
      next if payload[:cached] || payload[:name] == 'SCHEMA'
      next if payload[:sql].to_s.match?(/\A(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i)

      count += 1
    end
    ActiveSupport::Notifications.subscribed(subscriber, 'sql.active_record') { yield }
    count
  end

  def create_version(name, owner: project, sharing: 'none')
    Version.create!(project: owner, name: name, sharing: sharing)
  end

  def create_issue(version, attributes = {})
    Issue.create!({
      project: attributes.delete(:project) || project,
      tracker: tracker,
      status: open_status,
      priority: priority,
      author: current_user,
      subject: "Canvas version progress #{attributes.object_id}",
      fixed_version: version
    }.merge(attributes))
  end

  # Redmine memoizes progress on the Version instance, so parity has to be
  # asserted against a freshly loaded record.
  def redmine_progress(version)
    reloaded = Version.find(version.id)
    [reloaded.completed_percent, reloaded.start_date]
  end

  def preloaded_progress(version)
    entry = described_class.call([version], current_user).fetch(version.id)
    [entry.completed_percent, entry.start_date]
  end

  def expect_parity(version)
    expected_percent, expected_start_date = redmine_progress(version)
    actual_percent, actual_start_date = preloaded_progress(version)

    expect(actual_percent).to be_within(1e-6).of(expected_percent)
    expect(actual_start_date).to eq(expected_start_date)
  end

  it 'matches Redmine for a version with no issues' do
    version = create_version('Canvas empty version')

    expect(preloaded_progress(version)).to eq([0, nil])
    expect_parity(version)
  end

  it 'matches Redmine when every issue is closed' do
    version = create_version('Canvas closed version')
    create_issue(version, subject: 'closed a', status: closed_status, estimated_hours: 4.0,
                          start_date: Date.new(2026, 1, 5))
    create_issue(version, subject: 'closed b', status: closed_status, start_date: Date.new(2026, 1, 3))

    expect(preloaded_progress(version).first).to eq(100)
    expect_parity(version)
  end

  it 'matches Redmine when estimated and unestimated issues are mixed' do
    version = create_version('Canvas mixed version')
    create_issue(version, subject: 'estimated open', estimated_hours: 10.0, done_ratio: 40,
                          start_date: Date.new(2026, 2, 10))
    create_issue(version, subject: 'unestimated open', done_ratio: 70, start_date: Date.new(2026, 2, 4))
    create_issue(version, subject: 'estimated closed', estimated_hours: 30.0, status: closed_status,
                          start_date: Date.new(2026, 2, 20))

    expect(preloaded_progress(version).first).to be_between(0, 100)
    expect_parity(version)
  end

  it 'matches Redmine when the version holds parent issues whose estimate comes from the subtree' do
    version = create_version('Canvas nested version')
    parent = create_issue(version, subject: 'parent', start_date: Date.new(2026, 3, 2))
    create_issue(version, subject: 'child estimated', parent_issue_id: parent.id, estimated_hours: 12.0,
                          done_ratio: 50, start_date: Date.new(2026, 3, 4))
    create_issue(version, subject: 'child closed', parent_issue_id: parent.id, estimated_hours: 8.0,
                          status: closed_status, start_date: Date.new(2026, 3, 6))
    create_issue(version, subject: 'standalone', estimated_hours: 5.0, done_ratio: 10,
                          start_date: Date.new(2026, 3, 1))

    expect(Issue.find(parent.id).total_estimated_hours.to_f).to be > 0.0
    expect_parity(version)
  end

  it 'matches Redmine when a subtree issue is invisible to the current user' do
    # A private subproject of the same tree: cross-project subtasks stay legal
    # while the child issue is invisible to the current user.
    hidden_project = Project.create!(
      name: 'Canvas hidden project',
      identifier: 'canvas-hidden-project',
      is_public: false,
      parent: project
    )
    hidden_project.trackers = [tracker]
    hidden_project.save!

    version = create_version('Canvas visibility version', sharing: 'system')
    parent = create_issue(version, subject: 'visible parent', start_date: Date.new(2026, 4, 1))
    create_issue(version, subject: 'visible child', parent_issue_id: parent.id, estimated_hours: 6.0,
                          done_ratio: 25, start_date: Date.new(2026, 4, 2))
    hidden_child = create_issue(
      version,
      subject: 'hidden child',
      project: hidden_project,
      parent_issue_id: parent.id,
      estimated_hours: 100.0,
      start_date: Date.new(2026, 4, 3)
    )

    expect(Issue.visible(current_user).where(id: hidden_child.id)).to be_empty
    expect_parity(version)
  end

  it 'matches Redmine for a version shared across projects' do
    other_project = Project.find(5)
    other_project.trackers = [tracker]
    other_project.save!

    version = create_version('Canvas shared version', sharing: 'system')
    create_issue(version, subject: 'home project issue', estimated_hours: 3.0, done_ratio: 30,
                          start_date: Date.new(2026, 5, 9))
    create_issue(version, subject: 'other project issue', project: other_project, estimated_hours: 9.0,
                          done_ratio: 60, start_date: Date.new(2026, 5, 2))

    expect_parity(version)
  end

  it 'calculates several versions in one pass' do
    first = create_version('Canvas batch one')
    second = create_version('Canvas batch two')
    create_issue(first, subject: 'batch one issue', estimated_hours: 2.0, done_ratio: 50)
    create_issue(second, subject: 'batch two issue', estimated_hours: 4.0, status: closed_status)

    result = described_class.call([first, second], current_user)

    expect(result.keys).to contain_exactly(first.id, second.id)
    expect(result[first.id].completed_percent).to be_within(1e-6).of(Version.find(first.id).completed_percent)
    expect(result[second.id].completed_percent).to eq(100)
  end

  it 'keeps the query count constant at 1, 100, and 1000 issues' do
    version = create_version('Canvas scale version')
    template = Issue.find(1).attributes.except('id')

    query_counts = [1, 100, 1000].map do |target_count|
      Issue.where(fixed_version_id: version.id).delete_all
      Issue.insert_all!(build_scale_rows(template, version, target_count))

      expect(Issue.where(fixed_version_id: version.id).count).to eq(target_count)
      described_class.call([version], current_user)
      sql_query_count { described_class.call([version], current_user) }
    end

    expect(query_counts.uniq).to contain_exactly(query_counts.first)
    expect(query_counts.first).to be <= 10
  end

  # Half of the generated issues are parents of the other half, so the
  # measurement also proves that the subtree estimate does not add a query per
  # parent issue.
  def build_scale_rows(template, version, target_count)
    base_id = Issue.maximum(:id).to_i + 1
    rows = []

    target_count.times do |index|
      id = base_id + index
      parent = index.even? && index + 1 < target_count
      child = index.odd?
      root_id = child ? id - 1 : id

      rows << template.merge(
        'id' => id,
        'subject' => "Canvas version scale #{target_count}-#{index}",
        'project_id' => project.id,
        'fixed_version_id' => version.id,
        'parent_id' => child ? id - 1 : nil,
        'root_id' => root_id,
        'lft' => child ? 2 : 1,
        'rgt' => child ? 3 : (parent ? 4 : 2),
        'estimated_hours' => (index % 3).zero? ? nil : (index % 7) + 1.0,
        'done_ratio' => (index % 5) * 20,
        'created_on' => Time.current,
        'updated_on' => Time.current
      )
    end

    rows
  end
end
