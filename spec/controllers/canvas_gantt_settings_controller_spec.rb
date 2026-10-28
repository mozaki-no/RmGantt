require_relative '../spec_helper'

RSpec.describe CanvasGanttSettingsController, type: :controller do
  fixtures :projects, :users, :email_addresses, :members, :member_roles, :roles, :enabled_modules

  let(:project) { Project.find(1) }
  let(:feature_settings) { instance_double(RedmineCanvasGantt::ProjectFeatureSettings, save: {}) }

  before do
    project.enable_module!(:canvas_gantt)
    allow(RedmineCanvasGantt::ProjectFeatureSettings).to receive(:new).and_return(feature_settings)
  end

  after do
    User.current = nil
  end

  it 'saves the feature switches for a user who can edit the project' do
    User.current = User.find(1)
    session[:user_id] = 1
    session[:tk] = User.find(1).generate_session_token

    put :update, params: { project_id: project.identifier, canvas_gantt_features: { time_tracking: '0', versions: '1' } }

    expect(feature_settings).to have_received(:save).with(project_id: project.id, features: { 'time_tracking' => '0', 'versions' => '1' })
    expect(response).to redirect_to(settings_project_path(project, tab: 'canvas_gantt'))
  end

  it 'denies a user without the edit project permission' do
    Role.find(2).remove_permission!(:edit_project)
    User.current = User.find(3)
    session[:user_id] = 3
    session[:tk] = User.find(3).generate_session_token

    put :update, params: { project_id: project.identifier, canvas_gantt_features: { time_tracking: '0' } }

    expect(feature_settings).not_to have_received(:save)
    expect(response).to have_http_status(:forbidden)
  end
end
