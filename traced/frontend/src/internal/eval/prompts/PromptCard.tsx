import React from 'react';
import { useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiService } from '@/api/axios';
import { Button } from "@/components/ui/button";
import { Converter } from 'showdown';
import ReactDiffViewer from 'react-diff-viewer';

import type { PromptHistory, PromptHistoryPageProps, PromptVersion } from '@/types/eval';

// Add new interface for display settings
interface DisplaySettings {
  renderMode: 'plain' | 'markdown';
  fontSize: 'xxs' | 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  textAlign: 'left' | 'center';
}

const textSizeClasses = {
  'xxs': 'text-[0.625rem]',
  'xs': 'text-xs',
  'sm': 'text-sm',
  'base': 'text-md',
  'lg': 'text-lg',
  'xl': 'text-xl',
};

// Add DisplayControls component
const DisplayControls: React.FC<{
  settings: DisplaySettings;
  onChange: (settings: DisplaySettings) => void;
}> = ({ settings, onChange }) => {
  return (
    <div className="flex gap-2 items-center">
      {/* <Select
        value={settings.renderMode}
        onValueChange={(value: 'plain' | 'markdown') => 
          onChange({ ...settings, renderMode: value })
        }
      >
        <SelectTrigger className="w-[100px] h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white">
          <SelectItem value="plain">Plain</SelectItem>
          <SelectItem value="markdown">MD</SelectItem>
        </SelectContent>
      </Select> */}

      <Select
        value={settings.fontSize}
        onValueChange={(value: 'sm' | 'base' | 'lg' | 'xl') => 
          onChange({ ...settings, fontSize: value })
        }
      >
        <SelectTrigger className="w-[100px] h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-white max-h-[400px] overflow-y-auto">
          <SelectItem value="xxs">XXSmall</SelectItem>
          <SelectItem value="xs">XSmall</SelectItem>
          <SelectItem value="sm">Small</SelectItem>
          <SelectItem value="base">Medium</SelectItem>
          <SelectItem value="lg">Large</SelectItem>
          <SelectItem value="xl">XLarge</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange({
          ...settings,
          textAlign: settings.textAlign === 'left' ? 'center' : 'left'
        })}
      >
        {settings.textAlign === 'left' ? '⇐' : '↔'}
      </Button>
    </div>
  );
};

