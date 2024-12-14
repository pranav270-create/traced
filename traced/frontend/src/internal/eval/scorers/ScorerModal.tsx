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
import { CodeiumEditor, Document, Language } from "@codeium/react-code-editor";

import { ExpandedColumn, Row } from '@/types/eval';

interface ScorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  expandedColumns: ExpandedColumn[];
  selectedRows: Row[];
  onRunScorer: (params: any) => void;
}

// Pre-defined templates for scorers
const SCORER_TEMPLATES = {
  hallucination: {
    name: 'Hallucination',
    description: 'Detects whether the output contains hallucinated information.',
    prompt: 'Does the following output contain any hallucinated information?\n{{output}}',
  },
  faithfulness: {
    name: 'Faithfulness',
    description: 'Evaluates if the output is faithful to the input.',
    prompt: 'Is the output faithful to the input?\nInput: {{input}}\nOutput: {{output}}',
  },
  battle: {
    name: 'Battle / RLAIF',
    description: 'Compares two outputs and determines which one is better.',
    prompt: 'Which of the following outputs is better?\nOutput A: {{output_a}}\nOutput B: {{output_b}}',
  },
} as const;

type ScorerType = 'llm' | 'python';

// Provider models
const PROVIDER_MODELS = {
  anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-2.1'],
  gemini: ['gemini-pro', 'gemini-pro-vision'],
  openai: ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
} as const;

export const ScorerModal: React.FC<ScorerModalProps> = ({
  isOpen,
  onClose,
  expandedColumns,
  selectedRows,
  onRunScorer,
}) => {
  // State variables
  const [scorerType, setScorerType] = useState<ScorerType>('llm');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [pythonCode, setPythonCode] = useState('');

  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState<string>('gpt-3.5-turbo');
  const [temperature, setTemperature] = useState(0.0);
  const [maxTokens, setMaxTokens] = useState(512);

  const [variables, setVariables] = useState<string[]>([]);
  const [variableMappings, setVariableMappings] = useState<{
    [variable: string]: string;
  }>({});

  // Update prompt when template changes
  useEffect(() => {
    if (selectedTemplate && selectedTemplate in SCORER_TEMPLATES) {
      setCustomPrompt(SCORER_TEMPLATES[selectedTemplate as keyof typeof SCORER_TEMPLATES].prompt);
    } else {
      setCustomPrompt('');
    }
  }, [selectedTemplate]);

  // Extract variables from prompt or code
  useEffect(() => {
    const extractVariables = () => {
      const variableSet = new Set<string>();
      const regex = /{{{?([\s\S]+?)}?}}/g; // Matches {{variable}} and {{{variable}}}

      const text = scorerType === 'llm' ? customPrompt : pythonCode;

      let match;
      while ((match = regex.exec(text)) !== null) {
        // Strip any Mustache operators (#, ^, /, &, >) from the variable name
        const varName = match[1].trim().replace(/^[#^/&>]\s*/, '').trim();
        if (!varName.startsWith('!')) { // Ignore comments
          variableSet.add(varName);
        }
      }

      setVariables(Array.from(variableSet));
    };

    extractVariables();
  }, [customPrompt, pythonCode, scorerType]);

  // Add effect to update model when provider changes
  useEffect(() => {
    setModel(PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS][0]);
  }, [provider]);

  const handleMappingChange = (variable: string, columnPath: string) => {
    setVariableMappings((prev) => ({ ...prev, [variable]: columnPath }));
  };

  const handleRun = () => {
    const params = {
      scorerType,
      prompt: customPrompt,
      pythonCode,
      provider,
      model,
      temperature,
      maxTokens,
      variableMappings,
      selectedRowIds: selectedRows.map((row) => row.id),
    };
    onRunScorer(params);
    onClose();
  };

  // For Python scorer type, make all columns available without mapping
  useEffect(() => {
    if (scorerType === 'python') {
      const allMappings: { [key: string]: string } = {};
      expandedColumns.forEach((col) => {
        allMappings[col.path] = col.path;
      });
      setVariableMappings(allMappings);
    }
  }, [scorerType, expandedColumns]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] bg-white py-4 mx-auto">
        <DialogHeader className="pt-0">
          <DialogTitle>Scorer Configuration</DialogTitle>
        </DialogHeader>
        <div className="pt-0 flex flex-col gap-4 h-full overflow-y-auto px-4">
          <div className="flex gap-2 items-center">
            <div className="flex-1/3">
              <Label htmlFor="scorerType">Scorer Type</Label>
              <Select value={scorerType} onValueChange={(value) => setScorerType(value as ScorerType)}>
                <SelectTrigger id="scorerType" className="bg-white">
                  <SelectValue placeholder="Select Scorer Type" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="llm">LLM Judge</SelectItem>
                  <SelectItem value="python">Python Function</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scorerType === 'llm' && (
              <div className="flex-1/3">
                <Label htmlFor="template">Templates</Label>
                <Select
                  value={selectedTemplate}
                  onValueChange={(value) => setSelectedTemplate(value)}
                >
                  <SelectTrigger id="template" className="bg-white">
                    <SelectValue placeholder="Select a Template" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {Object.entries(SCORER_TEMPLATES).map(([key, template]) => (
                      <SelectItem key={key} value={key}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {scorerType === 'llm' ? (
            <>
              <div>
                <Label htmlFor="customPrompt">LLM Prompt</Label>
                <Textarea
                  id="customPrompt"
                  placeholder="Enter LLM scoring prompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
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
            </>
          ) : (
            <div>
              <Label htmlFor="pythonCode">Python Function</Label>
              <div className="h-[300px] mt-2 border rounded-md overflow-hidden">
                <CodeiumEditor
                  value={pythonCode}
                  height={300}
                  onChange={(value) => setPythonCode(value || '')}
                  language="python"
                  theme="vs-dark"
                  otherDocuments={[
                    new Document({
                      absolutePath: "/scorer_template.py",
                      relativePath: "scorer_template.py",
                      text: `# Example scorer template
def score(row):
    # All variables from the selected row are available directly
    # Example: input_text = row['input']
    #         output_text = row['output']
    
    # Your scoring logic here
    score = 0.0
    
    return score  # Return a float between 0 and 1`,
                      editorLanguage: "python",
                      language: Language.PYTHON,
                    }),
                  ]}
                />
              </div>
            </div>
          )}
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
            Run Scorer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};