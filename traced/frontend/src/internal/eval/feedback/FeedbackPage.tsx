import React, { useState, useMemo, useEffect, useRef, memo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useToast } from '@/hooks/use-toast';
import { apiService } from '@/api/axios';
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RotateCcw } from 'lucide-react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { GlobalHotKeys } from "react-hotkeys";
import { Converter } from 'showdown';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose, // Add this import
} from "@/components/ui/dialog";
import { InfoCircledIcon } from "@radix-ui/react-icons";

import { FeedbackTemplate, Row, ExpandedColumn, FontSize, ColumnWidth } from '@/types/eval';
import { getValueFromPath } from '@/internal/eval/utils/nestUtils';
import { TutorialStep, TutorialOverlay } from '../tutorial/TutorialOverlay';

interface FeedbackPageState {
  experimentId: string;
  experimentName: string;
  rows: Row[];
  template: {
    columns: ExpandedColumn[];
    feedbackTemplate: FeedbackTemplate | null;
  };
  require_all?: boolean;
}

// Update RowStatus interface to track submission history
interface RowStatus {
  submissions: {
    timestamp: string;
    feedbackInputs: { [key: string]: any };
  }[];
  currentFeedbackInputs: { [key: string]: any };
  completedFields: string[];
  isSubmitted: boolean;
}

// Add new interfaces
interface DisplaySettings {
  renderMode: 'plain' | 'markdown' | 'yaml';
  fontSize: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
  width: 'full' | 'half' | 'third' | 'quarter' | 'two-thirds' | 'three-quarters';
  layoutGroup?: string;
  textAlign: 'left' | 'center';
  lineSpacing: 'single' | 'double';
}


const textSizeClasses = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

interface ColumnDisplaySettings {
  [columnPath: string]: DisplaySettings;
}

const MemoizedTextarea = memo(({ fieldId, value, onChange, textRef }: {
  fieldId: string;
  value: string;
  onChange: (fieldId: string, value: any) => void;
  textRef: React.RefObject<HTMLTextAreaElement>;
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(fieldId, e.target.value);
  }, [fieldId, onChange]);

  return (
    <Textarea
      ref={textRef}
      placeholder="Enter your feedback..."
      value={value}
      onChange={handleChange}
      debounceMs={150}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
          e.preventDefault();
        }
      }}
    />
  );
});

// Add display name to avoid React dev warnings
MemoizedTextarea.displayName = 'MemoizedTextarea';