export const PromptHistoryPage: React.FC<PromptHistoryPageProps> = ({
  projectId,
}) => {
const [selectedPromptHistory, setSelectedPromptHistory] = React.useState<PromptHistory | null>(null);
const [isLoading, setIsLoading] = React.useState(false);
const [promptHistories, setPromptHistories] = React.useState<PromptHistory[]>([]);
const [filteredHistories, setFilteredHistories] = React.useState<PromptHistory[]>([]);
const [currentPage, setCurrentPage] = React.useState(0);
const [displaySettings, setDisplaySettings] = React.useState<DisplaySettings>({
  renderMode: 'plain',
  fontSize: 'xs',
  textAlign: 'left',
});

useEffect(() => {
  const fetchPromptHistories = async () => {
    setIsLoading(true);
    try {
      const response = await apiService.get<PromptHistory[]>(
        `/projects/${projectId}/prompts/history`
      );
      setPromptHistories(response);
      setFilteredHistories(response);
    } catch (error) {
      console.error('Error fetching prompt histories:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (projectId) {
    fetchPromptHistories();
  }
}, [projectId]);

const handlePromptSelect = (uniqueId: string) => {
  const [name, sourceFile] = uniqueId.split('|');
  const history = promptHistories.find(h => h.name === name && h.current_version.source_info.file === sourceFile);
  if (history) {
    setSelectedPromptHistory(history);
    setCurrentPage(0); // Reset to first page when selecting new prompt
  }
};

enum DiffMethod {
  CHARS = 'diffChars',
  WORDS = 'diffWords',
  WORDS_WITH_SPACE = 'diffWordsWithSpace',
  LINES = 'diffLines',
  TRIMMED_LINES = 'diffTrimmedLines',
  SENTENCES = 'diffSentences',
  CSS = 'diffCss',
}

const renderVersionDiff = (currentVersion: PromptVersion, previousVersion: PromptVersion) => {
  return (
    <div className={`
      ${textSizeClasses[displaySettings.fontSize]}
      prose prose-sm max-w-none
      ${displaySettings.textAlign === 'left' ? 'text-left' : 'text-center'}
    `}>
      <div className="p-4 bg-gray-50 rounded-lg">
        <ReactDiffViewer
          oldValue={previousVersion.prompt_text}
          newValue={currentVersion.prompt_text}
          splitView={false}
          useDarkTheme={false}
          hideLineNumbers={false}
          showDiffOnly={false}
          compareMethod={DiffMethod.SENTENCES}
          styles={{
            variables: {
              light: {
                diffViewerBackground: '#ffffff',
                addedBackground: '#e6ffec',
                addedColor: '#1a7f37',
                removedBackground: '#ffebe9',
                removedColor: '#cf222e',
                wordAddedBackground: '#abf2bc',
                wordRemovedBackground: '#ffc0c0',
                addedGutterBackground: '#ccffd8',
                removedGutterBackground: '#ffd7d5',
                gutterBackground: '#f6f8fa',
                gutterBackgroundDark: '#f0f1f2',
                highlightBackground: '#fffbdd',
                highlightGutterBackground: '#fff5b1',
              },
            },
            line: {
              padding: '2px 0px',
              lineHeight: '1.5',
            },
            wordDiff: {
              padding: '1px 4px',
              borderRadius: '2px',
            }
          }}
          disableWordDiff={false}
        />
      </div>
    </div>
  );
};

const renderPromptContent = (text: string) => {
  const converter = new Converter({
    tables: true,
    strikethrough: true,
    tasklists: true,
    ghCodeBlocks: true,
  });

  return (
    <div className={`
      ${textSizeClasses[displaySettings.fontSize]}
      prose prose-sm max-w-none
      ${displaySettings.textAlign === 'left' ? 'text-left' : 'text-center'}
    `}>
      <div className="px-20 py-0 bg-gray-50 rounded-lg">
        {displaySettings.renderMode === 'markdown' ? (
          <div 
            className="leading-loose" 
            style={{ lineHeight: '2.2' }}
            dangerouslySetInnerHTML={{ __html: converter.makeHtml(text) }} 
          />
        ) : (
          <pre 
            className="whitespace-pre-wrap" 
            style={{ lineHeight: '2.2' }}
          >{text}</pre>
        )}
      </div>
    </div>
  );
};

// Modify version rendering to show two cards side by side
const renderVersionPair = (currentPage: number) => {
  if (!selectedPromptHistory) return null;
  const versions = selectedPromptHistory.versions;

  return (
    <div className="grid grid-cols-2 gap-4">
      {[0, 1].map((offset) => {
        const versionIndex = versions.length - 1 - currentPage - offset;
        if (versionIndex < 0) return null;

        const version = versions[versionIndex];
        const prevVersion = versionIndex > 0 ? versions[versionIndex - 1] : null;

        return (
          <div key={version.id} className="border rounded-lg p-4 bg-white">
            {/* Metadata Header */}
            <div className="mb-4 space-y-2 border-b pb-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-left">
                  Version {version.version}
                  <br />
                  <br />
                  {version.variables && (
                    <div className="text-sm text-center">
                      <div className="flex flex-wrap gap-2">
                        {version.variables.map((v) => (
                          <span key={v} className="bg-blue-100 px-1 py-1 rounded">
                            {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </h3>
                <div className="text-sm text-gray-500 text-right">
                  {new Date(version.created_at).toLocaleString()}
                  <div>{version.git_branch}</div>
                  <div>{version.git_commit?.slice(0, 7)}</div>
                  {version.source_info && (
                    <div className="text-sm text-gray-500">
                      <div>{version.source_info.file}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Updated Prompt Content rendering */}
            <div className="mt-4">
              {prevVersion ? (
                renderVersionDiff(version, prevVersion)
              ) : (
                renderPromptContent(version.prompt_text)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Adjust the maximum value for currentPage
const maxPage =
  selectedPromptHistory && selectedPromptHistory.versions.length > 1
    ? selectedPromptHistory.versions.length - 2
    : 0;

return (
  <div className="p-0 max-w-8xl mx-auto">
    {!projectId && (
      <div className="text-center py-4">Please select a project ID.</div>
    )}
    <div className="flex gap-4 mb-4">
      <div className="flex-1 flex justify-center">
        <Select 
          onValueChange={handlePromptSelect}
          onOpenChange={(open) => {
            if (open) setFilteredHistories(promptHistories);
          }}
        >
          <SelectTrigger className="w-[500px]">
            <SelectValue placeholder="Select a prompt" />
          </SelectTrigger>
          <SelectContent className="bg-white max-h-[400px] overflow-hidden w-[500px]">
            <div className="px-2 py-2 sticky top-0 bg-white z-10 border-b">
              <Input
                placeholder="Search prompts..."
                onChange={(e) => {
                  const query = e.target.value.toLowerCase();
                  const filtered = promptHistories.filter(history => 
                    history.name.toLowerCase().includes(query) ||
                    history.current_version.source_info.file.toLowerCase().includes(query)
                  );
                  setFilteredHistories(filtered);
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="h-8 w-full"
              />
            </div>
            <div className="mt-1 overflow-y-auto max-h-[320px]">
              {filteredHistories.length > 0 ? (
                [...filteredHistories]
                  .sort((a, b) => 
                    a.current_version.source_info.file.localeCompare(b.current_version.source_info.file)
                  )
                  .map((history, index) => (
                    <div key={`${history.name}|${history.current_version.source_info.file}`}>
                      <SelectItem 
                        value={`${history.name}|${history.current_version.source_info.file}`}
                        className={`border-b border-gray-100 py-1 text-xs ${
                          history.name.includes('user_prompt') ? 'text-blue-600' :
                          history.name.includes('system_prompt') ? 'text-red-600' :
                          'text-gray-900'
                        }`}
                      >
                        {history.name} - {history.current_version.source_info.file} ({history.versions.length})
                      </SelectItem>
                    </div>
                  ))
              ) : (
                <div className="p-2 text-xs text-gray-500">No prompts found.</div>
              )}
            </div>
          </SelectContent>
        </Select>
      </div>
      
      {selectedPromptHistory && (
        <div className="flex-none">
          <DisplayControls
            settings={displaySettings}
            onChange={setDisplaySettings}
          />
        </div>
      )}
    </div>

    {isLoading && (
      <div className="text-center py-0">Loading prompt history...</div>
    )}
    
    {selectedPromptHistory && (
      <div className="space-y-0">
        <div className="relative">
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="space-y-6">
              {renderVersionPair(currentPage)}
            </div>
          </ScrollArea>
          
          {/* Navigation Buttons */}
          <div className="absolute top-1/2 -translate-y-1/2 w-full flex justify-between px-4">
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="bg-white"
            >
              ←
            </Button>
            <Button
              variant="outline"
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={currentPage >= maxPage}
              className="bg-white"
            >
              →
            </Button>
          </div>
        </div>
      </div>
    )}
  </div>
);
};