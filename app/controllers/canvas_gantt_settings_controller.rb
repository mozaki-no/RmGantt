# frozen_string_literal: true

class CanvasGanttSettingsController < ApplicationController
  before_action :find_project_by_project_id
  before_action :authorize_project_settings

  # PUT /projects/:project_id/canvas_gantt/settings
  def update
    features = params.fetch(:canvas_gantt_features, {}).permit(*RedmineCanvasGantt::ProjectFeatureSettings::FEATURES)
    RedmineCanvasGantt::ProjectFeatureSettings.new.save(project_id: @project.id, features: features.to_h)
    flash[:notice] = l(:notice_successful_update)
    redirect_to settings_project_path(@project, tab: 'canvas_gantt')
  end

  private

  def authorize_project_settings
    return true if @project.module_enabled?(:canvas_gantt) && User.current.allowed_to?(:edit_project, @project)

    deny_access
    false
  end
end
