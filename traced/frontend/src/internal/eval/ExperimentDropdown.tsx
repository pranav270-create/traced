// src/components/ExperimentDropdown.jsx

import React, { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"

import { Experiment } from '@/types/eval';

interface ExperimentDropdownProps {
  experiments: Experiment[];
  selectedExperiment: Experiment | null;
  setSelectedExperiment: (experiment: Experiment | null) => void;
}

const ExperimentDropdown: React.FC<ExperimentDropdownProps> = ({
  experiments,
  selectedExperiment,
  setSelectedExperiment
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
      e.preventDefault();
    }
  };

  React.useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const filteredExperiments = React.useMemo(() => 
    experiments?.filter((experiment) =>
      experiment.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [experiments, searchQuery]
  );

  return (
    <div className="h-7">
      <Select
        open={open}
        onOpenChange={setOpen}
        value={selectedExperiment?.id || ""}
        onValueChange={(value) => {
          const experiment = experiments.find((exp) => exp.id === value);
          setSelectedExperiment(experiment || null);
          setOpen(false);
        }}
      >
        <SelectTrigger className="w-[200px] bg-white h-7">
          <SelectValue placeholder="Select an experiment" />
        </SelectTrigger>
        <SelectContent 
          className="bg-white max-h-[300px] overflow-hidden w-[300px]"
          onPointerDownOutside={(e) => {
            if (e.target instanceof HTMLElement && 
                e.target.closest('[role="combobox"]')) {
              e.preventDefault();
            }
          }}
          position="popper"
          sideOffset={5}
        >
          <div className="px-2 py-2 sticky top-0 bg-white z-10 border-b">
            <Input
              ref={inputRef}
              placeholder="Search experiments..."
              value={searchQuery}
              onChange={(e) => {
                e.stopPropagation();
                setSearchQuery(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleKeyDown}
              className="h-8"
            />
          </div>
          <div className="mt-1 overflow-y-auto max-h-[220px]">
            {filteredExperiments.map((experiment) => (
              <SelectItem 
                key={experiment.id} 
                value={experiment.id}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {experiment.name}
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
};

export default ExperimentDropdown;