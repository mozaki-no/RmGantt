# frozen_string_literal: true

module RedmineCanvasGantt
  # Adds a "Canvas Gantt" tab to the project settings page, shown to users who
  # can edit the project while the Canvas Gantt module is enabled.
  module ProjectsHelperPatch
    def project_settings_tabs
      tabs = super
      if @project&.module_enabled?(:canvas_gantt) && User.current.allowed_to?(:edit_project, @project)
        tabs << {
          name: 'canvas_gantt',
          action: :edit_project,
          partial: 'canvas_gantt_settings/show',
          label: 'canvas_gantt.label_project_settings_tab'
        }
      end
      tabs
    end
  end
end
