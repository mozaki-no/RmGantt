require_relative '../../spec_helper'
require_relative '../../../lib/redmine_canvas_gantt/lookup_association_preloader'

# LookupAssociationPreloader replaces Rails' Preloader for plain belongs_to
# lookups on the data request. These examples check it leaves every issue with
# the same loaded association targets Rails would, and without per-issue
# queries.
RSpec.describe RedmineCanvasGantt::LookupAssociationPreloader do
  fixtures :projects, :users, :roles, :members, :member_roles, :trackers,
           :projects_trackers, :issue_statuses, :enumerations, :issues,
           :issue_categories, :versions

  let(:lookups) { %i[status tracker assigned_to priority author category project fixed_version] }

  def target_ids(issues, association)
    issues.to_h { |issue| [issue.id, issue.association(association).target&.id] }
  end

  it 'loads the same targets as Rails preload and marks them loaded' do
    Issue.where(id: [1, 2]).update_all(category_id: nil, fixed_version_id: nil, assigned_to_id: nil)
    reference = Issue.order(:id).preload(*lookups).to_a
    issues = Issue.order(:id).to_a

    described_class.call(issues, lookups)

    lookups.each do |association|
      expect(issues.map { |issue| issue.association(association).loaded? }.uniq).to eq([true])
      expect(target_ids(issues, association)).to eq(target_ids(reference, association))
      expect(issues.map { |issue| issue.public_send(association)&.class })
        .to eq(reference.map { |issue| issue.public_send(association)&.class })
    end
  end

  it 'issues one query per association, not per issue' do
    issues = Issue.order(:id).to_a
    queries = 0
    counter = ->(*, payload) { queries += 1 unless payload[:cached] || payload[:name] == 'SCHEMA' }

    ActiveSupport::Notifications.subscribed(counter, 'sql.active_record') do
      described_class.call(issues, lookups)
      issues.each { |issue| lookups.each { |association| issue.public_send(association) } }
    end

    expect(queries).to be <= lookups.size
  end

  it 'leaves a missing target as a loaded nil' do
    issue = Issue.find(1)
    issue.category_id = 999_999

    described_class.call([issue], [:category])

    expect(issue.association(:category)).to be_loaded
    expect(issue.category).to be_nil
  end

  it 'only takes plain belongs_to associations' do
    lookup, other = described_class.partition(Issue, [:status, :project, { custom_values: :custom_field }, :relations_to])

    expect(lookup).to eq(%i[status project])
    expect(other).to eq([{ custom_values: :custom_field }, :relations_to])
  end
end
