import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ProjectDropdownProps } from '@/types/eval';

export const ProjectDropdown: React.FC<ProjectDropdownProps> = ({
  projects,
  selectedProject,
  setSelectedProject,
}) => {
  return (
    <Select
      value={selectedProject?.id || ''}
      onValueChange={(value) => {
        const project = projects.find(p => p.id === value);
        setSelectedProject(project || null);
      }}
    >
      <SelectTrigger className="w-[200px] h-7">
        <SelectValue placeholder="Select Project" />
      </SelectTrigger>
      <SelectContent className="bg-white">
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id}>
            <div className="flex justify-between items-center">
              <span className="text-blue-400">{project.name} ({project.experiment_count})</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}; 