# frozen_string_literal: true

# Read-only Rails runner for profiling the major Canvas Gantt data-payload
# stages against an existing project. Run from the Redmine root, for example:
#
#   CANVAS_GANTT_PROFILE_PROJECT=my-project \
#   CANVAS_GANTT_PROFILE_USER=admin \
#   bundle exec rails runner \
#     plugins/redmine_canvas_gantt/tools/performance/profile_data_payload.rb

require 'benchmark'

project_identifier = ENV.fetch('CANVAS_GANTT_PROFILE_PROJECT')
user_login = ENV.fetch('CANVAS_GANTT_PROFILE_USER')

project = Project.find_by!(identifier: project_identifier)
user = User.find_by!(login: user_login)
User.current = user
project_ids = project.self_and_descendants.pluck(:id)
params = ActionController::Parameters.new({})
budget = RedmineCanvasGantt::DataPayloadBudget.new

def profile_sql(label)
  counts = Hash.new(0)
  names = Hash.new(0)
  subscriber = lambda do |_name, _start, _finish, _id, payload|
    next if payload[:cached] || payload[:name] == 'SCHEMA'

    sql = payload[:sql].to_s
    next if sql.match?(/\A(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i)

    normalized = sql
      .gsub(/'(?:[^']|'')*'/, '?')
      .gsub(/\b\d+\b/, '?')
      .gsub(/\s+/, ' ')
      .strip
    counts[normalized] += 1
    names[payload[:name].to_s] += 1
  end

  result = nil
  elapsed = Benchmark.realtime do
    ActiveSupport::Notifications.subscribed(subscriber, 'sql.active_record') do
      result = yield
    end
  end

  puts "SEGMENT #{label} seconds=#{elapsed.round(3)} queries=#{counts.values.sum}"
  counts.sort_by { |_sql, count| -count }.first(12).each do |sql, count|
    puts "  SQL count=#{count} #{sql[0, 500]}"
  end
  puts "  NAMES #{names.sort_by { |_name, count| -count }.first(12).to_h.inspect}"
  result
end

resolver = RedmineCanvasGantt::QueryStateResolver.new(
  project: project,
  params: params,
  current_user: user,
  issue_scope: Issue.visible,
  issue_includes: CanvasGanttsController::DATA_ISSUE_INCLUDES,
  data_payload_budget: budget
)

resolved = profile_sql('resolve_issues') do
  resolver.resolve(project_ids: project_ids)
end
issues = resolved.fetch(:issues)
puts "ISSUES count=#{issues.length}"

serializer = RedmineCanvasGantt::CustomFieldSerializer.new(current_user: user)
extractor = RedmineCanvasGantt::CustomFieldExtractor.new(
  serializer: serializer,
  supported_formats: CanvasGanttsController::CUSTOM_FIELD_FORMATS
)
builder = RedmineCanvasGantt::DataPayloadBuilder.new(
  custom_field_extractor: extractor,
  current_user: user,
  data_payload_budget: budget
)

profile_sql('build_tasks') { builder.build_tasks(issues) }
profile_sql('build_project_custom_fields') do
  extractor.build_project_custom_fields(project_ids, issues)
end
profile_sql('build_versions') { builder.build_versions(project_ids) }
profile_sql('build_project_payload') { builder.build_project_payload(project) }
profile_sql('load_relations') do
  issue_ids = issues.map(&:id)
  IssueRelation.where(issue_from_id: issue_ids, issue_to_id: issue_ids).order(:id).to_a
end
