require_relative '../spec_helper'

RSpec.describe CanvasGanttsController, type: :controller do
  fixtures :projects, :users, :roles, :members, :member_roles,
           :trackers, :issue_statuses, :workflows, :enumerations, :issues

  let(:current_user) { User.find(2) }
  let(:project) { Project.find(1) }

  before do
    User.current = current_user
    session[:user_id] = current_user.id
    project.enabled_module_names = (project.enabled_module_names + ['canvas_gantt']).uniq
    project.save!
    role = Member.find_by!(user_id: current_user.id, project_id: project.id).roles.first
    role.permissions = (role.permissions + %i[view_issues view_canvas_gantt]).uniq
    role.save!
    session[:tk] = current_user.generate_session_token
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

  # A version's progress weights every fixed issue, and a non-leaf issue's
  # estimate is a subtree SUM, so the payload has to stay query-constant in
  # both the issue count and the parent-issue count.
  it 'keeps the data endpoint query count constant at 1, 100, and 1000 issues across versions' do
    versions = Array.new(3) do |index|
      Version.create!(project: project, name: "Canvas data scale version #{index}")
    end
    template = Issue.find(1).attributes.except('id')

    # The endpoint serves the whole project tree, so the scale set has to
    # replace every issue the request can see.
    scoped_project_ids = project.self_and_descendants.pluck(:id)

    query_counts = [1, 100, 1000].map do |target_count|
      Issue.where(project_id: scoped_project_ids).delete_all
      Issue.insert_all!(scale_rows(template, versions, target_count))

      get :data, params: { project_id: project.identifier }, format: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)['tasks'].size).to eq(target_count)

      sql_query_count { get :data, params: { project_id: project.identifier }, format: :json }
    end

    expect(query_counts.uniq).to contain_exactly(query_counts.first)
  end

  # Even indexes are roots of a two-issue tree, odd indexes are their children,
  # so parent issues scale with the issue count.
  def scale_rows(template, versions, target_count)
    base_id = Issue.maximum(:id).to_i + 1

    Array.new(target_count) do |index|
      id = base_id + index
      child = index.odd?
      parent = index.even? && index + 1 < target_count

      template.merge(
        'id' => id,
        'subject' => "Canvas data scale #{target_count}-#{index}",
        'project_id' => project.id,
        'fixed_version_id' => versions[index % versions.size].id,
        'parent_id' => child ? id - 1 : nil,
        'root_id' => child ? id - 1 : id,
        'lft' => child ? 2 : 1,
        'rgt' => child ? 3 : (parent ? 4 : 2),
        'estimated_hours' => (index % 3).zero? ? nil : (index % 7) + 1.0,
        'done_ratio' => (index % 5) * 20,
        'created_on' => Time.current,
        'updated_on' => Time.current
      )
    end
  end
end