const SubmissionQueueIndicator: React.FC<{
  queue: {rowId: string, feedbackData: any}[];
  isProcessing: boolean;
}> = ({ queue, isProcessing }) => {
  if (queue.length === 0 && !isProcessing) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white rounded-lg shadow-lg p-2 min-w-[200px] max-w-[300px]">
        <div className="text-sm font-medium mb-2">
          Submission Queue ({queue.length})
          {isProcessing && <span className="ml-2 animate-pulse">⏳</span>}
        </div>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {queue.map((item, index) => (
            <div 
              key={`${item.rowId}-${index}`}
              className="text-xs bg-gray-50 p-1 rounded flex items-center justify-between"
            >
              <span>Row {item.rowId}</span>
              {index === 0 && isProcessing && (
                <span className="text-blue-500">Processing...</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const FeedbackList: React.FC<{
  feedbackTemplate: FeedbackTemplate | null,
  currentFieldIndex: number,
  completedFields: Set<string>,
  onSelectField: (index: number) => void,
  currentRowId: string | null,
}> = ({ feedbackTemplate, currentFieldIndex, completedFields, onSelectField, currentRowId }) => {
  if (!feedbackTemplate?.fields) return null;

  return (
    <div className="w-30 border-l h-full bg-background p-2">
      <div className="space-y-1">
        {feedbackTemplate.fields.map((field, index) => {
          const fieldId = `row-${currentRowId}-field-${index}`;
          const isCompleted = completedFields.has(fieldId);
          const isCurrent = currentFieldIndex === index;
          const fieldLabel = field.label || `Feedback ${index + 1}`;
          
          return (
            <div
              key={index}
              className={`px-2 py-1 rounded cursor-pointer ${
                isCurrent ? 'bg-blue-100' : ''
              } hover:bg-blue-50`}
              onClick={() => onSelectField(index)}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{fieldLabel}</span>
                {isCompleted && <span className="text-green-500">✔</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function unescapeUnicode(str: string) {
  return str.replace(/\\u[\dA-Fa-f]{4}/g, (match) => {
    return String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16));
  });
}

// Update ContentGrid component
const ContentGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const childArray = React.Children.toArray(children);
  
  // Group cards by their layout groups
  const processedChildren = childArray.reduce((acc: React.ReactNode[], child, index) => {
    if (React.isValidElement(child)) {
      const settings = child.props.settings;
      
      // Skip if this child was already processed as part of a group
      if (settings?.processed) return acc;

      // Check for specific layout combinations
      if (settings?.layoutGroup) {
        let groupCards: React.ReactNode[] = [];
        let remainingWidth = 12; // Using 12-column grid

        // Look ahead for matching group members
        for (let i = index; i < childArray.length; i++) {
          const nextChild = childArray[i];
          if (!React.isValidElement(nextChild)) continue;

          const nextSettings = nextChild.props.settings;
          if (nextSettings?.layoutGroup !== settings.layoutGroup) continue;

          // Calculate width based on the card's width setting
          const widthMap: { [key: string]: number } = {
            'quarter': 3,
            'third': 4,
            'half': 6,
            'two-thirds': 8,
            'three-quarters': 9,
          };

          const cardWidth = widthMap[nextSettings.width] || 12;
          if (cardWidth <= remainingWidth) {
            remainingWidth -= cardWidth;
            // Mark this child as processed
            const newProps = { ...nextChild.props, settings: { ...nextSettings, processed: true } };
            groupCards.push(React.cloneElement(nextChild, newProps));
          }

          // Stop if we've filled the row
          if (remainingWidth === 0) break;
        }

        // Only create a group if we found matching cards that fill the row
        if (remainingWidth === 0) {
          acc.push(
            <div key={`group-${index}`} className="col-span-12 grid grid-cols-12 gap-4">
              {groupCards}
            </div>
          );
          return acc;
        }
      }

      // Add non-grouped or incomplete group cards normally
      acc.push(child);
    }
    return acc;
  }, []);

  return (
    <div className="grid grid-cols-12 gap-4 mt-2">
      {processedChildren}
    </div>
  );
};

// Update Card wrapper with dynamic width classes
const DynamicCard: React.FC<{
  settings: DisplaySettings;
  children: React.ReactNode;
}> = ({ settings, children }) => {
  const widthClasses = {
    full: 'col-span-12',
    half: 'col-span-6',
    third: 'col-span-4',
    quarter: 'col-span-3',
    'two-thirds': 'col-span-8',
    'three-quarters': 'col-span-9',
  };

  return (
    <Card className={widthClasses[settings.width]}>
      {React.Children.map(children, child => {
        if (React.isValidElement(child) && child.type === CardHeader) {
          return React.cloneElement(child);
        }
        return child;
      })}
    </Card>
  );
};

// Add new component for the description modal
const HotkeyTable: React.FC = () => {
  return (
    <div className="mt-6 border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Key</th>
            <th className="px-4 py-2 text-left text-sm font-medium text-gray-500">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          <tr>
            <td className="px-4 py-2 font-mono text-sm">←/→</td>
            <td className="px-4 py-2 text-sm">Navigate between examples</td>
          </tr>
          <tr>
            <td className="px-4 py-2 font-mono text-sm">↑/↓</td>
            <td className="px-4 py-2 text-sm">Navigate between feedback fields</td>
          </tr>
          <tr>
            <td className="px-4 py-2 font-mono text-sm">Enter</td>
            <td className="px-4 py-2 text-sm">Submit feedback</td>
          </tr>
          <tr>
            <td className="px-4 py-2 font-mono text-sm">1-10</td>
            <td className="px-4 py-2 text-sm">Set numeric rating (0 maps to 10)</td>
          </tr>
          <tr>
            <td className="px-4 py-2 font-mono text-sm">1/0</td>
            <td className="px-4 py-2 text-sm">Set Yes/No for binary fields</td>
          </tr>
          <tr>
            <td className="px-4 py-2 font-mono text-sm">T</td>
            <td className="px-4 py-2 text-sm">Enter text editor</td>
          </tr>
          <tr>
            <td className="px-4 py-2 font-mono text-sm">Esc</td>
            <td className="px-4 py-2 text-sm">Exit text editor</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const DescriptionModal: React.FC<{ 
  description: string;
  onStartTutorial: () => void;
}> = ({ description, onStartTutorial }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 gap-1 text-white hover:text-white hover:bg-white/10 flex items-center"
        >
          <InfoCircledIcon className="h-4 w-4" />
          <span>Instructions</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white p-4">
        <DialogHeader>
          <DialogTitle className="flex justify-between items-center">
            <span>Feedback Instructions</span>
            <DialogClose asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onStartTutorial();
                }}
                className="flex items-center gap-2 mr-12"
              >
                Rewatch Tutorial
              </Button>
            </DialogClose>
          </DialogTitle>
        </DialogHeader>
        <div 
          className="prose prose-sm max-w-none dark:prose-invert mt-4
            prose-ul:list-disc prose-ul:ml-4 
            prose-ol:list-decimal prose-ol:ml-4
            prose-li:my-1
            prose-p:my-2
            prose-headings:mt-4 prose-headings:mb-2"
          dangerouslySetInnerHTML={{ __html: description }}
        />
        
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-2">Keyboard Shortcuts</h3>
          <p className="text-sm text-gray-600 mb-2">
            The following keyboard shortcuts are available to help you navigate and provide feedback more efficiently:
          </p>
          <HotkeyTable />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const FeedbackPage: React.FC = () => {
  const location = useLocation();
  const state = location.state as FeedbackPageState | null;
  const navigate = useNavigate();

  // Redirect if no state is present
  useEffect(() => {
    if (!state || !state.experimentId) {
      // Redirect to a safe route (e.g., home or experiments page)
      navigate('/experiments', { 
        replace: true,
      });
    }
  }, [state, navigate]);

  // Early return if state is not available
  if (!state || !state.experimentId) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Session Expired</h2>
          <p className="text-gray-600">Please return to the experiments page and try again.</p>
        </div>
      </div>
    );
  }

  const { toast } = useToast();
  const showToast = (title: string, description: string, variant: "default" | "destructive" = "default") => {
    toast({
      title,
      description,
      variant,
      // Make toasts less intrusive
      duration: 2000, // 2 seconds
      className: "w-[300px] h-[80px] top-0 left-0", // Smaller size and positioned in the top left
    });
  };

  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentRow, setCurrentRow] = useState<Row | null>(null);
  const [feedbackInputs, setFeedbackInputs] = useState<{ [key: string]: any }>({});
  const [completedFields, setCompletedFields] = useState<Set<string>>(new Set());
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [submissionQueue, setSubmissionQueue] = useState<{rowId: string, feedbackData: any}[]>([]);

  // Add new state for tracking row statuses
  const [rowStatuses, setRowStatuses] = useState<{ [rowId: string]: RowStatus }>({});

  const textFieldRef = useRef<HTMLTextAreaElement>(null);

  const rows = state.rows;
  const totalRows = rows.length;
  const feedbackTemplate = state.template.feedbackTemplate;
  const displayColumns = state.template.columns;
  const requireAll = state?.require_all ?? true;

  // Add new state in FeedbackPage component
  const [columnSettings, setColumnSettings] = useState<ColumnDisplaySettings>({});
  // Add new helper function
  const getDefaultSettings = (column: ExpandedColumn): DisplaySettings => ({
    renderMode: 'markdown',
    fontSize: column?.fontSize || 'base',
    width: column?.width || 'full',
    textAlign: 'left',
    lineSpacing: 'double',
  });

  // Update the row change effect to only reset field index on row changes
  useEffect(() => {
    if (rows && rows.length > 0) {
      setCurrentRow(rows[currentIndex]);
      
      // Only reset field index when changing rows
      const newRowId = rows[currentIndex]?.id;
      const currentRowId = currentRow?.id;
      if (newRowId !== currentRowId) {
        setCurrentFieldIndex(0);
      }
      
      const rowId = rows[currentIndex]?.id;
      if (rowId) {
        const existingStatus = rowStatuses[rowId];
        if (existingStatus) {
          // Restore previous state for this row
          setFeedbackInputs(existingStatus.currentFeedbackInputs);
          setCompletedFields(new Set(existingStatus.completedFields));
        } else {
          // Initialize new row state
          setFeedbackInputs({});
          setCompletedFields(new Set());
        }
      }
    }
  }, [currentIndex, rows, rowStatuses]);

  const handleNext = () => {
    if (currentIndex < totalRows - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const enqueueSubmission = (rowId: string, feedbackData: any) => {
    setSubmissionQueue(prev => [...prev, { rowId, feedbackData }]);
  };

  // Background submission queue processor
  useEffect(() => {
    const processQueue = async () => {
      if (submissionQueue.length === 0 || isProcessingQueue) return;

      setIsProcessingQueue(true);
      const { rowId, feedbackData } = submissionQueue[0];

      try {
        await apiService.post(`/rows/${rowId}/feedback`, feedbackData);
      } catch (error: any) {
        showToast(
          "Error",
          error.response?.data?.detail || "Failed to submit feedback",
          "destructive"
        );
      } finally {
        setSubmissionQueue(prev => prev.slice(1));
        setIsProcessingQueue(false);
      }
    };

    processQueue();
  }, [submissionQueue, isProcessingQueue]);

  // Update handleInputChange to save to rowStatuses
  const handleInputChange = useCallback((fieldId: string, value: any) => {
    if (!fieldId || !currentRow) return;
    
    setFeedbackInputs(prev => ({
      ...prev,
      [fieldId]: value,
    }));
    
    setCompletedFields(prev => new Set(prev).add(fieldId));

    // Batch the row status update
    setRowStatuses(prev => ({
      ...prev,
      [currentRow.id]: {
        submissions: prev[currentRow.id]?.submissions || [],
        currentFeedbackInputs: {
          ...(prev[currentRow.id]?.currentFeedbackInputs || {}),
          [fieldId]: value,
        },
        completedFields: Array.from(new Set([
          ...(prev[currentRow.id]?.completedFields || []),
          fieldId,
        ])),
        isSubmitted: prev[currentRow.id]?.isSubmitted || false, // Add this line
      },
    }));
  }, [currentRow]);

  // Add helper function to check if all fields are completed
  const areAllFieldsCompleted = (currentRow: Row | null, feedbackTemplate: FeedbackTemplate | null) => {
    if (!feedbackTemplate?.fields || !currentRow) return false;
    
    const requiredFieldIds = feedbackTemplate.fields.map((_, index) => 
      `row-${currentRow.id}-field-${index}`
    );
    
    return requiredFieldIds.every(fieldId => {
      const value = feedbackInputs[fieldId];
      return value !== undefined && value !== '';
    });
  };

  const handleSubmit = async () => {
    if (!currentRow || !feedbackTemplate) return;
  
    // Check completion if required
    if (requireAll && !areAllFieldsCompleted(currentRow, feedbackTemplate)) {
      // Find the next incomplete field
      const nextIncompleteFieldIndex = feedbackTemplate.fields.findIndex((_, index) => {
        const fieldId = `row-${currentRow.id}-field-${index}`;
        return !completedFields.has(fieldId);
      });

      // Move to the next incomplete field
      setCurrentFieldIndex(nextIncompleteFieldIndex);
      return;
    }

    // Transform feedbackInputs from fieldId to label mapping
    const transformedFeedback = Object.entries(feedbackInputs).reduce((acc, [fieldId, value]) => {
      const fieldIndex = parseInt(fieldId.split('-').pop() || '0');
      const field = feedbackTemplate.fields[fieldIndex];
      
      if (field) {
        acc[field.label] = value;
      }
      
      return acc;
    }, {} as Record<string, any>);
  
    const feedbackData = {
      feedback: transformedFeedback,
      feedback_type: 'user_feedback',
    };
  
    try {
      // Update row status with new submission
      setRowStatuses(prev => ({
        ...prev,
        [currentRow.id]: {
          submissions: [
            ...(prev[currentRow.id]?.submissions || []),
            {
              timestamp: new Date().toISOString(),
              feedbackInputs: { ...feedbackInputs },
            }
          ],
          currentFeedbackInputs: {},
          completedFields: [],
          isSubmitted: requireAll, // Mark as submitted only if require_all is true
        },
      }));
  
      // Reset current inputs
      setFeedbackInputs({});
      setCompletedFields(new Set());
  
      enqueueSubmission(currentRow.id, feedbackData);
  
      // Navigation logic
      if (requireAll) {
        // If require_all is true, always move to next row after submission
        if (currentIndex < totalRows - 1) {
          setCurrentIndex(currentIndex + 1);
          setCurrentFieldIndex(0);
        }
      } else {
        // Original sequential field navigation
        if (currentFieldIndex === feedbackTemplate.fields.length - 1) {
          if (currentIndex < totalRows - 1) {
            setCurrentIndex(currentIndex + 1);
            setCurrentFieldIndex(0);
          }
        } else {
          setCurrentFieldIndex(currentFieldIndex + 1);
        }
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      showToast(
        "Error",
        "Failed to submit feedback",
        "destructive"
      );
    }
  };

  // Update renderCurrentFeedbackField to handle submitted state
  const renderCurrentFeedbackField = () => {
    if (!feedbackTemplate || !feedbackTemplate.fields || !currentRow) return null;
  
    const fieldId = `row-${currentRow.id}-field-${currentFieldIndex}`;
    const field = feedbackTemplate.fields[currentFieldIndex];
    if (!field) return null;
  
    return renderEditableField(field, fieldId);
  };

  // Helper function to render read-only fields
  const renderReadOnlyField = (field: any, fieldId: string) => {
    if (!currentRow) return null;
  
    // Get the last submission for this row
    const rowStatus = rowStatuses[currentRow.id];
    const lastSubmission = rowStatus?.submissions[rowStatus.submissions.length - 1];
    const value = lastSubmission?.feedbackInputs[fieldId];
  
    return (
      <div className="p-2 border rounded">
        <div className="font-medium">{field.label}</div>
        {field.description && (
          <p className="text-sm text-gray-500 mt-1 mb-2">{field.description}</p>
        )}
        <div className="mt-1 text-gray-600">
          {field.type === 'binary' ? (
            value === 1 ? '✓ Yes' : value === 0 ? '✗ No' : 'Not set'
          ) : field.type === 'numeric' ? (
            `Value: ${value}`
          ) : (
            value || 'No response'
          )}
        </div>
      </div>
    );
  };
  // Update renderEditableField to handle read-only state
  const renderEditableField = (field: any, fieldId: string) => {
    const isSubmitted = requireAll && currentRow && rowStatuses[currentRow.id]?.isSubmitted;

    // If the row has been submitted in require_all mode, show read-only view
    if (isSubmitted) {
      return renderReadOnlyField(field, fieldId);
    }

    const fieldValue = feedbackInputs[fieldId] || '';
    const isCompleted = completedFields.has(fieldId);
    const previousSubmissions = currentRow ? 
      rowStatuses[currentRow.id]?.submissions
        .map(sub => sub.feedbackInputs[fieldId])
        .filter(Boolean) : 
      [];

    // Get field index from fieldId for fallback label
    const fieldIndex = parseInt(fieldId.split('-').pop() || '0') + 1;
    const fieldLabel = field.label || `Feedback ${fieldIndex}`;

    // Common header with label, description, and previous submissions
    const fieldHeader = (
      <div className="mb-2">
        <span className="font-medium flex items-left">
          {fieldLabel}
          {isCompleted && <span className="ml-2 text-green-500">✔</span>}
        </span>
        {field.description && (
          <p className="text-sm text-left text-gray-500 mt-1 flex items-left">{field.description}</p>
        )}
        
        {/* Show previous submissions if they exist */}
        {previousSubmissions?.length > 0 && (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-gray-600 font-medium">Previous submissions:</p>
            {previousSubmissions.map((submission, idx) => (
              <div key={idx} className="bg-gray-50 p-2 rounded text-sm">
                {field.type === 'binary' ? (
                  submission === 1 ? '✓ Yes' : submission === 0 ? '✗ No' : 'Not set'
                ) : field.type === 'numeric' ? (
                  `Value: ${submission}`
                ) : (
                  submission
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );

    switch (field.type) {
      case 'binary':
        return (
          <div key={fieldId} className="flex flex-col gap-2">
            {fieldHeader}
            <div className="flex items-center gap-2">
              <Button
                variant={feedbackInputs[fieldId] === 1 ? 'default' : 'outline'}
                className={feedbackInputs[fieldId] === 1 ? 'bg-green-500 text-white' : 'bg-white text-black'}
                onClick={() => handleInputChange(fieldId, 1)}
              >
                Yes
              </Button>
              <Button
                variant={feedbackInputs[fieldId] === 0 ? 'default' : 'outline'}
                className={feedbackInputs[fieldId] === 0 ? 'bg-red-500 text-white' : 'bg-white text-black'}
                onClick={() => handleInputChange(fieldId, 0)}
              >
                No
              </Button>
            </div>
          </div>
        );
      case 'numeric':
        return (
          <div key={fieldId} className="flex flex-col gap-2">
            {fieldHeader}
            <Slider
              min={field.numericRange?.min || 1}
              max={field.numericRange?.max || 10}
              step={1}
              value={[fieldValue || field.numericRange?.min || 1]}
              onValueChange={(value) => handleInputChange(fieldId, value[0])}
              className="w-full text-black"
            />
            <div className="flex justify-between text-sm">
              <span>{field.numericRange?.min || 1}</span>
              <span>{field.numericRange?.max || 10}</span>
            </div>
          </div>
        );
      case 'text':
        return (
          <div key={fieldId} className="flex flex-col gap-2">
            {fieldHeader}
            <MemoizedTextarea
              fieldId={fieldId}
              value={fieldValue}
              onChange={handleInputChange}
              textRef={textFieldRef}
            />
          </div>
        );
      default:
        return null;
    }
  };

  // Hotkey handlers
  const handlers = useMemo(() => ({
    NEXT: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      handleNext();
    },
    BACK: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      handleBack();
    },
    SUBMIT: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      handleSubmit();
    },
    BINARY_YES: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      
      const fieldId = `row-${currentRow?.id}-field-${currentFieldIndex}`;
      const field = feedbackTemplate?.fields[currentFieldIndex];
      if (field?.type === 'binary') {
        handleInputChange(fieldId, 1);
      }
    },
    BINARY_NO: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      
      const fieldId = `row-${currentRow?.id}-field-${currentFieldIndex}`;
      const field = feedbackTemplate?.fields[currentFieldIndex];
      if (field?.type === 'binary') {
        handleInputChange(fieldId, 0);
      }
    },
    NUMERIC_INPUT: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      const field = feedbackTemplate?.fields[currentFieldIndex];
      if (field?.type === 'numeric' && keyEvent?.key) {
        const value = parseInt(keyEvent.key, 10);
        handleNumericInput(value);
      }
    },
    ESCAPE: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement === textFieldRef.current) {
        textFieldRef.current?.blur();
      } else {
        document.body.focus();
      }
    },
    FOCUS_TEXT_BOX: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      focusTextBox();
    },
    UP: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      navigateField(-1);
    },
    DOWN: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      navigateField(1);
    },
  }), [currentRow, currentFieldIndex, feedbackTemplate, rowStatuses, handleNext, handleBack, handleSubmit, handleInputChange]);

  // Key mappings
  const keyMap = {
    SUBMIT: "enter",
    NEXT: "right",
    BACK: "left",
    BINARY_YES: "1",
    BINARY_NO: "0",
    NUMERIC_INPUT: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ESCAPE: "esc",
    FOCUS_TEXT_BOX: "t",
    UP: "up",
    DOWN: "down",
  };

  const handleNumericInput = (value: number) => {
    const fieldId = `row-${currentRow?.id}-field-${currentFieldIndex}`;
    const field = feedbackTemplate?.fields[currentFieldIndex];
    if (field?.type === 'numeric') {
      if (value === 0) value = 10; // Handle '0' as '10'
      handleInputChange(fieldId, value);
    }
  };

  const navigateField = (direction: number) => {
    setCurrentFieldIndex(prev => {
      let newIndex = prev + direction;
      const totalFields = feedbackTemplate?.fields.length || 0;
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= totalFields) newIndex = totalFields - 1;
      return newIndex;
    });
  };

  const focusTextBox = () => {
    if (textFieldRef.current) {
      textFieldRef.current.focus();
    }
  };

  // Update the text field focus effect to only focus when explicitly changing to a text field
  useEffect(() => {
    const field = feedbackTemplate?.fields[currentFieldIndex];
    if (field?.type === 'text') {
      // Small delay to ensure the DOM is ready
      setTimeout(() => {
        if (textFieldRef.current && document.activeElement !== textFieldRef.current) {
          textFieldRef.current.focus();
        }
      }, 0);
    }
  }, [currentFieldIndex, currentRow, feedbackTemplate]);

  // Function to render content based on markdown toggle
  const renderContent = (content: any, column: any, columnPath: string) => {
    const settings = columnSettings[columnPath] || getDefaultSettings(column);

    // Process content for YAML mode
    const processYamlObject = (obj: any, depth: number = 0): string => {
      if (typeof obj !== 'object' || obj === null) {
        return String(obj);
      }

      const indent = '  '.repeat(depth);
      let result = '';

      Object.entries(obj).forEach(([key, value]) => {
        const coloredKey = `<span class="text-blue-600">${key}</span>`;
        
        if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value)) {
            result += `${indent}${coloredKey}:\n`;
            value.forEach((item) => {
              if (typeof item === 'object' && item !== null) {
                result += `${indent}- \n${processYamlObject(item, depth + 1)}`;
              } else {
                result += `${indent}- ${String(item)}\n`;
              }
            });
          } else {
            result += `${indent}${coloredKey}:\n${processYamlObject(value, depth + 1)}`;
          }
        } else {
          const cleanValue = String(value)
            .replace(/^\s+|\s+$/gm, '')
            .replace(/\n\s*\n/g, '\n')
            .replace(/\s+/g, ' ')
            .trim();
          result += `${indent}${coloredKey}: ${cleanValue}\n`;
        }
      });

      return result;
    };

    // Enhanced processMarkdownObject with better formatting
    const processMarkdownObject = (obj: any, depth: number = 0): string => {
      if (obj === null || obj === undefined) return '';
      
      // Handle non-object values
      if (typeof obj !== 'object') return String(obj);
      
      // Handle arrays with proper bullet points and indentation
      if (Array.isArray(obj)) {
        return obj.map(item => {
          if (typeof item === 'object' && item !== null) {
            // For nested objects in arrays, maintain proper indentation
            const processed = processMarkdownObject(item, depth + 1);
            return `- ${processed.split('\n').map(line => line ? '  ' + line : line).join('\n')}`;
          }
          // Simple array items get bullet points
          return `- ${String(item)}`;
        }).join('\n');
      }
      
      // Handle objects with bold keys and proper indentation
      return Object.entries(obj)
        .map(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            const processedValue = processMarkdownObject(value, depth + 1);
            // Add extra newline for nested objects and proper indentation
            return `**${key}:**\n${processedValue.split('\n')
              .map(line => line ? '  ' + line : line)
              .join('\n')}`;
          }
          // Simple key-value pairs
          return `**${key}:** ${String(value)}`;
        })
        .join('\n\n'); // Double newline between top-level entries
    };

    // Try to parse JSON if content is a string
    let processedContent = content;
    if (typeof content === 'string') {
      const trimmedContent = content.trim();
      if ((trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) || 
          (trimmedContent.startsWith('[') && trimmedContent.endsWith(']'))) {
        try {
          processedContent = JSON.parse(content);
        } catch (e) {
          console.error("Failed to parse JSON:", e);
          processedContent = content;
        }
      }
    }

    let contentString = '';
    if (settings.renderMode === 'yaml') {
      try {
        contentString = processYamlObject(processedContent);
      } catch (e) {
        console.error("Failed to process YAML:", e);
        contentString = String(content);
      }
    } else {
      contentString = processMarkdownObject(processedContent);
    }

    // Enhanced cleanup with better handling of special characters
    contentString = contentString
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\u/g, '\\u')
      .replace(/\n\s*\n\s*\n/g, '\n\n'); // Remove excessive newlines
    contentString = unescapeUnicode(contentString);

    const converter = new Converter({
      tables: true,
      strikethrough: true,
      tasklists: true,
      ghCodeBlocks: true,
      emoji: true,
      headerLevelStart: 1,
      parseImgDimensions: true,
      simplifiedAutoLink: true,
      literalMidWordUnderscores: true,
      simpleLineBreaks: true,
    });

    // Enhanced rendering with better CSS classes for formatting
  const renderedContent = settings.renderMode === 'yaml' 
  ? (
    <div 
      className={`
        ${textSizeClasses[settings.fontSize]}
        whitespace-pre-wrap font-mono
        ${settings.textAlign === 'left' ? 'text-left' : 'text-center'}
        ${settings.lineSpacing === 'double' ? 'leading-loose' : 'leading-normal'}
      `}
      dangerouslySetInnerHTML={{ __html: contentString }}
    />
  )
  : settings.renderMode === 'markdown' || settings.renderMode === 'plain'
  ? (
    <div 
      className={`
        ${textSizeClasses[settings.fontSize]}
        markdown-content ${settings.renderMode === 'plain' ? 'plain-content' : ''}
        ${settings.textAlign === 'left' ? 'text-left' : 'text-center'}
        ${settings.lineSpacing === 'double' ? 'leading-loose' : 'leading-normal'}
        prose prose-headings:mt-4 prose-headings:mb-2
        prose-p:my-2 prose-p:leading-normal
        prose-ul:space-y-2 prose-ul:my-2
        prose-li:my-1
      `}
      dangerouslySetInnerHTML={{ 
        __html: settings.renderMode === 'markdown' 
          ? converter.makeHtml(contentString
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Pre-process bold before markdown conversion
              .replace(/- /g, '\n- ')) // Add newlines before list items
          : contentString
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/:\s/g, ': ')
              .replace(/\n/g, '<br/>')
              .replace(/- /g, '<br/>• ') // Add breaks between list items
      }} 
    />
  )
  : (
    <pre 
      className={`
        ${textSizeClasses[settings.fontSize]}
        whitespace-pre-wrap break-words font-[Calibri] overflow-x-auto max-w-full
        ${settings.textAlign === 'left' ? 'text-left' : 'text-center'}
        ${settings.lineSpacing === 'double' ? 'leading-loose' : 'leading-normal'}
      `}
    >
      {contentString}
    </pre>
  );

    return renderedContent;
  };

  // Update the DisplayControls component to be more responsive
  const DisplayControls: React.FC<{
    columnPath: string;
    settings: DisplaySettings;
    initialWidth: ColumnWidth;
    initialFontSize: FontSize;
    onChange: (settings: DisplaySettings) => void;
  }> = ({ columnPath, settings, initialWidth, initialFontSize, onChange }) => {
    // Initialize state with column's default values if no settings exist
    useEffect(() => {
      if (!columnSettings[columnPath]) {
        onChange({
          ...settings,
          width: initialWidth,
          fontSize: initialFontSize,
        });
      }
    }, [columnPath]);

    const handleLayoutChange = (value: string) => {
      // Remove any existing layout group
      const newSettings = { ...settings };
      delete newSettings.layoutGroup;

      switch (value) {
        case 'quarter':
          onChange({ ...newSettings, width: 'quarter', layoutGroup: 'quarter-half-quarter' });
          break;
        case 'three-quarters':
          onChange({ ...newSettings, width: 'three-quarters', layoutGroup: 'quarter-three-quarters' });
          break;
        case 'two-thirds':
          onChange({ ...newSettings, width: 'two-thirds', layoutGroup: 'third-two-thirds' });
          break;
        default:
          onChange({ ...newSettings, width: value as ColumnWidth });
      }
    };

    return (
      <div className="flex flex-wrap gap-1 items-center">
        <Select
          value={settings.renderMode}
          onValueChange={(value: 'plain' | 'markdown' | 'yaml') => 
            onChange({ ...settings, renderMode: value })
          }
        >
          <SelectTrigger className="w-[80px] h-6 text-xs text-gray-500">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="markdown">MD</SelectItem>
            <SelectItem value="yaml">YAML</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={settings.fontSize}
          onValueChange={(value: FontSize) => 
            onChange({ ...settings, fontSize: value })
          }
        >
          <SelectTrigger className="w-[70px] h-6 text-xs text-gray-500">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="xs">XS</SelectItem>
            <SelectItem value="sm">S</SelectItem>
            <SelectItem value="base">M</SelectItem>
            <SelectItem value="lg">L</SelectItem>
            <SelectItem value="xl">XL</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={settings.width}
          onValueChange={handleLayoutChange}
        >
          <SelectTrigger className="w-[90px] h-6 text-xs text-gray-500">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="full">Full</SelectItem>
            <SelectItem value="half">1/2</SelectItem>
            <SelectItem value="third">1/3</SelectItem>
            <SelectItem value="quarter">1/4</SelectItem>
            <SelectItem value="two-thirds">2/3</SelectItem>
            <SelectItem value="three-quarters">3/4</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs text-gray-500"
          onClick={() => onChange({
            ...settings,
            textAlign: settings.textAlign === 'left' ? 'center' : 'left'
          })}
        >
          {settings.textAlign === 'left' ? '⇐' : '↔'}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs text-gray-500"
          onClick={() => onChange({
            ...settings,
            lineSpacing: settings.lineSpacing === 'single' ? 'double' : 'single'
          })}
        >
          {settings.lineSpacing === 'single' ? '≡' : '⋮'}
        </Button>
      </div>
    );
  };

  const [showTutorial, setShowTutorial] = useState(() => {
    // Only show tutorial if it hasn't been completed before
    return localStorage.getItem('feedbackTutorialComplete') !== 'true';
  });

  const startTutorial = () => {
    setShowTutorial(true);
    localStorage.removeItem('feedbackTutorialComplete');
  };

  const tutorialSteps: TutorialStep[] = [
    {
      target: '[data-tutorial="display-controls"]',
      content: "Use these controls to customize how content is displayed. You can change the text size, layout, and more.",
      position: 'bottom',
      nextTrigger: 'click' as 'click',
    },
    {
      target: '[data-tutorial="variable-header"]',
      content: "These are the names of the outputs and inputs.",
      position: 'bottom',
      nextTrigger: 'click' as 'click',
    },
    {
      target: '[data-tutorial="feedback-input"]',
      content: "Enter your feedback here. Use the binary and numeric fields to grade the model output. Use the text box to provide detailed comments.",
      position: 'left',
      nextTrigger: 'click' as 'click',
    },
    {
      target: '[data-tutorial="navigation-buttons"]',
      content: "Use these buttons to navigate through the feedback form, or use the arrow keys on your keyboard.",
      position: 'top-right',
      nextTrigger: 'click' as 'click',
    },
    {
      target: '[data-tutorial="submit-button"]',
      content: "Click submit when you're ready to save your feedback and move to the next item.",
      position: 'top-left',
      nextTrigger: 'click' as 'click',
    }
  ];

