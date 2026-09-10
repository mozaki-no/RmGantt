# frozen_string_literal: true

# Read-only Rails runner that compares the current Issue `includes` load with
# an explicit `preload` load against an existing project. Run from the Redmine
# root, for example:
#
#   CANVAS_GANTT_PROFILE_PROJECT=my-project \
#   CANVAS_GANTT_PROFILE_USER=admin \
#   CANVAS_GANTT_PROFILE_SAMPLES=5 \
#   bundle exec rails runner \
#     plugins/redmine_canvas_gantt/tools/performance/compare_issue_load_strategies.rb

require 'json'

project_identifier = ENV.fetch('CANVAS_GANTT_PROFILE_PROJECT')
user_login = ENV.fetch('CANVAS_GANTT_PROFILE_USER')
sample_count = Integer(ENV.fetch('CANVAS_GANTT_PROFILE_SAMPLES', '5'), 10)
raise ArgumentError, 'CANVAS_GANTT_PROFILE_SAMPLES must be positive' unless sample_count.positive?

project = Project.find_by!(identifier: project_identifier)
user = User.find_by!(login: user_login)
User.current = user
project_ids = project.self_and_descendants.pluck(:id)
params = ActionController::Parameters.new({})

module ExplicitIssuePreload
  def includes(*associations)
    preload(*associations)
  end
end

def percentile(values, fraction)
  sorted = values.sort
  sorted[((sorted.length - 1) * fraction).round]
end

def profile_issue_resolution(strategy:, project:, project_ids:, params:, user:)
  sql_events = []
  subscriber = lambda do |_name, _start, _finish, _id, payload|
    next if payload[:cached] || payload[:name] == 'SCHEMA'

    sql = payload[:sql].to_s
    next if sql.match?(/\A(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i)

    sql_events << {
      name: payload[:name].to_s,
      sql: sql.gsub(/\s+/, ' ').strip
    }
  end

  issue_scope = Issue.visible
  issue_scope = issue_scope.extending(ExplicitIssuePreload) if strategy == :preload
  resolver = RedmineCanvasGantt::QueryStateResolver.new(
    project: project,
    params: params,
    current_user: user,
    issue_scope: issue_scope,
    issue_includes: CanvasGanttsController::DATA_ISSUE_INCLUDES,
    data_payload_budget: RedmineCanvasGantt::DataPayloadBudget.new
  )

  GC.start
  ActiveRecord::Base.connection.clear_query_cache
  allocated_before = GC.stat.fetch(:total_allocated_objects)
  result = nil
  started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  ActiveRecord::Base.uncached do
    ActiveSupport::Notifications.subscribed(subscriber, 'sql.active_record') do
      result = resolver.resolve(project_ids: project_ids)
    end
  end
  elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at
  allocated_after = GC.stat.fetch(:total_allocated_objects)
  issues = result.fetch(:issues)

  issue_load_sql = sql_events.filter_map do |event|
    sql = event.fetch(:sql)
    next unless sql.start_with?('SELECT') && sql.include?('"issues"')

    sql
  end

  {
    strategy: strategy,
    seconds: elapsed.round(3),
    queries: sql_events.length,
    issue_count: issues.length,
    unique_issue_count: issues.map(&:id).uniq.length,
    allocated_objects: allocated_after - allocated_before,
    issue_selects: issue_load_sql.length,
    left_outer_join_issue_selects: issue_load_sql.count { |sql| sql.include?('LEFT OUTER JOIN') },
    query_names: sql_events.map { |event| event.fetch(:name) }.tally.sort.to_h,
    issue_sql: issue_load_sql.map { |sql| sql[0, 500] }
  }
end

puts({
  event: 'configuration',
  project: project_identifier,
  project_ids: project_ids.length,
  samples: sample_count,
  ruby: RUBY_VERSION,
  rails: Rails.version,
  redmine: Redmine::VERSION.to_s
}.to_json)

# Warm both paths before collecting samples so Rails initialization and the
# database's cold cache do not favor whichever strategy happens to run first.
%i[includes preload].each do |strategy|
  warmup = profile_issue_resolution(
    strategy: strategy,
    project: project,
    project_ids: project_ids,
    params: params,
    user: user
  )
  puts warmup.merge(event: 'warmup').to_json
end

results = []
sample_count.times do |index|
  order = index.even? ? %i[includes preload] : %i[preload includes]
  order.each do |strategy|
    result = profile_issue_resolution(
      strategy: strategy,
      project: project,
      project_ids: project_ids,
      params: params,
      user: user
    ).merge(event: 'sample', sample: index + 1)
    results << result
    puts result.to_json
  end
end

summaries = %i[includes preload].map do |strategy|
  strategy_results = results.select { |result| result.fetch(:strategy) == strategy }
  seconds = strategy_results.map { |result| result.fetch(:seconds) }
  allocations = strategy_results.map { |result| result.fetch(:allocated_objects) }
  {
    strategy: strategy,
    samples: strategy_results.length,
    seconds_median: percentile(seconds, 0.5),
    seconds_min: seconds.min,
    seconds_max: seconds.max,
    queries: strategy_results.map { |result| result.fetch(:queries) }.uniq,
    allocated_objects_median: percentile(allocations, 0.5),
    issue_counts: strategy_results.map { |result| result.fetch(:issue_count) }.uniq,
    unique_issue_counts: strategy_results.map { |result| result.fetch(:unique_issue_count) }.uniq,
    issue_selects: strategy_results.map { |result| result.fetch(:issue_selects) }.uniq,
    left_outer_join_issue_selects: strategy_results.map do |result|
      result.fetch(:left_outer_join_issue_selects)
    end.uniq
  }
end

puts({ event: 'summary', results: summaries }.to_json)
