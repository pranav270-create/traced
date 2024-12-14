// frontend/src/components/internal/eval/SummaryTab.tsx

import React, { useState, useEffect } from 'react';
import ExperimentDropdown from './ExperimentDropdown';
import { SummaryTable } from './table/SummaryTable';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

import { apiService } from '@/api/axios';
import { Experiment } from '@/types/eval';

interface SummaryTabProps {
  experiments: Experiment[];
}

export const SummaryTab: React.FC<SummaryTabProps> = ({ experiments }) => {
  const [experimentX, setExperimentX] = useState<Experiment | null>(null);
  const [experimentY, setExperimentY] = useState<Experiment | null>(null);
  const [groupingColumn, setGroupingColumn] = useState<string>('');
  const [groupingOptions, setGroupingOptions] = useState<string[]>([]);

  // Fetch grouping options based on selected experiments
  useEffect(() => {
    const fetchGroupingOptions = async () => {
      // Fetch available columns from the backend
      // Assuming both experiments have the same available fields
      const experimentId = experimentX?.id || experimentY?.id;
      if (experimentId) {
        const options = await getAvailableFields(experimentId);
        setGroupingOptions(options);
        if (options.length > 0 && !groupingColumn) {
          setGroupingColumn(options[0]);
        }
      }
    };
    fetchGroupingOptions();
  }, [experimentX, experimentY]);

  const getAvailableFields = async (experimentId: string): Promise<string[]> => {
    // Call an API endpoint that returns the available fields
    try {
      const fields = await apiService.get<string[]>(`/experiments/${experimentId}/available-fields`);
      return fields;
    } catch (error) {
      console.error('Error fetching available fields:', error);
      return [];
    }
  };

  return (
    <div>
      <div className="flex gap-4 mb-4">
        <ExperimentDropdown
          experiments={experiments}
          selectedExperiment={experimentX}
          setSelectedExperiment={setExperimentX}
        />
        <ExperimentDropdown
          experiments={experiments}
          selectedExperiment={experimentY}
          setSelectedExperiment={setExperimentY}
        />
        <div>
          <Select
            value={groupingColumn}
            onValueChange={(value) => setGroupingColumn(value)}
          >
            <SelectTrigger className="w-[200px] bg-white">
              <SelectValue placeholder="Group by column" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {groupingOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <SummaryTable
        experimentX={experimentX}
        experimentY={experimentY}
        groupingColumn={groupingColumn}
      />
    </div>
  );
};
