require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/data_payload_budget'
require_relative '../../../lib/redmine_canvas_gantt/data_payload_builder'
require_relative '../../../lib/redmine_canvas_gantt/custom_field_serializer'
require_relative '../../../lib/redmine_canvas_gantt/custom_field_extractor'

# The mirror image of the production change, so one spec can run both loading
# strategies against the same records without editing production code. Defined
# at the top level because a method body in an example group resolves constants
# lexically from here, not from the group.
module CanvasGanttForcedIncludesLoad
  def preload(*associations)
    includes(*associations)
  end
end

# GitHub issue #9 replaced `includes` with `preload` in
# QueryStateResolver#issues_scope_for. `includes` leaves Rails free to answer
# with either separate preload queries or one joined eager load, and on the
# bounded scope it chose the join. Swapping the strategy is only safe if the
# payload cannot tell the two apart, so these examples load the same real
# issues both ways and compare exactly what serialization reads.
RSpec.describe RedmineCanvasGantt::QueryStateResolver, type: :model do
  fixtures :projects, :users, :roles, :members, :member_roles,
           :trackers, :issue_statuses, :workflows, :enumerations, :issues

  let(:current_user) { User.find(2) }
  let(:project) { Project.find(1) }
  let(:project_ids) { project.self_and_descendants.pluck(:id) }

  before do
    User.current = current_user
    role = Member.find_by!(user_id: current_user.id, project_id: project.id).roles.first
    role.permissions = (role.permissions + %i[view_issues]).uniq
    role.save!

    # The fixtures leave version, category and custom field empty on most
    # issues, and a column that is nil under both strategies would compare
    # equal without proving anything. Fill them in so every association in
    # DATA_ISSUE_INCLUDES actually carries a value.
    version = Version.create!(project: project, name: 'Canvas load strategy version')
    category = IssueCategory.create!(project: project, name: 'Canvas load strategy category')
    custom_field = IssueCustomField.create!(
      name: 'Canvas load strategy field',
      field_format: 'string',
      is_for_all: true,
      trackers: Tracker.all
    )

    project.issues.each_with_index do |issue, index|
      issue.update_columns(fixed_version_id: version.id, category_id: category.id)
      CustomValue.create!(customized: issue, custom_field: custom_field, value: "canvas-#{index}")
    end
  end

  after { User.current = nil }

  def resolve_issues(strategy)
    scope = Issue.visible
    scope = scope.extending(CanvasGanttForcedIncludesLoad) if strategy == :includes

    described_class.new(
      project: project,
      params: ActionController::Parameters.new({}),
      current_user: current_user,
      issue_scope: scope,
      issue_includes: CanvasGanttsController::DATA_ISSUE_INCLUDES,
      data_payload_budget: RedmineCanvasGantt::DataPayloadBudget.new
    ).resolve(project_ids: project_ids).fetch(:issues)
  end

  def payload_builder
    RedmineCanvasGantt::DataPayloadBuilder.new(
      custom_field_extractor: RedmineCanvasGantt::CustomFieldExtractor.new(
        serializer: RedmineCanvasGantt::CustomFieldSerializer.new(current_user: current_user),
        supported_formats: CanvasGanttsController::CUSTOM_FIELD_FORMATS
      ),
      current_user: current_user
    )
  end

  # Sorting is a Ruby sort_by! on start_date and is not stable, so two issues
  # sharing a date may land in either order. Parity is about the content of
  # each task, not about which of two equal keys won, so compare keyed by id.
  def task_states_by_id(issues)
    builder = payload_builder
    issues.each_with_object({}) do |issue, states|
      states[issue.id] = builder.build_task_state(issue)
    end
  end

  def instrument_sql
    statements = []
    subscriber = lambda do |_name, _start, _finish, _id, payload|
      next if payload[:cached] || payload[:name] == 'SCHEMA'
      next if payload[:sql].to_s.match?(/\A(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i)

      statements << payload[:sql].to_s.gsub(/\s+/, ' ')
    end
    ActiveSupport::Notifications.subscribed(subscriber, 'sql.active_record') { yield }
    statements
  end

  # Only the issue load itself, not every statement that happens to mention the
  # table: the spent-time preload also joins issues, and identifier quoting
  # differs between the MySQL and PostgreSQL adapters.
  def issue_load_sql?(sql)
    sql.start_with?('SELECT') && sql.match?(/FROM\s+[`"]?issues[`"]?/)
  end

  it 'returns the same issues under either loading strategy' do
    preloaded = resolve_issues(:preload)
    included = resolve_issues(:includes)

    expect(preloaded).not_to be_empty
    expect(preloaded.map(&:id).sort).to eq(included.map(&:id).sort)
    expect(preloaded.map(&:id).uniq.size).to eq(preloaded.size)
  end

  it 'serializes every task identically under either loading strategy' do
    preloaded = task_states_by_id(resolve_issues(:preload))
    included = task_states_by_id(resolve_issues(:includes))

    expect(preloaded).not_to be_empty
    expect(preloaded).to eq(included)
  end

  it 'loads the serialization associations up front, so reading them costs no queries' do
    issues = resolve_issues(:preload)
    expect(issues).not_to be_empty

    statements = instrument_sql do
      issues.each do |issue|
        issue.project.name
        issue.status.name
        issue.tracker&.name
        issue.priority&.position
        issue.author&.name
        issue.assigned_to&.name
        issue.category&.name
        issue.fixed_version&.name
        issue.custom_values.each { |custom_value| custom_value.custom_field&.name }
      end
    end

    expect(statements).to be_empty
  end

  # Without this the parity examples above could be comparing two runs of the
  # same strategy and would still pass, including after a revert.
  it 'issues a narrow issue query where the previous strategy joined every association' do
    preload_sql = instrument_sql { resolve_issues(:preload) }
    includes_sql = instrument_sql { resolve_issues(:includes) }

    preload_issue_selects = preload_sql.select { |sql| issue_load_sql?(sql) }
    includes_issue_selects = includes_sql.select { |sql| issue_load_sql?(sql) }

    expect(preload_issue_selects).not_to be_empty
    expect(preload_issue_selects).not_to include(a_string_including('LEFT OUTER JOIN'))
    expect(includes_issue_selects).to include(a_string_including('LEFT OUTER JOIN'))
    expect(preload_sql.size).to be > includes_sql.size
  end
end
