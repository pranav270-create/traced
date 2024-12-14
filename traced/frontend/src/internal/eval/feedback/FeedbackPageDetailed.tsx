import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { useToast } from '@/hooks/use-toast';
import { apiService } from '@/api/axios';
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
} from "@/components/ui/dialog";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import findAndReplaceDOMText from 'findandreplacedomtext';

import { FeedbackTemplate, Row, ExpandedColumn, FontSize, ColumnWidth } from '@/types/eval';
import { getValueFromPath } from '@/internal/eval/utils/nestUtils';

interface FeedbackPageState {
  experimentId: string;
  experimentName: string;
  rows: Row[];
  template: {
    columns: ExpandedColumn[];
    feedbackTemplate: FeedbackTemplate | null;
  };
}

// Add new interface for row status
interface RowStatus {
  isSubmitted: boolean;
  feedbackInputs: { [key: string]: any };
  completedFields: string[];
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

interface ColumnDisplaySettings {
  [columnPath: string]: DisplaySettings;
}

interface Annotation {
  id: string;
  text: string;
  comment: string;
  color: string;
}

interface ColumnAnnotations {
  [columnPath: string]: Annotation[];
}

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
          
          return (
            <div
              key={index}
              className={`px-2 py-1 rounded cursor-pointer ${
                isCurrent ? 'bg-blue-100' : ''
              } hover:bg-blue-50`}
              onClick={() => onSelectField(index)}
            >
              <div className="flex items-center justify-between">
                <span className="truncate">{field.label}</span>
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

// Update the applyHighlights function to handle HTML content better
const applyHighlights = (content: string, annotations: Annotation[]): string => {
  console.log('Starting applyHighlights with:', {
    contentLength: content.length,
    annotationsCount: annotations.length,
    annotations: annotations
  });

  if (!annotations.length) {
    console.log('No annotations to process');
    return content;
  }

  // Create a temporary div to parse HTML content
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content;
  
  // Sort annotations by length (longest first)
  const sortedAnnotations = [...annotations].sort(
    (a, b) => b.text.length - a.text.length
  );
  console.log('Sorted annotations:', sortedAnnotations);

  sortedAnnotations.forEach((annotation, index) => {
    console.log(`Processing annotation ${index + 1}/${sortedAnnotations.length}:`, {
      text: annotation.text,
      color: annotation.color,
      id: annotation.id
    });

    // Test if the text exists in the content before trying to replace it
    const textExists = tempDiv.textContent?.includes(annotation.text);
    console.log('Text exists in content?', textExists);
    console.log('Template text content:', tempDiv.textContent);

    try {
      const result = findAndReplaceDOMText(tempDiv, {
        find: annotation.text,
        wrap: 'mark',
        wrapClass: 'cursor-pointer relative group',
        wrapStyle: `
          background-color: ${annotation.color}40 !important; 
          border-bottom: 2px solid ${annotation.color} !important; 
          padding: 0 !important;
        `,
        prepended: `
          <span class="hidden group-hover:block absolute z-50 bottom-full left-0 bg-white p-2 rounded shadow-lg border text-sm min-w-[200px] max-w-[300px]">
            <div class="mb-1 whitespace-normal">${annotation.comment}</div>
            <button 
              class="text-xs px-1 text-red-500 hover:text-red-700"
              onclick="window.removeAnnotation('${annotation.id}')"
            >
              Remove
            </button>
          </span>
        `,
      });
      console.log('Replacement result:', result);
    } catch (error) {
      console.error('Error during replacement:', error);
    }
  });

  const finalHTML = tempDiv.innerHTML;
  return finalHTML;
};

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
            groupCards.push(React.cloneElement(nextChild, {
              settings: { ...nextSettings, processed: true }
            }));
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
          return React.cloneElement(child, {
            className: `flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between ${child.props.className || ''}`
          });
        }
        return child;
      })}
    </Card>
  );
};

// Add new component for the description modal
const DescriptionModal: React.FC<{ description: string }> = ({ description }) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 gap-1 text-xs hover:bg-white/10"
        >
          <InfoCircledIcon className="h-4 w-4" />
          <span>Instructions</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-white p-4">
        <DialogHeader>
          <DialogTitle>Feedback Instructions</DialogTitle>
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
      </DialogContent>
    </Dialog>
  );
};