return (
  <div className="h-screen overflow-hidden pt-14 pl-4">
    <TutorialOverlay
      steps={tutorialSteps}
      isActive={showTutorial}
      onComplete={() => {
        setShowTutorial(false);
        localStorage.setItem('feedbackTutorialComplete', 'true');
      }}
        onSkip={() => {
          setShowTutorial(false);
          localStorage.setItem('feedbackTutorialComplete', 'true');
        }}
      />
      <GlobalHotKeys keyMap={keyMap} handlers={handlers} allowChanges />
      <SubmissionQueueIndicator 
        queue={submissionQueue}
        isProcessing={isProcessingQueue}
      />
      <ResizablePanelGroup direction="horizontal" className="h-screen px-0">
          {/* Main content area */}
          <ResizablePanel defaultSize={80} minSize={30}>
            <div className="py-0 pr-4 overflow-y-auto h-full">
            <div className="flex justify-between items-center mb-0 bg-[#2B3668] p-2 rounded">
              <div className="flex justify-between items-center gap-0 w-full">
                <h1 className="text-sm text-white font-bold">
                Grading Example {currentIndex + 1} of {totalRows} from Experiment "{state.experimentName}" 
                </h1>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={startTutorial}
                    className="h-6 px-2 gap-1 text-white hover:text-white hover:bg-white/10 flex items-center"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Tutorial</span>
                  </Button>
                  {feedbackTemplate?.description && (
                    <DescriptionModal 
                      description={feedbackTemplate.description}
                      onStartTutorial={startTutorial} 
                    />
                  )}
                </div>
              </div>
            </div>

              <Separator />

              {/* Display Selected Columns */}
              <ContentGrid>
                {displayColumns.map((column) => {
                  const value = getValueFromPath(currentRow, column.path) || '';
                  // Initialize settings with column's default values
                  const settings = columnSettings[column.path] || getDefaultSettings(column);
                  
                  // Use title if available, otherwise fallback to label
                  const displayTitle = column?.title || column.label.split('>').pop()?.trim() || column.label;
                  
                  return (
                    <DynamicCard key={column.path} settings={settings}>
                      <CardHeader className="p-3">
                        <div className="font-sans font-medium text-xl truncate bg-[#6AAAC7] rounded-sm p-1"
                            data-tutorial="variable-header"
                        >
                          {displayTitle}
                        </div>
                        <div data-tutorial="display-controls">
                          <DisplayControls
                            columnPath={column.path}
                            settings={settings}
                            initialWidth={column?.width || 'full'}
                            initialFontSize={column?.fontSize || 'base'}
                            onChange={(newSettings) => {
                              setColumnSettings(prev => ({
                                ...prev,
                                [column.path]: newSettings
                              }));
                            }}
                          />
                        </div>
                      </CardHeader>
                      <CardContent>
                        {renderContent(value, column, column.path)}
                      </CardContent>
                    </DynamicCard>
                  );
                })}
              </ContentGrid>
            </div>
          </ResizablePanel>

          {/* Resizable handle */}
          <ResizableHandle withHandle />

          {/* Side panel */}
          <ResizablePanel
            defaultSize={20}
            minSize={15}
            maxSize={40}
          >
            <div className="relative h-full" id="side-panel">
              <div className="h-full border-l overflow-y-hidden p-4 bg-background">
                <div 
                  data-tutorial="feedback-input"
                  className="relative h-full"
                >
                  {renderCurrentFeedbackField()}
                </div>

                {/* SUBMIT, BACK, NEXT BUTTONS */}
                <div className="sticky bottom-0 bg-background pt-4 border-t mt-6">
                  <div className="flex flex-col gap-2">
                    <Button
                      data-tutorial="submit-button"
                      onClick={handleSubmit}
                      className="w-full"
                      disabled={
                        requireAll
                          ? !areAllFieldsCompleted(currentRow, feedbackTemplate) || Boolean(currentRow && rowStatuses[currentRow.id]?.isSubmitted)
                          : false
                      }
                    >
                      Submit
                    </Button>
                    <div className="flex gap-2" data-tutorial="navigation-buttons">
                      <Button
                        variant="outline"
                        onClick={handleBack}
                        disabled={currentIndex === 0}
                        className="flex-1"
                      >
                        Back
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleNext}
                        disabled={currentIndex === totalRows - 1}
                        className="flex-1"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ResizablePanel>
          <FeedbackList
            feedbackTemplate={feedbackTemplate}
            currentFieldIndex={currentFieldIndex}
            completedFields={completedFields}
            onSelectField={setCurrentFieldIndex}
            currentRowId={currentRow?.id || null}
          />
        </ResizablePanelGroup>
      </div>
  );
};

export default FeedbackPage;