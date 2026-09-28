module RedmineCanvasGantt
  # ActiveRecord's Preloader sets up each owner's association through a
  # generic pipeline that cost about 40 ms per belongs_to association at
  # 10,000 issues, whatever the size of the target table.  Status, tracker,
  # priority, users, project, category and version are small lookup tables, so
  # loading each one once by the distinct foreign keys and assigning the
  # targets directly gives the same loaded associations for a fraction of the
  # cost.  Anything that is not a plain, unscoped belongs_to keeps going
  # through Rails' preload.
  module LookupAssociationPreloader
    module_function

    # Returns [lookup_associations, other_associations].
    def partition(klass, associations)
      Array(associations).partition { |association| lookup?(klass, association) }
    end

    def lookup?(klass, association)
      return false unless association.is_a?(Symbol)

      reflection = klass.reflect_on_association(association)
      !reflection.nil? && reflection.belongs_to? && !reflection.polymorphic? && reflection.scope.nil?
    end

    def call(records, associations)
      return records if records.empty? || associations.empty?

      klass = records.first.class
      associations.each do |name|
        reflection = klass.reflect_on_association(name)
        foreign_key = reflection.foreign_key.to_s
        primary_key = reflection.association_primary_key.to_s
        ids = records.filter_map { |record| record[foreign_key] }.uniq
        targets = if ids.empty?
                    {}
                  else
                    reflection.klass.where(primary_key => ids).index_by { |target| target[primary_key] }
                  end

        records.each { |record| record.association(name).target = targets[record[foreign_key]] }
      end
      records
    end
  end
end