// Add new component for the annotation popover
const AnnotationPopover: React.FC<{
  selectedText: string;
  onAnnotate: (comment: string, color: string) => void;
  position: { x: number; y: number };
  popoverRef: React.RefObject<HTMLDivElement>;
}> = ({ selectedText, onAnnotate, position, popoverRef }) => {
  const [comment, setComment] = useState('');
  const [color, setColor] = useState('#ffeb3b'); // Default yellow

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event from bubbling up
    onAnnotate(comment, color);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event from bubbling up
    onAnnotate('', '');
  };

  return (
    <Popover open={true}>
      <PopoverTrigger asChild>
        <div 
          style={{ 
            position: 'fixed', 
            left: position.x, 
            top: position.y,
            width: '1px',
            height: '1px' 
          }} 
        />
      </PopoverTrigger>
      <PopoverContent 
        className="w-80"
        onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
      >
        <div ref={popoverRef}>

        <div className="space-y-2">
          <div className="flex gap-2 mb-2">
            {[
              { value: '#ffeb3b', label: 'Yellow' },
              { value: '#4caf50', label: 'Green' },
              { value: '#ff9800', label: 'Orange' },
              { value: '#03a9f4', label: 'Blue' },
            ].map((c) => (
              <button
                key={c.value}
                className={`w-6 h-6 rounded ${color === c.value ? 'ring-2 ring-offset-2 ring-black' : ''}`}
                style={{ backgroundColor: c.value }}
                onClick={(e) => {
                  e.stopPropagation();
                  setColor(c.value);
                }}
                title={c.label}
              />
            ))}
          </div>
          <Textarea
            placeholder="Add a comment..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-[100px]"
            onClick={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={false}
            >
              Save
            </Button>
          </div>
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const FeedbackPage: React.FC = () => {
  const location = useLocation();
  const state = location.state as FeedbackPageState | null;
  console.log('FeedbackPage state:', state);
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

  // Inside FeedbackPage component
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number } | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Add new state for tracking row statuses
  const [rowStatuses, setRowStatuses] = useState<{ [rowId: string]: RowStatus }>({});

  const textFieldRef = useRef<HTMLTextAreaElement>(null);

  const rows = state.rows;
  const totalRows = rows.length;
  const feedbackTemplate = state.template.feedbackTemplate;
  const displayColumns = state.template.columns;

  // Add new state in FeedbackPage component
  const [columnSettings, setColumnSettings] = useState<ColumnDisplaySettings>({});
  // Add new helper function
  const getDefaultSettings = (column: ExpandedColumn): DisplaySettings => ({
    renderMode: 'markdown',
    fontSize: column?.fontSize || 'base',
    width: column?.width || 'full',
    textAlign: 'center',
    lineSpacing: 'single',
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
          setFeedbackInputs(existingStatus.feedbackInputs);
          setCompletedFields(new Set(existingStatus.completedFields));
        } else {
          // Initialize new row state
          setFeedbackInputs({});
          setCompletedFields(new Set());
        }
      }
    }
  }, [currentIndex, rows, rowStatuses]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        contentRef.current &&
        !contentRef.current.contains(event.target as Node)
      ) {
        setIsPopoverOpen(false);
      }
    };
  
    document.addEventListener('mousedown', handleClickOutside);
  
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

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
  const handleInputChange = (fieldId: string, value: any) => {
    if (!fieldId || !currentRow) return;
    
    // Prevent changes if row is submitted
    if (rowStatuses[currentRow.id]?.isSubmitted) return;

    const newInputs = {
      ...feedbackInputs,
      [fieldId]: value,
    };

    setFeedbackInputs(newInputs);
    
    const newCompletedFields = new Set(completedFields).add(fieldId);
    setCompletedFields(newCompletedFields);

    // Save to row status
    setRowStatuses(prev => ({
      ...prev,
      [currentRow.id]: {
        isSubmitted: false,
        feedbackInputs: newInputs,
        completedFields: Array.from(newCompletedFields),
      },
    }));
  };

  // Add helper function to check if all fields are completed
  const areAllFieldsCompleted = () => {
    if (!feedbackTemplate?.fields || !currentRow) return false;
    else return true;
    
    // const requiredFieldIds = feedbackTemplate.fields.map((_, index) => 
    //   `row-${currentRow.id}-field-${index}`
    // );
    
    // return requiredFieldIds.every(fieldId => {
    //   const value = feedbackInputs[fieldId];
    //   return value !== undefined && value !== '';
    // });
  };

  // Update handleSubmit to check for completion
  const handleSubmit = async () => {
    if (!currentRow || !feedbackTemplate) return;

    if (!areAllFieldsCompleted()) {
      showToast(
        "Incomplete Feedback",
        "Please complete all feedback fields before submitting.",
        "destructive"
      );
      return;
    }

    // Transform feedbackInputs from fieldId to label mapping
    const transformedFeedback = Object.entries(feedbackInputs).reduce((acc, [fieldId, value]) => {
      // Extract the field index from the fieldId (format: "row-{rowId}-field-{index}")
      const fieldIndex = parseInt(fieldId.split('-').pop() || '0');
      const field = feedbackTemplate.fields[fieldIndex];
      
      if (field) {
        // Use the field label as the key instead of the fieldId
        acc[field.label] = value;
      }
      
      return acc;
    }, {} as Record<string, any>);

    const feedbackData = {
      feedback: transformedFeedback,
      feedback_type: 'user_feedback',
    };

    try {
      setRowStatuses(prev => ({
        ...prev,
        [currentRow.id]: {
          isSubmitted: true,
          feedbackInputs,
          completedFields: Array.from(completedFields),
        },
      }));

      enqueueSubmission(currentRow.id, feedbackData);

      if (currentIndex < totalRows - 1) {
        setCurrentIndex(currentIndex + 1);
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

    const isSubmitted = rowStatuses[currentRow.id]?.isSubmitted;
    const fieldId = `row-${currentRow.id}-field-${currentFieldIndex}`;
    const field = feedbackTemplate.fields[currentFieldIndex];
    if (!field) return null;

    // Show read-only view if submitted
    if (isSubmitted) {
      return (
        <div className="space-y-4">
          <div className="bg-gray-100 p-2 rounded text-sm">
            This row has been submitted and is now read-only.
          </div>
          {renderReadOnlyField(field, fieldId)}
        </div>
      );
    }

    // Return existing field rendering logic for editable fields
    return renderEditableField(field, fieldId);
  };

  // Helper function to render read-only fields
  const renderReadOnlyField = (field: any, fieldId: string) => {
    const value = feedbackInputs[fieldId];

    return (
      <div className="p-2 border rounded">
        <div className="font-medium">{field.label}</div>
        {field.description && (
          <p className="text-sm text-gray-500 mt-1 mb-2">{field.description}</p>
        )}
        <div className="mt-1 text-gray-600">
          {field.type === 'binary' ? (
            value === 1 ? '✓ Yes' : '✗ No'
          ) : field.type === 'numeric' ? (
            `Value: ${value}`
          ) : (
            value
          )}
        </div>
      </div>
    );
  };

  // Update renderEditableField to include description
  const renderEditableField = (field: any, fieldId: string) => {
    const fieldValue = feedbackInputs[fieldId] || '';
    const isCompleted = completedFields.has(fieldId);

    // Common header with label and description
    const fieldHeader = (
      <div className="mb-2">
        <span className="font-medium flex items-left">
          {field.label}
          {isCompleted && <span className="ml-2 text-green-500">✔</span>}
        </span>
        {field.description && (
          <p className="text-sm text-gray-500 mt-1 flex items-left">{field.description}</p>
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
            <Textarea
              ref={textFieldRef}
              placeholder="Enter your feedback..."
              value={fieldValue}
              onChange={(e) => handleInputChange(fieldId, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  textFieldRef.current?.blur();
                  e.preventDefault();
                }
              }}
            />
          </div>
        );
      default:
        return null;
    }
  };

  // Hotkey handlers
  const handlers = {
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
      if (currentRow && rowStatuses[currentRow.id]?.isSubmitted) return;
      
      const fieldId = `row-${currentRow?.id}-field-${currentFieldIndex}`;
      const field = feedbackTemplate?.fields[currentFieldIndex];
      if (field?.type === 'binary') {
        handleInputChange(fieldId, 1);
      }
    },
    BINARY_NO: (keyEvent?: KeyboardEvent) => {
      keyEvent?.preventDefault();
      if (document.activeElement instanceof HTMLTextAreaElement) return;
      if (currentRow && rowStatuses[currentRow.id]?.isSubmitted) return;
      
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
  };

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
    if (field?.type === 'text' && document.activeElement !== textFieldRef.current) {
      focusTextBox();
    }
  }, [currentFieldIndex, feedbackTemplate]);

  // Function to render content based on markdown toggle
  const renderContent = (content: any, column: any, columnPath: string) => {
    const settings = columnSettings[columnPath] || getDefaultSettings(column);
    let contentString = '';

    // Try to parse JSON early if content is a string
    let processedContent = content;
    if (typeof content === 'string') {
      const trimmedContent = content.trim();
      if ((trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) || 
          (trimmedContent.startsWith('[') && trimmedContent.endsWith(']'))) {
        try {
          processedContent = JSON.parse(content);
        } catch (e) {
          console.error("Failed to parse JSON:", e);
          processedContent = content; // Fallback to original content if parsing fails
        }
      }
    }

    if (settings.renderMode === 'yaml') {
      const processYamlObject = (obj: any, depth: number = 0): string => {
        if (typeof obj !== 'object' || obj === null) {
          return String(obj);
        }

        const indent = '  '.repeat(depth);
        let result = '';

        Object.entries(obj).forEach(([key, value]) => {
          const coloredKey = `<span class="text-blue-600">${key}</span>`;
          if (typeof value === 'object' && value !== null) {
            result += `${indent}${coloredKey}:\n${processYamlObject(value, depth + 1)}`;
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

      try {
        contentString = processYamlObject(processedContent);
      } catch (e) {
        console.error("Failed to process YAML:", e);
        contentString = String(content);
      }
    } else {
      // Handle arrays and objects for markdown/plain modes
      if (Array.isArray(processedContent)) {
        contentString = processedContent
          .map(item => {
            const cleanItem = String(item)
              .replace(/^["']|["']$/g, '')
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"');
            return `- ${cleanItem}\n`;
          })
          .join('\n');
      } else if (typeof processedContent === 'object' && processedContent !== null) {
        contentString = processedContent.markdown || processedContent.content || JSON.stringify(processedContent, null, 2);
      } else {
        contentString = String(processedContent);
      }

      if (typeof contentString === 'string') {
        if (contentString.split('-').length > 2) {
          contentString = contentString
            .split(/(?<!\n)-\s|(?<=\n)-/)
            .map(item => item.trim())
            .filter(item => item.length > 0)
            .map(item => `- ${item}`)
            .join('\n');
        }
      }

      contentString = contentString.replace(/\\\\u/g, '\\u');
      contentString = unescapeUnicode(contentString);
      contentString = contentString.replace(/\\n/g, '\n');
    }

    const textSizeClasses = {
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
    };

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

    let renderedContentHtml = '';
    
    if (settings.renderMode === 'yaml') {
      renderedContentHtml = `<div class="whitespace-pre-wrap font-mono text-left">${contentString}</div>`;
    } else if (settings.renderMode === 'markdown') {
      renderedContentHtml = converter.makeHtml(contentString);
    } else {
      renderedContentHtml = `<pre class="whitespace-pre-wrap break-words overflow-x-auto max-w-full">${contentString}</pre>`;
    }

    // Only get annotations for this specific column
    const columnAnnotations = annotations[columnPath] || [];
    console.log(`Applying annotations for column ${columnPath}:`, columnAnnotations);
    
    const highlightedContent = applyHighlights(renderedContentHtml, columnAnnotations);

    return (
      <div
        className={`
          ${textSizeClasses[settings.fontSize]} 
          prose prose-sm max-w-none dark:prose-invert
          prose-mark:bg-transparent prose-mark:p-0
          ${settings.textAlign === 'left' ? 'text-left' : 'text-center'}
          ${settings.lineSpacing === 'double' ? 'leading-loose' : 'leading-normal'}
        `}
        onMouseUp={(e) => {
          e.stopPropagation();
          // Pass the columnPath to handleTextSelection
          handleTextSelection(e, columnPath);
        }}
      >
        <div
          className="[&_mark]:bg-transparent [&_mark]:p-0"
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
        />
        {isPopoverOpen && popoverPosition && selectedColumnPath === columnPath && (
          <AnnotationPopover
            selectedText={selectedText}
            position={popoverPosition}
            onAnnotate={(comment, color) => handleAnnotate(columnPath, comment, color)}
            popoverRef={popoverRef}
          />
        )}
      </div>
    );
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
          <SelectTrigger className="w-[80px] h-6 text-xs">
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
          <SelectTrigger className="w-[70px] h-6 text-xs">
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
          <SelectTrigger className="w-[90px] h-6 text-xs">
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
          className="h-6 px-2 text-xs"
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
          className="h-6 px-2 text-xs"
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

  const [annotations, setAnnotations] = useState<ColumnAnnotations>({});
  const [selection, setSelection] = useState<Selection | null>(null);

  // Add new function to handle text selection
  const handleTextSelection = (e: React.MouseEvent, columnPath: string) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setSelectedText(selection.toString());
    setSelectedColumnPath(columnPath);
    setPopoverPosition({
      x: rect.left + (rect.width / 2),
      y: rect.bottom + 10,
    });
    setIsPopoverOpen(true);
  };

  // Add function to handle annotation creation
  const handleAnnotate = (columnPath: string, comment: string, color: string) => {
    if (!selectedText || !comment) {
      setIsPopoverOpen(false);
      return;
    }

    const newAnnotation: Annotation = {
      id: crypto.randomUUID(),
      text: selectedText,
      comment,
      color,
    };

    setAnnotations(prev => ({
      ...prev,
      [columnPath]: [...(prev[columnPath] || []), newAnnotation],
    }));

    // Clear selection and close the popover
    const selection = window.getSelection();
    selection?.removeAllRanges();
    setIsPopoverOpen(false);
    setSelectedColumnPath(null);
  };

  // Add function to remove annotation
  const removeAnnotation = (columnPath: string, annotationId: string) => {
    setAnnotations(prev => ({
      ...prev,
      [columnPath]: prev[columnPath]?.filter(a => a.id !== annotationId) || [],
    }));
  };

  // Add this to make the remove button work
  useEffect(() => {
    // Add the removeAnnotation function to the window object
    (window as any).removeAnnotation = (columnPath: string, annotationId: string) => {
      removeAnnotation(columnPath, annotationId);
    };

    // Cleanup
    return () => {
      delete (window as any).removeAnnotation;
    };
  }, []);

  // Add state for tracking which column is being annotated
  const [selectedColumnPath, setSelectedColumnPath] = useState<string | null>(null);

  return (
    <div className="h-screen">
      <GlobalHotKeys keyMap={keyMap} handlers={handlers} allowChanges />
      <SubmissionQueueIndicator 
        queue={submissionQueue}
        isProcessing={isProcessingQueue}
      />
      <ResizablePanelGroup direction="horizontal" className="h-screen py-10">
          {/* Main content area */}
          <ResizablePanel defaultSize={80} minSize={30}>
            <div className="py-0 px-4 overflow-y-auto h-full">
              <div className="flex justify-between items-center mb-0 bg-blue-400 p-2 rounded">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm text-white">
                    {state.experimentName} - Feedback ({currentIndex + 1}/{totalRows})
                  </h1>
                  {feedbackTemplate?.description && (
                    <DescriptionModal description={feedbackTemplate.description} />
                  )}
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
                        <div className="font-medium text-sm truncate">{displayTitle}</div>
                        <DisplayControls
                          columnPath={column.path}
                          settings={settings}
                          initialWidth={column.width}
                          initialFontSize={column.fontSize}
                          onChange={(newSettings) => {
                            setColumnSettings(prev => ({
                              ...prev,
                              [column.path]: newSettings
                            }));
                          }}
                        />
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
              <div className="h-full border-l overflow-y-auto p-4 bg-background">
                {renderCurrentFeedbackField()}

                <div className="sticky bottom-0 bg-background pt-4 border-t mt-6">
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleSubmit}
                      className="w-full"
                      disabled={!areAllFieldsCompleted() || Boolean(currentRow && rowStatuses[currentRow.id]?.isSubmitted)}
                    >
                      Submit
                    </Button>
                    <div className="flex gap-2">
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