import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

import { ExpandedColumn, Row } from '@/types/eval';
import { getNestedValue } from '@/internal/eval/utils/nestUtils';

interface PromptPlaygroundModalProps {
  isOpen: boolean;
  onClose: () => void;
  expandedColumns: ExpandedColumn[];
  selectedRows: Row[];
  onRunExperiment: (params: any) => void;
}

const PROVIDER_MODELS = {
  anthropic: [
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307'
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4-turbo-2024-04-09',
    'gpt-4-turbo-preview',
    'gpt-4-0125-preview',
    'gpt-4',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125'
  ],
  anyscale: [
    'mistralai/Mistral-7B-Instruct-v0.1',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
    'mistralai/Mixtral-8x22B-Instruct-v0.1',
    'meta-llama/Meta-Llama-3-8B-Instruct',
    'meta-llama/Llama-3-70b-chat-hf',
    'codellama/CodeLlama-70b-Instruct-hf',
    'google/gemma-7b-it'
  ],
  mistral: [
    'open-mistral-7b',
    'open-mixtral-8x7b',
    'open-mixtral-8x22b',
    'mistral-small-latest',
    'mistral-medium-latest',
    'mistral-large-latest'
  ]
} as const;

export const PromptPlaygroundModal: React.FC<PromptPlaygroundModalProps> = ({
  isOpen,
  onClose,
  expandedColumns,
  selectedRows,
  onRunExperiment,
}) => {
  // State variables
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState<string>(PROVIDER_MODELS.openai[0]);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);

  const [variables, setVariables] = useState<string[]>([]);
  const [variableMappings, setVariableMappings] = useState<{
    [variable: string]: string;
  }>({});

  // Extract variables from prompts
  useEffect(() => {
    const extractVariables = () => {
      const variableSet = new Set<string>();
      const regex = /{{{?([\s\S]+?)}?}}/g; // Matches {{variable}} and {{{variable}}}

      let match;
      const prompts = [systemPrompt, userPrompt];

      for (const prompt of prompts) {
        while ((match = regex.exec(prompt)) !== null) {
          const varName = match[1].trim().replace(/^[#^/&>]\s*/, '').trim();
          if (!varName.startsWith('!')) {
            variableSet.add(varName);
          }
        }
      }

      setVariables(Array.from(variableSet));
    };

    extractVariables();
  }, [systemPrompt, userPrompt]);

  // Add effect to populate prompts from selected rows
  useEffect(() => {
    if (selectedRows.length > 0) {
      const firstRow = selectedRows[0];

      // Helper function to find matching column
      const findMatchingColumn = (searchTerms: string[]): ExpandedColumn | null => {
        return expandedColumns.find(col => {
          const labelLower = col.label.toLowerCase();
          const pathLower = col.path.toLowerCase();
          return searchTerms.some(term => 
            labelLower.includes(term) || pathLower.includes(term)
          );
        }) || null;
      };

      // Find system prompt column
      const systemPromptCol = findMatchingColumn(['system_prompt', 'systemprompt']);
      // Find user prompt column
      const userPromptCol = findMatchingColumn(['user_prompt', 'userprompt']);
      
      // Set prompts if found
      if (systemPromptCol) {
        const systemPromptValue = getNestedValue(firstRow, systemPromptCol.path);
        if (systemPromptValue) setSystemPrompt(systemPromptValue);
      }

      if (userPromptCol) {
        const userPromptValue = getNestedValue(firstRow, userPromptCol.path);
        if (userPromptValue) setUserPrompt(userPromptValue);
      }
    }
  }, [selectedRows, expandedColumns]);

  // Add effect to update model when provider changes
  useEffect(() => {
    setModel(PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS][0]);
  }, [provider]);

  const handleMappingChange = (variable: string, columnPath: string) => {
    setVariableMappings((prev) => ({ ...prev, [variable]: columnPath }));
  };

  const handleRun = () => {
    const params = {
      systemPrompt,
      userPrompt,
      provider,
      model,
      temperature,
      maxTokens,
      variableMappings,
      selectedRowIds: selectedRows.map((row) => row.id),
    };
    onRunExperiment(params);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] bg-white py-4 mx-auto">
        <DialogHeader className="pt-0">
          <DialogTitle>Prompt Playground</DialogTitle>
        </DialogHeader>
        <div className="pt-0 flex flex-col gap-4 h-full overflow-y-auto px-4">
          <div>
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea
              id="systemPrompt"
              placeholder="Enter system prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="min-h-[100px] bg-gray-100"
            />
          </div>
          <div>
            <Label htmlFor="userPrompt">User Prompt</Label>
            <Textarea
              id="userPrompt"
              placeholder="Enter user prompt"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              className="min-h-[100px] bg-gray-100"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1/2">
              <Label htmlFor="provider">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="provider" className="bg-white">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="gemini">Gemini</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1/2">
              <Label htmlFor="model">Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="model" className="bg-white">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS].map((modelOption) => (
                    <SelectItem key={modelOption} value={modelOption}>
                      {modelOption}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1/2">
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
            </div>
            <div className="flex-1/2">
              <Label htmlFor="maxTokens">Max Tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              />
            </div>
          </div>
          <div>
            <h3 className="text-lg pt-2">Variable Mappings</h3>
            {variables.length > 0 ? (
              variables.map((variable) => (
                <div key={variable} className="flex items-center gap-4 my-2">
                  <Label className="w-1/4 font-mono text-blue-500 text-md">{variable}</Label>
                  <Select
                    value={variableMappings[variable] || ''}
                    onValueChange={(value) =>
                      handleMappingChange(variable, value)
                    }
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="Select a column" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {expandedColumns.map((col) => (
                        <SelectItem key={col.path} value={col.path}>
                          {col.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))
            ) : (
              <div>
                No variables found. Use {'{{{variableName}}}'} to define variables in your prompt or code.
                Refer to the <a href="http://mustache.github.io" target="_blank" rel="noopener noreferrer" className="text-blue-500">Mustache documentation</a> for more details.
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleRun}>
            Re-run Experiment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};