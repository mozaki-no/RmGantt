require 'set'

module RedmineCanvasGantt
  # Version#completed_percent and Version#start_date are lazy, per-version
  # calculations.  Redmine's FixedIssuesExtension loads the version's fixed
  # issues and then asks every one of them for Issue#total_estimated_hours,
  # which runs a visible subtree SUM for each non-leaf issue.  Serialising the
  # Canvas Gantt version list therefore costs O(parent issues) queries: 50
  # versions across 10,000 issues measured 4,252 uncached queries and 17.65
  # seconds, of which 4,000 queries were those subtree sums.
  #
  # This preloader answers the same two questions for every version at once, in
  # a fixed number of queries, and reproduces the FixedIssuesExtension
  # arithmetic instead of deriving progress from the Gantt's filtered task
  # array: a version may be shared across projects and may hold issues the
  # current toolbar filters out, so only the version's own fixed issues may
  # feed the calculation.
  module VersionProgressPreloader
    Progress = Struct.new(:completed_percent, :start_date, keyword_init: true)

    module_function

    # Returns Hash{version_id => Progress}.  An empty Hash means the caller
    # should fall back to Redmine's own per-version accessors, so a Redmine
    # release that changes these internals stays correct (just slower) rather
    # than reporting wrong progress.
    def call(versions, current_user = nil)
      version_ids = version_ids_for(versions)
      return {} if version_ids.empty?

      closed_ids = closed_status_ids
      subtree_hours = subtree_estimated_hours(version_ids, current_user)
      rows_by_version = issue_rows(version_ids)

      version_ids.each_with_object({}) do |version_id, result|
        result[version_id] = progress_for(rows_by_version[version_id], subtree_hours, closed_ids)
      end
    rescue StandardError => e
      warn_skipped(e)
      {}
    end

    def version_ids_for(versions)
      Array(versions).filter_map { |version| version.id if version.respond_to?(:id) }.uniq
    end

    def closed_status_ids
      IssueStatus.where(is_closed: true).pluck(:id).to_set
    end

    # One row per fixed issue of the requested versions.  Redmine counts and
    # weights every fixed issue regardless of visibility, so this scope is
    # deliberately not filtered by Issue.visible; only the subtree estimate
    # below is.  `rgt - lft` reproduces Issue#leaf? without loading records.
    def issue_rows(version_ids)
      issues = Issue.table_name
      rows = Hash.new { |hash, key| hash[key] = [] }

      Issue.where(fixed_version_id: version_ids).pluck(
        :fixed_version_id,
        :id,
        :status_id,
        :done_ratio,
        :estimated_hours,
        :start_date,
        Arel.sql("#{issues}.rgt - #{issues}.lft")
      ).each { |row| rows[row.first] << row }

      rows
    end

    # Issue#total_estimated_hours sums estimated_hours over the visible
    # self-and-descendants of every non-leaf issue.  The nested set makes that
    # a single grouped range join for all parents at once.
    def subtree_estimated_hours(version_ids, current_user)
      issues = Issue.table_name
      scope = current_user ? Issue.visible(current_user) : Issue.visible

      scope
        .joins(
          "INNER JOIN #{issues} parents ON parents.root_id = #{issues}.root_id" \
          " AND #{issues}.lft >= parents.lft AND #{issues}.rgt <= parents.rgt"
        )
        .where(['parents.fixed_version_id IN (?)', version_ids])
        .where('parents.rgt - parents.lft > 1')
        .group('parents.id')
        .sum("#{issues}.estimated_hours")
    end

    def progress_for(rows, subtree_hours, closed_ids)
      rows ||= []
      open_count = 0
      closed_count = 0
      start_date = nil
      entries = []

      rows.each do |(_version_id, issue_id, status_id, done_ratio, estimated_hours, issue_start_date, span)|
        closed = closed_ids.include?(status_id)
        closed ? closed_count += 1 : open_count += 1

        leaf = span.to_i == 1
        estimated = (leaf ? estimated_hours : subtree_hours[issue_id]).to_f
        entries << [estimated, done_ratio.to_i, closed]

        if issue_start_date && (start_date.nil? || issue_start_date < start_date)
          start_date = issue_start_date
        end
      end

      Progress.new(
        completed_percent: completed_percent(entries, open_count, closed_count),
        start_date: start_date
      )
    end

    def completed_percent(entries, open_count, closed_count)
      issues_count = open_count + closed_count
      return 0 if issues_count.zero?
      return 100 if open_count.zero?

      average = estimated_average(entries)
      issues_progress(entries, average, issues_count, false) +
        issues_progress(entries, average, issues_count, true)
    end

    # The average estimate of the issues that have one, used to weight the
    # issues that do not.  Matches FixedIssuesExtension#estimated_average.
    def estimated_average(entries)
      estimated = entries.map(&:first).select { |hours| hours > 0.0 }
      return 1.0 if estimated.empty?

      estimated.sum.to_f / estimated.size
    end

    # Closed issues count as 100% done, open issues as their done_ratio, both
    # weighted by the issue's estimate.  Matches
    # FixedIssuesExtension#issues_progress.
    def issues_progress(entries, average, issues_count, open)
      done = entries.sum do |(estimated, done_ratio, closed)|
        next 0 if closed == open

        weight = estimated > 0.0 ? estimated : average
        weight * (open ? done_ratio : 100)
      end

      done / (average * issues_count)
    end

    def warn_skipped(error)
      return unless defined?(Rails) && Rails.respond_to?(:logger) && Rails.logger

      Rails.logger.warn("[Canvas Gantt] version progress preload skipped: #{error.class}: #{error.message}")
    end
  end
end
