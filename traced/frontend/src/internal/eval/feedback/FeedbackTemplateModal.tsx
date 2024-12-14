import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from '@/hooks/use-toast';
import { Plus, Minus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { Bold, Italic, Underline, List, ListOrdered, Link2, X } from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import { getValueFromPath } from '@/internal/eval/utils/nestUtils';
import { FeedbackField, FeedbackTemplate, ExpandedColumn, NumericRubricItem, ColumnWidth, FontSize } from '@/types/eval';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  expandedColumns: ExpandedColumn[];
  experimentId: string;
  onSave: (template: Partial<FeedbackTemplate>) => Promise<void>;
  initialTemplate: FeedbackTemplate | null;
  rows: any[];
}

export const FeedbackTemplateModal: React.FC<Props> = ({
  isOpen,
  onClose,
  expandedColumns,
  experimentId,
  onSave,
  rows,
  initialTemplate,
}) => {
  const [fields, setFields] = useState<FeedbackField[]>([]);
  const [availableColumns, setAvailableColumns] = useState<ExpandedColumn[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<ExpandedColumn[]>([]);
  const { toast } = useToast();
  const [previewMode, setPreviewMode] = useState(false);
  const [previewInputs, setPreviewInputs] = useState<{ [key: string]: any }>({});
  const previewRows = rows.slice(0, 1);

  const widthOptions: { label: string; value: ColumnWidth }[] = [
    { label: 'Full Width', value: 'full' },
    { label: 'Half Width', value: 'half' },
    { label: 'One Third', value: 'third' },
    { label: 'Two Thirds', value: 'two-thirds' },
    { label: 'Quarter Width', value: 'quarter' },
    { label: 'Three Quarters', value: 'three-quarters' },
  ];

  const fontSizeOptions: { label: string; value: FontSize }[] = [
    { label: 'Extra Small', value: 'xs' },
    { label: 'Small', value: 'sm' },
    { label: 'Normal', value: 'base' },
    { label: 'Large', value: 'lg' },
    { label: 'Extra Large', value: 'xl' },
  ];

  // Filter out feedback columns from expandedColumns
  const validColumns = expandedColumns.filter(column => !column.path.includes('feedbacks'));

  // Create a memoized localStorage key
  const localStorageKey = `columnOrder_${experimentId}`;

  // Initialize editor with template description if it exists
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: {},
        orderedList: {},
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-blue-500 hover:underline cursor-pointer',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        validate: href => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+[\w.,@?^=%&:/~+#-]*[\w@?^=%&/~+#-]$/.test(href),
      }),
    ],
    content: initialTemplate?.description || '',
    editorProps: {
      attributes: {
        class: 'prose max-w-none min-h-[150px] p-3 text-black bg-white focus:outline-none text-left border rounded-md',
      },
    },
  });

  // Update editor content when template changes
  useEffect(() => {
    if (editor && initialTemplate?.description) {
      editor.commands.setContent(initialTemplate.description);
    }
  }, [editor, initialTemplate]);

  // Initialize with template data when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialTemplate) {
        // Set fields from template
        setFields(initialTemplate.fields || []);
        
        // Set selected columns from template
        const templateColumns = initialTemplate.display_columns || [];
        setSelectedColumns(templateColumns);
        
        // Set available columns as remaining valid columns
        const remainingColumns = validColumns.filter(
          col => !templateColumns.some(tc => tc.path === col.path)
        );
        setAvailableColumns(remainingColumns);
      } else {
        // Initialize with empty selected and all columns available
        setFields([]);
        setSelectedColumns([]);
        setAvailableColumns(validColumns);
      }
    }
  }, [initialTemplate, isOpen]);

  const addField = () => {
    setFields([...fields, {
      type: 'text',
      label: '',
    }]);
  };

  const updateField = (index: number, updates: Partial<FeedbackField>) => {
    const newFields = [...fields];
    const currentField = newFields[index];
    
    // Initialize numeric range when switching to numeric type
    if (updates.type === 'numeric' && currentField.type !== 'numeric') {
      updates.numericRange = {
        min: 0,
        max: 10,
        rubric: []
      };
    }
    
    newFields[index] = { ...currentField, ...updates };
    setFields(newFields);
  };

  const updateNumericRange = (index: number, updates: Partial<FeedbackField['numericRange']>) => {
    const newFields = [...fields];
    const currentField = newFields[index];
    if (currentField.numericRange) {
      newFields[index] = {
        ...currentField,
        numericRange: {
          ...currentField.numericRange,
          ...updates
        }
      };
      setFields(newFields);
    }
  };

  const addRubricItem = (fieldIndex: number, value: number) => {
    const newFields = [...fields];
    const field = newFields[fieldIndex];
    if (field.numericRange) {
      field.numericRange.rubric = [
        ...(field.numericRange.rubric || []),
        { value, description: '' }
      ].sort((a, b) => a.value - b.value);
      setFields(newFields);
    }
  };

  const updateRubricItem = (fieldIndex: number, rubricIndex: number, updates: Partial<NumericRubricItem>) => {
    const newFields = [...fields];
    const field = newFields[fieldIndex];
    if (field.numericRange?.rubric) {
      field.numericRange.rubric[rubricIndex] = {
        ...field.numericRange.rubric[rubricIndex],
        ...updates
      };
      setFields(newFields);
    }
  };

  const removeRubricItem = (fieldIndex: number, rubricIndex: number) => {
    const newFields = [...fields];
    const field = newFields[fieldIndex];
    if (field.numericRange?.rubric) {
      field.numericRange.rubric.splice(rubricIndex, 1);
      setFields(newFields);
    }
  };

  const removeField = (index: number) => {
    const newFields = [...fields];
    newFields.splice(index, 1);
    setFields(newFields);
  };

  const toggleColumn = (column: ExpandedColumn) => {
    if (selectedColumns.some(c => c.path === column.path)) {
      // Moving from selected to available
      const newSelected = selectedColumns.filter(c => c.path !== column.path);
      const newAvailable = [...availableColumns, column];
      setSelectedColumns(newSelected);
      setAvailableColumns(newAvailable);
    } else {
      // Moving from available to selected
      const newAvailable = availableColumns.filter(c => c.path !== column.path);
      const newSelected: ExpandedColumn[] = [...selectedColumns, {
        ...column,
        width: 'full' as ColumnWidth,  // Default width
        fontSize: 'base',  // Default font size
        title: column.label  // Default title to label
      }];
      setAvailableColumns(newAvailable);
      setSelectedColumns(newSelected);
    }
  };

  const handleSave = async () => {
    try {
      toast({
        title: "Saving",
        description: "Saving feedback template...",
        variant: "default",
      });
      await onSave({
        experiment_id: experimentId,
        fields: fields.map(field => ({
          ...field,
          description: field.description || undefined,
        })),
        display_columns: selectedColumns.map(column => ({
          ...column,
          title: column.title || column.label,  // Fall back to label if no title
          width: column.width || 'full',
          fontSize: column.fontSize || 'base',
        })),
        description: editor?.getHTML() || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Error saving feedback template:', error);
    }
  };

  const renderPreviewFields = () => {
    const previewData = previewRows[0];

    const formatValue = (value: any) => {
      if (value === null || value === undefined) {
        return 'No value found';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    };

    return (
      <>
        {/* Display selected columns preview */}
        {selectedColumns.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-medium mb-4">Selected Columns Preview</h3>
            <div className="space-y-4">
              {selectedColumns.map((column) => (
                <div key={column.path} className="p-4 border rounded-lg w-full">
                  <div className="font-medium text-sm mb-2">{column.label}</div>
                  <div className="text-sm text-gray-600">
                    <pre className="whitespace-pre-wrap">
                      {previewData ? 
                        formatValue(getValueFromPath(previewData, column.path))
                        : 'No preview data available'
                      }
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback fields preview */}
        <h3 className="text-sm font-medium mb-4">Feedback Fields Preview</h3>
        {fields.map((field, index) => {
          const fieldId = `field-${index}`;
          const fieldValue = previewInputs[fieldId];

          switch (field.type) {
            case 'binary':
              return (
                <div key={fieldId} className="flex items-center gap-4 mb-4">
                  <span className="font-medium">{field.label}:</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={fieldValue === true ? 'default' : 'outline'}
                      className={fieldValue === true ? 'bg-green-500 text-white' : 'bg-white text-black'}
                      onClick={() => handlePreviewInput(fieldId, true)}
                    >
                      Yes
                    </Button>
                    <Button
                      variant={fieldValue === false ? 'default' : 'outline'}
                      className={fieldValue === false ? 'bg-red-500 text-white' : 'bg-white text-black'}
                      onClick={() => handlePreviewInput(fieldId, false)}
                    >
                      No
                    </Button>
                  </div>
                </div>
              );

            case 'numeric':
              return (
                <div key={fieldId} className="flex flex-col gap-2 mb-4">
                  <span className="font-medium">{field.label}:</span>
                  <Slider
                    min={field.numericRange?.min || 0}
                    max={field.numericRange?.max || 10}
                    step={1}
                    value={[fieldValue || field.numericRange?.min || 0]}
                    onValueChange={(value) => handlePreviewInput(fieldId, value[0])}
                    className="w-full text-black"
                  />
                  <div className="flex justify-between text-sm">
                    <span>{field.numericRange?.min || 0}</span>
                    <span>{field.numericRange?.max || 10}</span>
                  </div>
                  {field.numericRange?.rubric && fieldValue && (
                    <div className="text-sm text-gray-600 mt-1">
                      {field.numericRange.rubric
                        .find(item => item.value === fieldValue)?.description}
                    </div>
                  )}
                </div>
              );

            case 'text':
              return (
                <div key={fieldId} className="flex flex-col gap-2 mb-4">
                  <span className="font-medium">{field.label}:</span>
                  <Textarea
                    placeholder="Enter your feedback..."
                    value={fieldValue || ''}
                    onChange={(e) => handlePreviewInput(fieldId, e.target.value)}
                  />
                </div>
              );
          }
        })}
      </>
    );
  };

  const handlePreviewInput = (fieldId: string, value: any) => {
    setPreviewInputs(prev => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    const updatedColumns = Array.from(selectedColumns);
    const [movedColumn] = updatedColumns.splice(result.source.index, 1);
    updatedColumns.splice(result.destination.index, 0, movedColumn);

    setSelectedColumns(updatedColumns);

    // Save the new order to localStorage
    const newOrder = updatedColumns.map(col => col.path);
    localStorage.setItem(localStorageKey, JSON.stringify(newOrder));
  };

  const renderConfigurationMode = () => (
    <div className="space-y-4">
      {/* Overall Template Description */}
      <div className="mb-6">
        <Label>Template Description</Label>
        <div className="border rounded-md">
          <div className="border-b bg-gray-50 p-2">
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleBold().run()}
                className={editor?.isActive('bold') ? 'bg-gray-200' : ''}
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleItalic().run()}
                className={editor?.isActive('italic') ? 'bg-gray-200' : ''}
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
                className={editor?.isActive('underline') ? 'bg-gray-200' : ''}
              >
                <Underline className="h-4 w-4" />
              </Button>
              <div className="w-px h-4 bg-gray-300 my-auto" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
                className={editor?.isActive('bulletList') ? 'bg-gray-200' : ''}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
                className={editor?.isActive('orderedList') ? 'bg-gray-200' : ''}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
              <div className="w-px h-4 bg-gray-300 my-auto" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const url = window.prompt('Enter URL');
                  if (url) {
                    editor?.chain().focus().setLink({ href: url }).run();
                  }
                }}
                className={editor?.isActive('link') ? 'bg-gray-200' : ''}
              >
                <Link2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Feedback Fields section */}
      <div>
        <h3 className="text-sm font-medium mb-2">Feedback Fields</h3>
        {fields.map((field, index) => (
          <div 
            key={index} 
            className="space-y-2 mb-4 p-4 border-2 border-blue-200 rounded-md bg-blue-50/50"
          >
            <div className="flex gap-2">
              <Input
                placeholder="Label"
                value={field.label}
                onChange={(e) => updateField(index, { label: e.target.value })}
                required
                className={!field.label ? "border-red-500" : ""}
              />
              <Select
                value={field.type}
                onValueChange={(value) => updateField(index, { 
                  type: value as FeedbackField['type']
                })}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="binary">Binary</SelectItem>
                  <SelectItem value="numeric">Numeric</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeField(index)}
                className="h-8 w-8 p-0"
              >
                ×
              </Button>
            </div>

            {/* Field Description */}
            <div className="mt-2">
              <Label className="text-sm text-gray-600">Field Description</Label>
              <Textarea
                placeholder="Add a description for this field..."
                value={field.description || ''}
                onChange={(e) => updateField(index, { description: e.target.value })}
                className="h-20"
              />
            </div>

            {field.type === 'numeric' && field.numericRange && (
              <div className="space-y-4 mt-2">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label>Min Value</Label>
                    <Input
                      type="number"
                      value={field.numericRange.min}
                      onChange={(e) => updateNumericRange(index, { min: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex-1">
                    <Label>Max Value</Label>
                    <Input
                      type="number"
                      value={field.numericRange.max}
                      onChange={(e) => updateNumericRange(index, { max: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Rubric (Optional)</Label>
                  {field.numericRange.rubric?.map((item, rubricIndex) => (
                    <div key={rubricIndex} className="flex gap-2 items-start">
                      <Input
                        type="number"
                        className="w-24"
                        value={item.value}
                        onChange={(e) => updateRubricItem(index, rubricIndex, { value: Number(e.target.value) })}
                      />
                      <Textarea
                        placeholder="Description for this score..."
                        value={item.description}
                        onChange={(e) => updateRubricItem(index, rubricIndex, { description: e.target.value })}
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => removeRubricItem(index, rubricIndex)}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addRubricItem(index, field.numericRange?.min || 0)}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" /> Add Rubric Item
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        <Button onClick={addField} variant="outline">Add Field</Button>
      </div>

      {/* Display Columns section */}
      <div>
        <h3 className="text-sm font-medium mb-2">Display Columns</h3>
        
        {/* Available Columns */}
        <div className="mb-4">
          <h4 className="text-xs text-gray-500 mb-2">Available Columns</h4>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {availableColumns.map((column) => (
              <div 
                key={column.path} 
                className="flex items-center gap-2 p-2 hover:bg-gray-100 rounded cursor-pointer border-2 border-blue-200"
                onClick={() => toggleColumn(column)}
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleColumn(column)}
                  className="cursor-pointer"
                />
                <span className="flex-1 cursor-pointer">
                  <div className="text-sm font-medium">{column.label}</div>
                  <div className="text-xs text-gray-500">{column.path}</div>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Columns with drag-drop and column configuration */}
        <div className="mt-4">
          <h4 className="text-xs text-gray-500 mb-2">Selected Columns (drag to reorder)</h4>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="selected-columns">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {selectedColumns.map((column, index) => (
                    <Draggable 
                      key={column.path} 
                      draggableId={column.path} 
                      index={index}
                    >
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className="flex flex-col gap-2 p-4 bg-white rounded-lg border-2 border-green-200"
                        >
                          {/* Column Header */}
                          <div className="flex items-center justify-between">
                            <span className="flex-1">
                              <div className="text-sm font-medium">{column.label}</div>
                              <div className="text-xs text-gray-500">{column.path}</div>
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleColumn(column)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Column Configuration in Accordion */}
                          <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="config" className="border-none">
                              <AccordionTrigger className="py-2 text-xs text-gray-500 hover:no-underline">
                                Column Configuration
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="space-y-4 mt-2">
                                  {/* Display Title */}
                                  <div className="flex flex-col gap-1.5">
                                    <Label className="text-xs">Display Title</Label>
                                    <Input
                                      value={column.title || ''}
                                      onChange={(e) => updateColumnConfig(index, { 
                                        title: e.target.value 
                                      })}
                                      placeholder="Custom display title"
                                      className="h-8"
                                    />
                                  </div>

                                  {/* Width Selection */}
                                  <div className="flex flex-col gap-1.5">
                                    <Label className="text-xs">Width</Label>
                                    <Select
                                      value={column.width}
                                      onValueChange={(value: ColumnWidth) => updateColumnConfig(index, { 
                                        width: value 
                                      })}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white">
                                      {widthOptions.map(option => (
                                          <SelectItem 
                                            key={option.value} 
                                            value={option.value}
                                          >
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  {/* Font Size Selection */}
                                  <div className="flex flex-col gap-1.5">
                                    <Label className="text-xs">Font Size</Label>
                                    <Select
                                      value={column.fontSize}
                                      onValueChange={(value: FontSize) => updateColumnConfig(index, { 
                                        fontSize: value 
                                      })}
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white">
                                      {fontSizeOptions.map(option => (
                                          <SelectItem 
                                            key={option.value} 
                                            value={option.value}
                                          >
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      </div>
    </div>
  );

  // Clean up editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  // Add new helper function
  const updateColumnConfig = (index: number, updates: Partial<ExpandedColumn>) => {
    const newColumns = [...selectedColumns];
    newColumns[index] = { ...newColumns[index], ...updates };
    setSelectedColumns(newColumns);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="max-w-7xl bg-white max-h-[95vh] flex flex-col">
      <DialogHeader>
        <div className="flex justify-between items-center">
          <DialogTitle>Configure Feedback Template</DialogTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm">Preview Mode</span>
              <Switch
                checked={previewMode}
                onCheckedChange={setPreviewMode}
                className="data-[state=checked]:bg-primary mr-8" 
              />
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="pr-4 pb-4">
            {previewMode ? (
              <div className="space-y-4 p-4 border rounded-lg bg-gray-50">
                {renderPreviewFields()}
              </div>
            ) : (
              renderConfigurationMode()
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Template</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};