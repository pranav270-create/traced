import React, { useState, useEffect } from 'react';
import { ChevronRight, X, ChevronDown, ChevronUp, Clock, ThumbsUp, ThumbsDown, Tag } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from '@/hooks/use-toast';
import { apiService } from '@/api/axios';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { Row, Span, FeedbackTemplate, FeedbackField } from '@/types/eval';

interface SpanPanelProps {
  row: Row;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  feedbackTemplate?: FeedbackTemplate;
}

export const SpanPanel: React.FC<SpanPanelProps> = ({ 
  row, 
  onClose,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  feedbackTemplate
}) => {
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [dataFormat, setDataFormat] = useState<'yaml' | 'json'>('yaml');
  const [feedbackValues, setFeedbackValues] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const user_id = 1;  // NOTE: YOU NEED A SOLUTION FOR THIS
  const [isLabelDialogOpen, setIsLabelDialogOpen] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [isCreateTagModalOpen, setIsCreateTagModalOpen] = useState(false);
  const [existingFeedbackId, setExistingFeedbackId] = useState<string | null>(null);

  // Reset selected span when row changes
  useEffect(() => {
    // Try to find a matching span by name in the new row
    if (selectedSpan && row.spans) {
      const findSpanByName = (spans: Span[]): Span | undefined => {
        for (const span of spans) {
          if (span.name === selectedSpan.name) {
            return span;
          }
          if (span.children) {
            const found = findSpanByName(span.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const matchingSpan = findSpanByName(row.spans);
      if (matchingSpan) {
        setSelectedSpan(matchingSpan);
        return;
      }
    }
    
    // Fallback to selecting the first span if no match found
    setSelectedSpan(row.spans?.[0] || null);
  }, [row.id]); // Dependency on row.id ensures we reset when row changes

  // Reset feedback values when row changes
  useEffect(() => {
    if (row.feedbacks && row.feedbacks.length > 0 && feedbackTemplate) {
      // Filter feedbacks by user_id and feedback_type
      const userFeedbacks = row.feedbacks
        .filter(f => 
          String(f.user_id) === String(user_id) && 
          String(f.feedback_type) === 'user_feedback'
        );

      const newFeedbackValues: Record<string, any> = {};

      // For each field in the feedbackTemplate
      feedbackTemplate.fields.forEach(field => {
        // For this field, find the latest feedback entry from the user that contains this field
        const feedbackWithField = userFeedbacks
          .filter(fb => fb.feedback && fb.feedback[field.label] !== undefined)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (feedbackWithField.length > 0) {
          // Get the latest value for this field
          newFeedbackValues[field.label] = feedbackWithField[0].feedback[field.label];
        }
      });

      setFeedbackValues(newFeedbackValues);

      // Optionally, set the existingFeedbackId to the most recent feedback entry
      const latestFeedbackEntry = userFeedbacks
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
      setExistingFeedbackId(latestFeedbackEntry?.id || null);

    } else {
      setFeedbackValues({}); // Reset if no feedbacks array
      setExistingFeedbackId(null);
    }
  }, [row.id, user_id, feedbackTemplate]); // Depend on row.id, user_id, feedbackTemplate

  const handleFeedbackChange = (fieldKey: string, value: any) => {
    setFeedbackValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
  };

  const handleFeedbackSubmit = async (fieldKey: string) => {
    if (feedbackValues[fieldKey] == null) return;
    
    setIsSubmitting(true);
    toast({
      title: "Saving",
      description: "Submitting your feedback...",
    });

    try {
      // Find the field label from the template
      const field = feedbackTemplate?.fields.find(f => f.label === fieldKey);
      if (!field) {
        throw new Error(`Field ${fieldKey} not found in template`);
      }

      // Prepare the updated feedback object
      const updatedFeedback = { ...feedbackValues };

      // Prepare the feedback data
      const feedbackData = {
        feedback: updatedFeedback,
        feedback_type: 'user_feedback',
        row_id: row.id,
        user_id: user_id,
      };

      let responseId: string;
      if (existingFeedbackId) {
        // Update existing feedback
        await apiService.put(`/rows/${row.id}/feedback/${existingFeedbackId}`, feedbackData);
        responseId = existingFeedbackId;
      } else {
        // Create new feedback
        const response = await apiService.post(`/rows/${row.id}/feedback`, feedbackData);
        const responseData = response as { id: string }; // Type assertion to specify the structure of response
        responseId = responseData.id;
        // Update the existingFeedbackId with the new feedback's ID
        setExistingFeedbackId(responseId);
      }

      // After successful submission, update row.feedbacks with the new feedback
      if (row.feedbacks) {
        const updatedRowFeedbacks = [...row.feedbacks];
        const feedbackIndex = updatedRowFeedbacks.findIndex(f => 
          String(f.user_id) === String(user_id) && 
          String(f.feedback_type) === 'user_feedback'
        );

        const newFeedback = {
          id: responseId,
          feedback: updatedFeedback,
          feedback_type: 'user_feedback',
          user_id: user_id || undefined,  // Ensure user_id is either string or undefined
          timestamp: new Date().toISOString()
        };

        if (feedbackIndex !== -1) {
          updatedRowFeedbacks[feedbackIndex] = newFeedback;
        } else {
          updatedRowFeedbacks.push(newFeedback);
        }

        // Update the row object with new feedbacks
        row.feedbacks = updatedRowFeedbacks;
      }
      
      toast({
        title: "Success",
        description: "Feedback submitted successfully.",
      });

    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast({
        title: "Error",
        description: "Failed to submit feedback. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatData = (data: any): string => {
    if (!data) return '';
    
    // Helper function to parse JSON strings
    const parseJsonString = (str: string) => {
      try {
        return JSON.parse(str.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      } catch (e) {
        return str;
      }
    };

    // If data is a string, try to parse it as JSON first
    if (typeof data === 'string') {
      data = parseJsonString(data);
    }

    // Parse any nested JSON strings in objects
    if (typeof data === 'object') {
      Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string') {
          data[key] = parseJsonString(data[key]);
        }
      });
    }

    try {
      if (dataFormat === 'yaml') {
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
              result += `${indent}${coloredKey}: ${value}\n`;
            }
          });

          return result;
        };

        return processYamlObject(data);
      }
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  };

  const isRootSpan = selectedSpan && row.spans?.some(span => span.id === selectedSpan.id);

  const generatePastelColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = hash % 360;
    return `hsl(${h}, 70%, 85%)`;
  };

  const handleCreateTag = async (tagData: TagData) => {
    try {
      await apiService.post(`/rows/${row.id}/tags`, {
        ...tagData,
        tags: [...labels, tagData.label]  // Include both new and existing tags
      });
      setLabels(prev => [...prev, tagData.label]);
      toast({
        title: "Success",
        description: "Tag created successfully",
      });
    } catch (error) {
      console.error('Error creating tag:', error);
      toast({
        title: "Error",
        description: "Failed to create tag",
        variant: "destructive",
      });
    }
  };

  const renderFeedbackField = (field: FeedbackField) => {
    const value = feedbackValues[field.label];

    switch (field.type) {
      case 'binary':
        return (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-500">{field.label}</span>
            <div className="flex gap-4 items-center">
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`gap-1 hover:bg-green-50 ${value === 1 ? 'bg-green-100' : ''}`}
                  onClick={() => handleFeedbackChange(field.label, 1)}
                  disabled={isSubmitting}
                >
                  <ThumbsUp className={`h-4 w-4 ${value === 1 ? 'text-green-600' : ''}`} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`gap-1 hover:bg-red-50 ${value === 0 ? 'bg-red-100' : ''}`}
                  onClick={() => handleFeedbackChange(field.label, 0)}
                  disabled={isSubmitting}
                >
                  <ThumbsDown className={`h-4 w-4 ${value === 0 ? 'text-red-600' : ''}`} />
                </Button>
              </div>
              {(value === 0 || value === 1) && (
                <Button 
                  size="sm"
                  variant="outline"
                  onClick={() => handleFeedbackSubmit(field.label)}
                  disabled={isSubmitting}
                  className="h-7 text-xs bg-blue-100"
                >
                  Save
                </Button>
              )}
            </div>
          </div>
        );

      case 'text':
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-500">{field.label}</span>
              {value && (
                <Button 
                  size="sm"
                  variant="outline"
                  onClick={() => handleFeedbackSubmit(field.label)}
                  disabled={isSubmitting}
                  className="h-7 text-xs bg-blue-100"
                >
                  Save
                </Button>
              )}
            </div>
            <Textarea
              placeholder={`Enter ${field.label.toLowerCase()}...`}
              value={value || ''}
              onChange={(e) => handleFeedbackChange(field.label, e.target.value)}
              className="h-20 text-sm"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        );

      case 'numeric':
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-500">{field.label}</span>
              {value && (
                <Button 
                  size="sm"
                  variant="outline"
                  onClick={() => handleFeedbackSubmit(field.label)}
                  disabled={isSubmitting}
                  className="h-7 text-xs bg-blue-100"
                >
                  Save
                </Button>
              )}
            </div>
            <Input
              type="number"
              min={field.numericRange?.min}
              max={field.numericRange?.max}
              value={value || ''}
              onChange={(e) => handleFeedbackChange(field.label, Number(e.target.value))}
              className="w-24"
            />
            {field.numericRange?.rubric && field.numericRange.rubric.length > 0 && (
              <div className="mt-2 border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-center font-medium text-gray-500 w-16">Score</th>
                      <th className="px-2 py-1 text-center font-medium text-gray-500">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {field.numericRange.rubric.map((item, index) => (
                      <tr 
                        key={index}
                        className={value === item.value ? 'bg-blue-50' : 'bg-white'}
                      >
                        <td className="px-2 py-1 font-medium">{item.value}</td>
                        <td className="px-2 py-1 text-gray-600">{item.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
    }
  };

  const renderFeedbackSection = () => {
    if (!feedbackTemplate || !isRootSpan) return null;

    return (
      <div className="space-y-4 mt-6">
        <h4 className="text-sm font-medium text-gray-700">Feedback</h4>
        {feedbackTemplate.fields.map((field) => (
          <div key={field.label} className="space-y-2">
            {renderFeedbackField(field)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed top-0 right-0 h-full w-4/5 bg-white shadow-lg flex z-50">
      {/* Left side - Trace View */}
      <div className="w-2/5 border-r border-gray-200 overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Trace View</h2>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={onPrevious}
                disabled={!hasPrevious}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={onNext}
                disabled={!hasNext}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Row ID: {row.id.slice(0, 8)}
          </div>
        </div>
        
        <div className="p-4">
          <TraceTree 
            spans={row.spans} 
            onSpanSelect={setSelectedSpan}
            selectedSpanId={selectedSpan?.id}
            rootSpans={row.spans}
          />
        </div>
      </div>

      {/* Right side - Span Details */}
      <div className="flex-1 overflow-y-auto">
        {selectedSpan ? (
          <div className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{selectedSpan.name}</h3>
              <div className="flex gap-2 items-center">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsCreateTagModalOpen(true)}
                  style={{ backgroundColor: '#D1E7DD' }} // Pastel green color
                >
                  <Tag className="h-4 w-4" />
                </Button>
                <Dialog open={isLabelDialogOpen} onOpenChange={setIsLabelDialogOpen}>
                  <DialogContent className="sm:max-w-md bg-white">
                    <DialogHeader>
                      <DialogTitle>Add Labels</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md">
                        {labels.map((label, index) => (
                          <Badge
                            key={index}
                            style={{ backgroundColor: generatePastelColor(label) }}
                            className="px-2 py-1 text-gray-700 flex items-center gap-1"
                          >
                            {label}
                            <X
                              className="h-3 w-3 cursor-pointer hover:text-gray-900"
                              onClick={() => {
                                const newLabels = labels.filter((_, i) => i !== index);
                                setLabels(newLabels);
                                // Show saving toast
                                toast({
                                  title: "Saving",
                                  description: "Removing label...",
                                });
                                // Update backend with new array
                                apiService.post(`/rows/${row.id}/tags`, {
                                  tags: newLabels
                                }).then(() => {
                                  toast({
                                    title: "Success",
                                    description: "Label removed successfully",
                                  });
                                }).catch(() => {
                                  toast({
                                    title: "Error",
                                    description: "Failed to remove label",
                                    variant: "destructive",
                                  });
                                });
                              }}
                            />
                          </Badge>
                        ))}
                      </div>
                      
                      <Input
                        placeholder="Type a label and press Enter"
                        value={labelInput}
                        onChange={(e) => setLabelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && labelInput.trim()) {
                            e.preventDefault();
                            const newLabel = labelInput.trim();
                            if (!labels.includes(newLabel)) {
                              const newLabels = [...labels, newLabel];
                              setLabels(newLabels);
                              
                              // Show saving toast
                              toast({
                                title: "Saving",
                                description: "Adding new label...",
                              });
                              
                              apiService.post(`/rows/${row.id}/tags`, {
                                tags: newLabels
                              }).then(() => {
                                toast({
                                  title: "Success",
                                  description: "Label added successfully",
                                });
                              }).catch(() => {
                                toast({
                                  title: "Error",
                                  description: "Failed to add label",
                                  variant: "destructive",
                                });
                              });
                            }
                            setLabelInput('');
                          }
                        }}
                        className="col-span-3"
                      />
                    </div>
                  </DialogContent>
                </Dialog>
                
                <Select
                  value={dataFormat}
                  onValueChange={(value: 'yaml' | 'json') => setDataFormat(value)}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="yaml">YAML</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Duration Card */}
            <Card className="mb-4">
              <CardContent className="p-3 bg-red-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-grey-500" />
                    <span className="text-sm text-grey-500">
                      Duration: {selectedSpan.duration}s
                    </span>
                  </div>
                  <span className="text-sm text-grey-500">
                    {new Date(selectedSpan.start_time).toLocaleTimeString()}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Input/Output/Error sections ... */}
            {selectedSpan.error && (
              <div className="mb-4 text-left">
                <h4 className="text-sm font-medium text-red-500 mb-2">Error</h4>
                <Card className="bg-gray-100 border-red-200">
                  <CardContent className="p-2">
                    <pre className="text-xs text-red-600 whitespace-pre-wrap font-mono">
                      {selectedSpan.error}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            )}

            {selectedSpan.input_data && (
              <div className="mb-2 text-left">
                <h4 className="text-sm font-medium mb-1">Input</h4>
                <Card className="bg-gray-100">
                  <CardContent className="p-2">
                    <pre 
                      className="text-xs leading-tight whitespace-pre-wrap font-mono text-left overflow-hidden"
                      style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
                      dangerouslySetInnerHTML={{ 
                        __html: formatData(selectedSpan.input_data) 
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {selectedSpan.output_data && (
              <div className="mb-2 text-left">
                <h4 className="text-sm font-medium mb-1">Output</h4>
                <Card className="bg-gray-100">
                  <CardContent className="p-2">
                    <pre 
                      className="text-xs leading-tight whitespace-pre-wrap font-mono text-left overflow-hidden"
                      style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
                      dangerouslySetInnerHTML={{ 
                        __html: formatData(selectedSpan.output_data) 
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            )}


            {/* Add meta_info section */}
            {selectedSpan.meta_info && Object.keys(selectedSpan.meta_info).length > 0 && (
              <div className="mb-4 text-left">
                <h4 className="text-sm font-medium mb-1">Metadata</h4>
                <Card className="bg-gray-100">
                  <CardContent className="p-2">
                    <pre 
                      className="text-xs leading-tight whitespace-pre-wrap font-mono text-left overflow-hidden"
                      style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}
                      dangerouslySetInnerHTML={{ 
                        __html: formatData(selectedSpan.meta_info) 
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {renderFeedbackSection()}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            Select a span to view details
          </div>
        )}
      </div>
      <CreateTagModal
        isOpen={isCreateTagModalOpen}
        onClose={() => setIsCreateTagModalOpen(false)}
        onSubmit={handleCreateTag}
      />
    </div>
  );
};

interface TraceTreeProps {
  spans: Span[];
  onSpanSelect: (span: Span) => void;
  selectedSpanId?: string;
  rootSpans: Span[];
  level?: number;
}

const spanColors = [
  { border: 'border-blue-400', bg: 'bg-blue-400' },
  { border: 'border-purple-400', bg: 'bg-purple-400' },
  { border: 'border-pink-400', bg: 'bg-pink-400' },
  { border: 'border-orange-400', bg: 'bg-orange-400' },
  { border: 'border-green-400', bg: 'bg-green-400' },
  { border: 'border-teal-400', bg: 'bg-teal-400' },
] as const;

const TraceTree: React.FC<TraceTreeProps> = ({ 
  spans, 
  onSpanSelect, 
  selectedSpanId,
  rootSpans,
  level = 0 
}) => {
  return (
    <div className="space-y-2">
      {spans.map(span => (
        <TraceNode 
          key={span.id} 
          span={span} 
          onSpanSelect={onSpanSelect}
          isSelected={span.id === selectedSpanId}
          selectedSpanId={selectedSpanId}
          rootSpans={rootSpans}
          level={level}
        />
      ))}
    </div>
  );
};

interface TraceNodeProps {
  span: Span;
  onSpanSelect: (span: Span) => void;
  isSelected: boolean;
  selectedSpanId?: string;
  rootSpans: Span[];
  level: number;
}

const TraceNode: React.FC<TraceNodeProps> = ({ 
  span, 
  onSpanSelect, 
  isSelected,
  selectedSpanId,
  rootSpans,
  level 
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const colorSet = spanColors[level % spanColors.length];

  // Calculate relative timing
  const calculateTimePosition = (span: Span, rootSpans: Span[]) => {
    const rootSpan = getRootSpan(span, rootSpans);
    const rootStartTime = Number(rootSpan.start_time);
    const spanStartTime = Number(span.start_time);
    const rootDuration = rootSpan.duration;
    const relativeStart = ((spanStartTime - rootStartTime) / rootDuration) * 100;
    const relativeWidth = (span.duration / rootDuration) * 100;
    return {
      left: Math.max(0, Math.min(relativeStart, 100)),
      width: Math.max(1, Math.min(relativeWidth, 100 - relativeStart))
    };
  };

  const timePosition = calculateTimePosition(span, rootSpans);

  return (
    <div className="space-y-1">
      <div className="relative"> 
        <div 
          className={`
            flex flex-col p-1.5 rounded-sm cursor-pointer
            border-l-2 ${colorSet.border}
            ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}
            transition-colors duration-150
          `}
          style={{ 
            marginLeft: `${level * 16}px`, // Indent the block
          }}
          onClick={() => onSpanSelect(span)}
        >
          {/* Top row with expand button and name */}
          <div className="flex items-center gap-1">
            {span.children && span.children.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="p-0.5"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-500" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-500" />
                )}
              </button>
            )}
            <div className="flex-1">
              <div className="font-medium text-sm">{span.name}</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{span.duration}s</span>
                {span.type && (
                  <span className="text-xs px-1.5 py-0.5 bg-gray-100 rounded-full text-gray-600">
                    {span.type}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Timeline bar */}
        <div className="w-full h-4 relative mt-2" style={{ marginLeft: 0 }}> {/* No indent for timeline */}
          {/* Base gray bar */}
          <div className="h-[3px] absolute w-full bg-gray-200" />
          {/* Colored progress bar */}
          <div
            className={`h-[3px] absolute ${colorSet.bg}`}
            style={{
              left: `${timePosition.left}%`,
              width: `${timePosition.width}%`,
            }}
          />
        </div>
      </div>

      {/* Children */}
      {isExpanded && span.children && (
        <div className="ml-2">
          <TraceTree 
            spans={span.children} 
            onSpanSelect={onSpanSelect}
            selectedSpanId={selectedSpanId}
            rootSpans={rootSpans}
            level={level + 1}
          />
        </div>
      )}
    </div>
  );
};

// Helper function to find parent span
const findParentSpan = (targetSpan: Span, rootSpans: Span[]): Span | null => {
  const findParent = (spans: Span[]): Span | null => {
    for (const span of spans) {
      if (span.children?.some(child => child.id === targetSpan.id)) {
        return span;
      }
      if (span.children) {
        const found = findParent(span.children);
        if (found) return found;
      }
    }
    return null;
  };
  return findParent(rootSpans);
};

// Helper function to get root span
const getRootSpan = (span: Span, rootSpans: Span[]): Span => {
  let current = span;
  let parent = findParentSpan(span, rootSpans);
  while (parent) {
    current = parent;
    parent = findParentSpan(current, rootSpans);
  }
  return current;
};

interface TagData {
  label: string;
  color: string;
  description?: string;
}

const CreateTagModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (tagData: TagData) => void;
}> = ({ isOpen, onClose, onSubmit }) => {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState('#FFE4E4');

  const colors = [
    '#FFE4E4', '#FFE9D9', '#FFF8D9', '#FFFBD9', 
    '#F1FFD9', '#E4FFE4', '#E4FFF1', '#E4FFFF',
    '#E4F1FF', '#E4E4FF', '#F1E4FF', '#FFE4FF',
    '#FFE4F1'
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;

    onSubmit({
      label: label.trim(),
      color: selectedColor,
      description: description.trim() || undefined
    });
    setLabel('');
    setDescription('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px] bg-white">
        <DialogHeader>
          <DialogTitle>Create tag</DialogTitle>
          <DialogDescription>
            This tag will be available in every experiment, dataset, and log event in My project.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <Input
              placeholder="Enter label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mb-2"
            />
            <div className="flex flex-wrap gap-2">
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded border ${
                    selectedColor === color ? 'ring-2 ring-offset-2 ring-black' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <Textarea
              placeholder="Enter description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!label.trim()}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};