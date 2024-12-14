import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { FilterIcon, RotateCcw, GitBranchIcon, Trash2, AlertTriangle, Copy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3 } from 'lucide-react';
import { Experiment, Row, Span, Project, FeedbackTemplate, ColumnType, ExpandedColumn, FeedbackGrouping } from '@/components/types/eval';
import ExperimentDropdown from './ExperimentDropdown';
import { ExperimentTable } from './table/ExperimentTable';
import { SummaryTab } from './SummaryTab';
import { apiService } from '@/api/axios';
import { SpanPanel } from './span/SpanPanel';
import { ExperimentDashboard } from './Dashboard';
import { AssignFeedbackModal } from './feedback/AssignFeedbackModal';
import { FeedbackTemplateModal } from './feedback/FeedbackTemplateModal';
import { useToast } from '@/hooks/use-toast';
import { PromptPlaygroundModal } from './prompts/PromptPlaygroundModal'; // Import the modal component
import { ScorerModal } from './scorers/ScorerModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { ProjectDropdown } from './ProjectDropdown';
import { PromptHistoryPage } from './prompts/PromptCard';
import { ScorerCard } from './scorers/ScorerCard';
import {getNestedValue} from '@/internal/eval/utils/nestUtils';

export const ExperimentViewer: React.FC = () => {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<Row | null>(null);
  const [expandedColumns, setExpandedColumns] = useState<ExpandedColumn[]>([]);
  const [columnSearch, setColumnSearch] = useState('');
  const [selectedRows, setSelectedRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isPromptPlaygroundOpen, setIsPromptPlaygroundOpen] = useState(false);
  const [isScorerModalOpen, setIsScorerModalOpen] = useState(false);
  const [showDashboard, setShowDashboard] = React.useState(false);
  const [feedbackGrouping, setFeedbackGrouping] = useState<FeedbackGrouping>('none');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<Row | null>(null);
  const [showDeleteExperimentDialog, setShowDeleteExperimentDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [scorers, setScorers] = useState<any[]>([]);
  const [filteredRows, setFilteredRows] = useState<Row[]>([]);
  const [inputDepth, setInputDepth] = useState(2);
  const [outputDepth, setOutputDepth] = useState(2);
  const [metaDepth, setMetaDepth] = useState(2);

	const navigate = useNavigate();
  const { toast } = useToast();

    // Fetch projects on component mount
    useEffect(() => {
      const fetchProjects = async () => {
        try {
          const response = await apiService.get<Project[]>('/projects');
          setProjects(response);
        } catch (error) {
          console.error('Error fetching projects:', error);
          toast({
            title: "Error",
            description: "Failed to fetch projects",
            variant: "destructive",
          });
        }
      };
      fetchProjects();
    }, []);
  
    // Fetch experiments when project changes
    useEffect(() => {
      if (selectedProject) {
        const fetchProjectData = async () => {
          try {
            const [experimentsRes, scorersRes] = await Promise.all([
              apiService.get<Experiment[]>(`/projects/${selectedProject.id}/experiments`),
              apiService.get<any[]>(`/projects/${selectedProject.id}/scorers`)
            ]);
            
            setExperiments(experimentsRes);
            setScorers(scorersRes);
            
            // Only reset selectedExperiment if it's no longer available in the new experiments list
            if (selectedExperiment && !experimentsRes.find(exp => exp.id === selectedExperiment.id)) {
              console.log('Resetting selected experiment');
              setSelectedExperiment(null);
            }
          } catch (error) {
            console.error('Error fetching project data:', error);
            toast({
              title: "Error",
              description: "Failed to fetch project data",
              variant: "destructive",
            });
          }
        };
        fetchProjectData();
      } else {
        setExperiments([]);
        setScorers([]);
      }
    }, [selectedProject]);

  // const fetchExperiments = async () => {
  //   try {
  //     const response = await apiService.get<Experiment[]>('/experiments');
  //     setExperiments(response);
  //     // Only show toast on manual refresh, not on initial load
  //     if (experiments.length > 0) {
  //       toast({
  //         title: "Success",
  //         description: "Experiments refreshed",
  //       });
  //     }
  //   } catch (error) {
  //     console.error('Error fetching experiments:', error);
  //     toast({
  //       title: "Error",
  //       description: "Failed to refresh experiments",
  //       variant: "destructive",
  //     });
  //   }
  // };

  // useEffect(() => {
  //   fetchExperiments();
  // }, []);

  // Modify the existing fetchRows function to be more robust
  const fetchRows = async (experimentId?: string) => {
    const targetExperiment = experimentId || selectedExperiment?.id;
    if (!targetExperiment) return;
    
    setLoading(true);
    try {
      const response = await apiService.get<Row[]>(
        `/experiments/${targetExperiment}/rows?`
      );
      console.log('Fetched rows:', response);
      setRows(response);
    } catch (error) {
      console.error('Error fetching rows:', error);
      toast({
        title: "Error",
        description: "Failed to fetch rows",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAll = async () => {
    if (!selectedProject) {
      toast({
        title: "Warning",
        description: "Please select a project first",
        variant: "destructive",
      });
      return;
    }

    try {
      // Show loading toast
      toast({
        title: "Refreshing",
        description: "Refreshing all data...",
      });

      // Fetch projects, experiments, and rows in parallel
      await Promise.all([
        // Fetch projects
        (async () => {
          const projectsResponse = await apiService.get<Project[]>('/projects');
          setProjects(projectsResponse);
        })(),
        // Fetch experiments for the selected project
        (async () => {
          const experimentsResponse = await apiService.get<Experiment[]>(
            `/projects/${selectedProject.id}/experiments`
          );
          setExperiments(experimentsResponse);
        })(),
        // Fetch rows if there's a selected experiment
        (async () => {
          if (selectedExperiment?.id) {
            await fetchRows(selectedExperiment.id);
          }
        })()
      ]);

      // Show success toast
      toast({
        title: "Success",
        description: "All data refreshed successfully",
      });
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast({
        title: "Error",
        description: "Failed to refresh some data",
        variant: "destructive",
      });
    }
  };
  
  // Fetch rows when experiment changes
  useEffect(() => {
    fetchRows();
  }, [selectedExperiment]);

  // ROW STUFF
  const handleNextRow = () => {
    if (!selectedRow) return;
    const currentIndex = filteredRows.findIndex(row => row.id === selectedRow.id);
    if (currentIndex < filteredRows.length - 1) {
      setSelectedRow(filteredRows[currentIndex + 1]);
    }
  };
  
  const handlePreviousRow = () => {
    if (!selectedRow) return;
    const currentIndex = filteredRows.findIndex(row => row.id === selectedRow.id);
    if (currentIndex > 0) {
      setSelectedRow(filteredRows[currentIndex - 1]);
    }
  };

  const handleRowClick = (row: Row) => {
    setSelectedRow(row);
  };

  const handleRowSelect = (row: Row) => {
    setSelectedRows(prev => {
      const isSelected = prev.some(r => r.id === row.id);
      if (isSelected) {
        return prev.filter(r => r.id !== row.id);
      }
      return [...prev, row];
    });
  };

  // SPAN STUFF
  const closeSpanPanel = () => {
    setSelectedRow(null);
  };

  // COLUMNS: TRICKY!
  const persistentColumns: ExpandedColumn[] = [
    { path: 'created_at', label: 'Created', type: 'info' },
  ];

  const baseRowColumns: ExpandedColumn[] = [
    { path: 'id', label: 'row > Row ID', type: 'info' },
    { path: 'feedback_count', label: 'row > Feedback', type: 'info' },
    { path: 'feedback_assigned', label: 'row > Assigned', type: 'info' },
    { path: 'tags', label: 'row > Tags', type: 'info' },
  ];

  // Update availableFields to include base row columns
  const availableFields = useMemo(() => {
    if (rows.length === 0) return [];
    const fields = new Set<string>();
    const result: ExpandedColumn[] = [];

    // Add base row columns to available fields
    baseRowColumns.forEach(col => {
      const fieldKey = `${col.path}|${col.label}`;
      if (!fields.has(fieldKey)) {
        fields.add(fieldKey);
        result.push(col);
      }
    });

    const processObject = (
      obj: Record<string, any> | string | null | undefined,
      prefix: string,
      label: string,
      type: ColumnType = 'info',
      currentDepth: number = 0,
      maxDepth: number = 2
    ) => {
      // Handle string values directly
      if (typeof obj === 'string') {
        const fieldKey = `${prefix}|${label} > value`;
        if (!fields.has(fieldKey)) {
          fields.add(fieldKey);
          result.push({ 
            path: prefix, 
            label: `${label} > value`,
            type 
          });
        }
        return;
      }

      if (!obj || typeof obj !== 'object' || currentDepth >= maxDepth) return;

      Object.entries(obj).forEach(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const fieldLabel = label ? `${label} > ${key}` : key;
        
        // Add this field
        const fieldKey = `${path}|${fieldLabel}`;
        if (!fields.has(fieldKey)) {
          fields.add(fieldKey);
          result.push({ 
            path, 
            label: fieldLabel,
            type 
          });
        }

        // Recursively process nested objects with depth check
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          processObject(value, path, fieldLabel, type, currentDepth + 1, maxDepth);
        }
      });
    };

    const processSpan = (
      span: Span,
      parentPath: string = '',
      parentLabel: string = '',
      index: number = 0
    ) => {
      const spanLabel = span.name || 'Unnamed Span';
      const basePath = parentPath ? `${parentPath}.children[${index}]` : `spans[${index}]`;
      const baseLabel = parentLabel ? `${parentLabel} > ${spanLabel}` : spanLabel;

      // Process special span properties with their types
      const spanFields = {
        duration: { value: span.duration, type: 'duration' as const },
        error: { value: span.error, type: 'error' as const },
      };

      // Process base span fields with their types
      Object.entries(spanFields).forEach(([key, { value, type }]) => {
        if (value !== undefined) {
          const path = `${basePath}.${key}`;
          const fieldLabel = `${baseLabel} > ${key}`;
          const fieldKey = `${path}|${fieldLabel}`;
          
          if (!fields.has(fieldKey)) {
            fields.add(fieldKey);
            result.push({ 
              path, 
              label: fieldLabel,
              type
            });
          }
        }
      });

      // Process nested objects (with experiment type)
      if (span.input_data) {
        processObject(span.input_data, `${basePath}.input_data`, `${baseLabel} Input`, 'input', 0, inputDepth);
      }
      if (span.output_data) {
        processObject(span.output_data, `${basePath}.output_data`, `${baseLabel} Output`, 'output', 0, outputDepth);
      }
      if (span.meta_info) {
        processObject(span.meta_info, `${basePath}.meta_info`, `${baseLabel} Meta`, 'info', 0, metaDepth);
      }

      // Recursively process children spans
      if (span.children && Array.isArray(span.children)) {
        span.children.forEach((childSpan: Span, childIndex: number) => {
          processSpan(childSpan, basePath, baseLabel, childIndex);
        });
      }
    };

    const fieldUserMap = new Map<string, Set<string>>();

    // Process row-level input and output data
    rows.forEach(row => {
      // Process spans (existing code)
      row.spans?.forEach((span, index) => {
        processSpan(span, '', '', index);
      });
    });

    // Collect all unique feedback field and user combinations
    rows.forEach(row => {
      const feedbacks = row.feedbacks || [];
      feedbacks.forEach(feedback => {
        const userId = feedback.user_id || 'Unknown';
        const feedbackType = feedback.feedback_type || 'Unknown';
        Object.entries(feedback.feedback || {}).forEach(([fieldKey, value]) => {
          const key = `${fieldKey}|${userId}|${feedbackType}`;
          if (!fieldUserMap.has(key)) {
            fieldUserMap.set(key, new Set());
          }
          fieldUserMap.get(key)?.add(userId);
        });
      });
    });
    // Add feedback columns based on the grouping type
    fieldUserMap.forEach((userIds, key) => {
      const [fieldKey, userId, feedbackType] = key.split('|');
      const fieldKeyFull = `feedbacks > ${fieldKey} > ${userId} > ${feedbackType}`;
      const uniquePath = `feedbacks.${feedbackType}.${userId}.${fieldKey}`;

      if (!fields.has(fieldKeyFull)) {
        fields.add(fieldKeyFull);
        result.push({
          path: uniquePath,
          label: `${fieldKey}`,
          type: 'feedback',
          fieldKey: fieldKey,
          userId: userId,
          feedbackType: feedbackType,
        });
      }
    });
    return result;
  }, [rows, selectedExperiment, inputDepth, outputDepth, metaDepth]);

    // Single useEffect to handle expanded columns when experiment changes
    useEffect(() => {
      if (selectedExperiment) {
        // Get schema columns from the experiment's schema_template
        const schemaColumns = (selectedExperiment.schema_template?.columns || []).map(path => {
          // Try to find existing label from availableFields
          const existingField = availableFields.find(field => field.path === path);
          if (existingField) {
            return existingField;
          }
          // Fallback to generating a label
          const label = path.split('.').map(part => 
            part.charAt(0).toUpperCase() + part.slice(1)
          ).join(' > ');
          return { path, label, type: 'info' as const };
        });
  
        // Get currently selected feedback columns
        const selectedFeedbackColumns = expandedColumns.filter(col => col.type === 'feedback');
        
        // Get currently selected base columns
        const selectedBaseColumns = expandedColumns.filter(col => 
          baseRowColumns.some(baseCol => baseCol.path === col.path)
        );
      
        // Combine columns, ensuring no duplicates
        const allColumns = [...persistentColumns];
        
        // Add schema columns
        schemaColumns.forEach(col => {
          if (!allColumns.some(existing => existing.path === col.path)) {
            allColumns.push(col);
          }
        });
        
        // Add back selected base columns
        selectedBaseColumns.forEach(col => {
          if (!allColumns.some(existing => existing.path === col.path)) {
            allColumns.push(col);
          }
        });
        
        // Add back selected feedback columns
        selectedFeedbackColumns.forEach(col => {
          if (!allColumns.some(existing => existing.path === col.path)) {
            allColumns.push(col);
          }
        });
        setExpandedColumns(allColumns);
      }
    }, [selectedExperiment, availableFields]);
  
  const feedbackFields = availableFields.filter(field => field.type === 'feedback');
  const areAllFeedbackFieldsSelected = feedbackFields.every(field =>
    expandedColumns.some(col => col.fieldKey === field.fieldKey)
  );

  const handleColumnChange = async (field: ExpandedColumn, checked: boolean) => {
    const newColumns = checked 
      ? [...expandedColumns, field]
      : expandedColumns.filter(col => col.path !== field.path);
    
    setExpandedColumns(newColumns);
    
    // Only save schema for non-feedback columns
    if (selectedExperiment && field.type !== 'feedback') {
      try {
        const schemaColumns = newColumns
          .filter(col => col.type !== 'feedback')
          .map(c => c.path);
          
        await apiService.put(
          `/experiments/${selectedExperiment.id}/schema`,
          { columns: schemaColumns }
        );
      } catch (error) {
        console.error('Failed to save schema:', error);
        setExpandedColumns(expandedColumns);
      }
    }
  };
  const groupedFields = useMemo(() => {
    const groups: Record<string, ExpandedColumn[]> = {};
    availableFields.forEach(field => {
      let groupName: string;
      if (field.type === 'feedback') {
        groupName = 'Feedback Fields';
      } else {
        const parts = field.label.split(' > ');
        // Use second-to-last part if it exists, otherwise use first part
        groupName = parts.length > 1 ? parts[parts.length - 2] : parts[0];
      }
      
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(field);
    });
    return groups;
  }, [availableFields]);

  // Update the filteredGroupedFields computation to search both group names and last parts
  const filteredGroupedFields = useMemo(() => {
    if (!columnSearch.trim()) return groupedFields;

    const searchTerm = columnSearch.toLowerCase();
    const filteredGroups: Record<string, ExpandedColumn[]> = {};

    Object.entries(groupedFields).forEach(([groupName, fields]) => {
      // Check if group name matches
      if (groupName.toLowerCase().includes(searchTerm)) {
        filteredGroups[groupName] = fields;
      } else {
        // If group name doesn't match, check individual fields' last parts
        const matchingFields = fields.filter(field => {
          const lastPart = field.label.split(' > ').pop()?.toLowerCase() || '';
          return lastPart.includes(searchTerm);
        });

        if (matchingFields.length > 0) {
          filteredGroups[groupName] = matchingFields;
        }
      }
    });

    return filteredGroups;
  }, [groupedFields, columnSearch]);

  const handleSelectAllFeedbackFields = (checked: boolean) => {
    const newColumns = checked
      ? [...expandedColumns, ...feedbackFields.filter(field => !expandedColumns.some(col => col.fieldKey === field.fieldKey))]
      : expandedColumns.filter(col => col.type !== 'feedback');
    setExpandedColumns(newColumns);
  };

  // Add effect to handle experiment selection changes
  useEffect(() => {
    if (selectedExperiment) {
      // Reset state when experiment changes
      setSelectedRow(null);
      setSelectedRows([]);
      setColumnSearch('');
      
      // Fetch fresh data
      fetchRows(selectedExperiment.id);
    }
  }, [selectedExperiment?.id]); // Only trigger on ID change

  const handleReset = async () => {
    if (selectedExperiment) {
      setExpandedColumns(persistentColumns);
      try {
        await apiService.put(
          `/experiments/${selectedExperiment.id}/schema`,
          { columns: persistentColumns.map(c => c.path) }
        );
      } catch (error) {
        console.error('Failed to reset schema:', error);
      }
    }
  };

  const sortFieldsBySelection = (groupedFields: Record<string, ExpandedColumn[]>) => {
    const result: Record<string, ExpandedColumn[]> = {};
    
    // Create "Selected" group first if there are any selected columns
    const selectedFields = Object.values(groupedFields)
      .flat()
      .filter(field => expandedColumns.some(col => col.path === field.path));
      
    if (selectedFields.length > 0) {
      result['Selected'] = selectedFields;
    }
    
    // Add remaining groups and their fields
    Object.entries(groupedFields).forEach(([groupName, fields]) => {
      result[groupName] = fields;
    });
    
    return result;
  };

  // Update the fetch users effect to properly handle axios response
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await apiService.get<string[]>('/all_users');
        // Access the data property from the axios response
        setUsers(response || []);
      } catch (error) {
        console.error('Error fetching users:', error);
        setUsers([]); // Set empty array on error
      }
    };
    fetchUsers();
  }, []);

  // Add this handler for assigning feedback
  const handleAssignFeedback = async (userEmails: string[], assignmentType: string, dueDate?: Date) => {
    if (userEmails.length === 0 || selectedRows.length === 0) return;
    
    if (!selectedExperiment?.feedback_template) {
      toast({
        title: "Template Required",
        description: "Please configure a feedback template before assigning feedback",
        variant: "destructive",
      });
      setIsTemplateModalOpen(true);
      return;
    }
    
    try {
      await apiService.post('/assign_feedback', {
        user_emails: userEmails,
        row_ids: selectedRows.map(row => row.id),
        assignment_type: assignmentType,
        due_date: dueDate ? dueDate.toISOString() : null
      });
      
      setSelectedRows([]);
      toast({
        title: "Success",
        description: "Feedback assignments created successfully",
      });
    } catch (error) {
      console.error('Error assigning feedback:', error);
      toast({
        title: "Error",
        description: "Failed to create feedback assignments",
        variant: "destructive",
      });
    }
  };


  const handleSaveTemplate = async (template: Partial<FeedbackTemplate>) => {
    if (!selectedExperiment?.id) {
      console.error('No selected experiment ID');
      return;
    }
    
    try {
      await apiService.post(
        `/experiments/${selectedExperiment.id}/feedback-template`,
        template
      );

      // Refresh the entire experiment to get updated template
      const updatedExperiment = await apiService.get<Experiment>(
        `/experiments/${selectedExperiment.id}`
      );
      
      setSelectedExperiment(updatedExperiment);
      
      // Refresh rows to get latest feedback data
      fetchRows(selectedExperiment.id);
      
      toast({
        title: "Success",
        description: "Feedback template saved successfully",
      });
    } catch (error) {
      console.error('Failed to save feedback template:', error);
      toast({
        title: "Error",
        description: "Failed to save feedback template",
        variant: "destructive",
      });
    }
  };

  const handleNavigateToFeedback = async () => {
    if (!selectedExperiment || selectedRows.length === 0) return;

    // Check for feedback template
    const feedbackTemplate = selectedExperiment.feedback_template;
    if (!feedbackTemplate) {
      toast({
        title: "Template Required",
        description: "Please configure a feedback template before proceeding",
        variant: "destructive",
      });
      setIsTemplateModalOpen(true);
      return;
    }

    // Create a state object with all necessary information
    const feedbackState = {
      experimentId: selectedExperiment.id,
      experimentName: selectedExperiment.name,
      rows: selectedRows,
      template: {
        columns: feedbackTemplate.display_columns,
        feedbackTemplate: feedbackTemplate,
      },
    };

    navigate("/feedback", { state: feedbackState });
  };

  // Update the handleRunExperiment function
  const handleRunExperiment = async (params: any) => {
    if (!selectedExperiment) {
      toast({
        title: "Error",
        description: "No experiment selected",
        variant: "destructive",
      });
      return;
    }

    // Find the selected rows
    const selectedRowsData = rows.filter(row => 
      params.selectedRowIds.includes(row.id)
    );

    // For each row, create a mapping of variables to their values
    const processedRows = selectedRowsData.map(row => {
      const variables: { [key: string]: any } = {};

      // Extract variable values based on mappings
      Object.entries(params.variableMappings).forEach(([variable, path]) => {
        const value = getNestedValue(row, path as string);
        variables[variable] = value;
      });

      return {
        row_id: row.id,
        variables, // Send the variables object instead of processed prompts
      };
    });

    try {
      await apiService.post('/experiments/run', {
        experiment_id: selectedExperiment.id,
        provider: params.provider,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        model: params.model,
        system_prompt_template: params.systemPrompt, // Send raw template
        user_prompt_template: params.userPrompt,    // Send raw template
        rows: processedRows,
      });

      toast({
        title: "Success",
        description: `Started processing ${processedRows.length} rows`,
      });
    } catch (error) {
      console.error('Error running experiment:', error);
      toast({
        title: "Error",
        description: "Failed to run experiment",
        variant: "destructive",
      });
    }
  };

  const handleRunScorer = async (params: any) => {
    if (!selectedExperiment) {
      toast({
        title: "Error",
        description: "No experiment selected",
        variant: "destructive",
      });
      return;
    }

    // Find the selected rows
    const selectedRowsData = rows.filter(row => 
      params.selectedRowIds.includes(row.id)
    );

    // For each row, create a mapping of variables to their values
    const processedRows = selectedRowsData.map(row => {
      const variables: { [key: string]: any } = {};

      // Extract variable values based on mappings
      Object.entries(params.variableMappings).forEach(([variable, path]) => {
        const value = getNestedValue(row, path as string);
        variables[variable] = value;
      });

      return {
        row_id: row.id,
        variables,
      };
    });

    try {
      await apiService.post('/experiments/run_scorer', {
        experiment_id: selectedExperiment.id,
        scorer_type: params.scorerType,
        prompt_template: params.prompt,        // Send raw template
        python_code: params.pythonCode,
        provider: params.provider,
        model: params.model,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        rows: processedRows,
      });

      toast({
        title: "Success",
        description: `Started scoring ${processedRows.length} rows`,
      });
    } catch (error) {
      console.error('Error running scorer:', error);
      toast({
        title: "Error",
        description: "Failed to run scorer",
        variant: "destructive",
      });
    }
  };

  // Add this function to handle row deletion
  const handleDeleteRow = async (row: Row) => {
    setRowToDelete(row);
    setShowDeleteDialog(true);
  };

  // Add this function to perform the deletion
  const confirmDelete = async () => {
    if (!rowToDelete) return;

    // Show deleting message
    toast({
      title: "Deleting",
      description: "Deleting row...",
    });

    try {
      await apiService.delete(`/rows/${rowToDelete.id}`);
      
      // Remove the row from the local state
      setRows(prev => prev.filter(r => r.id !== rowToDelete.id));
      
      // Clear selected row if it was deleted
      if (selectedRow?.id === rowToDelete.id) {
        setSelectedRow(null);
      }
      
      // Remove from selected rows if present
      setSelectedRows(prev => prev.filter(r => r.id !== rowToDelete.id));
      
      toast({
        title: "Success",
        description: "Row deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting row:', error);
      toast({
        title: "Error",
        description: "Failed to delete row",
        variant: "destructive",
      });
    } finally {
      setShowDeleteDialog(false);
      setRowToDelete(null);
    }
  };

  // Add function to handle experiment deletion
  const handleDeleteExperiment = async () => {
    if (!selectedExperiment) return;

    try {
        // Show deleting message
      toast({
        title: "Deleting",
        description: "Deleting experiment...",
      });
      await apiService.delete(`/experiments/${selectedExperiment.id}`);
      
      // Remove the experiment from the local state
      setExperiments(prev => prev.filter(e => e.id !== selectedExperiment.id));
      
      // Clear selected experiment and related state
      setSelectedExperiment(null);
      setSelectedRow(null);
      setSelectedRows([]);
      setRows([]);
      
      toast({
        title: "Success",
        description: "Experiment deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting experiment:', error);
      toast({
        title: "Error",
        description: "Failed to delete experiment",
        variant: "destructive",
      });
    } finally {
      setShowDeleteExperimentDialog(false);
    }
  };

  // Add the clone handler
  const handleCloneExperiment = async () => {
    if (!selectedExperiment || !cloneName) return;

    // Show submitting message
    toast({
      title: "Submitting",
      description: "Cloning experiment...",
    });

    try {
      const response = await apiService.post(
        `/experiments/${selectedExperiment.id}/clone`,
        { new_name: cloneName }
      );
      
      // Add the new experiment to the list
      setExperiments(prev => [...prev, response as Experiment]);
      
      // Close the dialog first
      setShowCloneDialog(false);
      setCloneName('');
      
      // Show success message
      toast({
        title: "Success",
        description: "Experiment cloned successfully",
      });

      // Optional: Switch to the new experiment
      // This will trigger a single refresh of the rows
      setSelectedExperiment(response as Experiment);
    } catch (error) {
      console.error('Error cloning experiment:', error);
      toast({
        title: "Error",
        description: "Failed to clone experiment",
        variant: "destructive",
      });
    }
  };

  // Update the state initialization to include the selected experiment name when dialog opens
  const handleOpenCloneDialog = () => {
    setCloneName(selectedExperiment?.name + ' (copy)' || '');
    setShowCloneDialog(true);
  };

  return (
    <div className="flex h-screen ml-6 mt-16 overflow-auto">
      <div className="flex-1 flex flex-col">
        <div className="flex-none">
          <Tabs defaultValue="experiments" className="left-0 top-0 w-full">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 mb-2">
                <TabsList className="h-7">
                  <TabsTrigger 
                    value="experiments" 
                    className="text-blue-400 data-[state=active]:bg-blue-400 data-[state=active]:text-white h-7"
                  >
                    Experiments
                  </TabsTrigger>
                  <TabsTrigger 
                    value="prompts" 
                    className="text-blue-400 data-[state=active]:bg-blue-400 data-[state=active]:text-white h-7"
                  >
                    Prompts
                  </TabsTrigger>
                  <TabsTrigger 
                    value="scorers" 
                    className="text-blue-400 data-[state=active]:bg-blue-400 data-[state=active]:text-white h-7"
                  >
                    Scorers
                  </TabsTrigger>
                  <TabsTrigger 
                    value="summary" 
                    className="text-blue-400 data-[state=active]:bg-blue-400 data-[state=active]:text-white h-7"
                  >
                    Summary
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <ProjectDropdown
                    projects={projects}
                    selectedProject={selectedProject}
                    setSelectedProject={setSelectedProject}
                  />
                  <ExperimentDropdown
                    experiments={experiments}
                    selectedExperiment={selectedExperiment}
                    setSelectedExperiment={setSelectedExperiment}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 bg-white z-10"
                    onClick={fetchAll}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  {selectedExperiment && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 bg-white text-red-500 hover:bg-red-50"
                      onClick={() => setShowDeleteExperimentDialog(true)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Experiment
                    </Button>
                  )}
                  {selectedExperiment && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 bg-white"
                      onClick={handleOpenCloneDialog}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Clone
                    </Button>
                  )}
                  <GitBranchIcon className="h-6 w-6 pl-2 text-green-500" />
                  {selectedExperiment && (
                    <>
                      {selectedExperiment.git_branch && selectedExperiment.git_commit && (
                        <span className="text-sm text-mono text-green-500">
                          <strong>{selectedExperiment.git_branch}::{selectedExperiment.git_commit.slice(0, 9)}</strong>
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex flex-col gap-2 mb-2">
              <div className="flex justify-start items-center gap-1">
                <Button 
                  variant="outline"
                  className="h-7 bg-white"
                  disabled={selectedRows.length === 0 || !selectedExperiment?.feedback_template}
                  onClick={handleNavigateToFeedback}
                  title={!selectedExperiment?.feedback_template ? "Please configure feedback template first" : ""}
                >
                  Annotate ({selectedRows.length})
                </Button>
                <Button
                  variant="outline"
                  className="h-7 bg-white"
                  disabled={selectedRows.length === 0 || !selectedExperiment?.feedback_template}
                  onClick={() => setIsAssignModalOpen(true)}
                  title={!selectedExperiment?.feedback_template ? "Please configure feedback template first" : ""}
                >
                  Assign ({selectedRows.length})
                </Button>
                <Button
                  variant="outline"
                  className={`h-7 ${!selectedExperiment?.feedback_template ? 'bg-yellow-100' : ''}`}
                  onClick={() => setIsTemplateModalOpen(true)}
                >
                  {selectedExperiment?.feedback_template ? 'Configure' : 'Configure ⚠️'}
                </Button>
                <Button
                  variant="outline"
                  className="h-7"
                  onClick={() => setIsPromptPlaygroundOpen(true)}
                >
                  Prompts
                </Button>
                <Button
                  variant="outline"
                  className="h-7"
                  onClick={() => setIsScorerModalOpen(true)}
                >
                  Scorers
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-7 ${showDashboard ? 'bg-blue-400 text-white' : ''}`}
                  onClick={() => setShowDashboard(!showDashboard)}
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-7">
                      Feedback Grouping
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuRadioGroup
                      value={feedbackGrouping}
                      onValueChange={(value: string) => setFeedbackGrouping(value as FeedbackGrouping)}
                    >
                      <DropdownMenuRadioItem value="none">None</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="latestByUser">Latest by User</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="averageByUser">Average by User</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="averageByType">Average by Type</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="averageByTypeByUser">Average by Type and User</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-7">
                      Columns <FilterIcon className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent 
                    className="w-96"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                    align="start"
                    side="right"
                    style={{ maxHeight: 'calc(100vh - 200px)' }}
                  >
                    <div className="sticky top-0 bg-white border-b pb-0 p-2">
                    <Input
                        placeholder="Search by span name..."
                        value={columnSearch}
                        onChange={(e) => setColumnSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      <div className="flex justify-between items-center text-sm">
                        <span>Input Depth:</span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setInputDepth(Math.max(1, inputDepth - 1))}
                          >-</Button>
                          <span>{inputDepth}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setInputDepth(inputDepth + 1)}
                          >+</Button>
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span>Output Depth:</span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOutputDepth(Math.max(1, outputDepth - 1))}
                          >-</Button>
                          <span>{outputDepth}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setOutputDepth(outputDepth + 1)}
                          >+</Button>
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span>Meta Depth:</span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMetaDepth(Math.max(1, metaDepth - 1))}
                          >-</Button>
                          <span>{metaDepth}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setMetaDepth(metaDepth + 1)}
                          >+</Button>
                        </div>
                      </div>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto">
                      <DropdownMenuCheckboxItem
                        onCheckedChange={handleReset}
                        className="py-2 break-words"
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="break-words text-red-500">Reset Columns</span>
                          <RotateCcw className="ml-2 h-4 w-4 text-red-500" />
                        </div>
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={areAllFeedbackFieldsSelected}
                        onCheckedChange={(checked) => handleSelectAllFeedbackFields(checked)}
                      >
                        {areAllFeedbackFieldsSelected ? 'Deselect All Feedback Fields' : 'Select All Feedback Fields'}
                      </DropdownMenuCheckboxItem>
                      {Object.entries(sortFieldsBySelection(filteredGroupedFields))
                        .sort((a, b) => {
                          // Always keep "Selected" at the top
                          if (a[0] === "Selected") return -1;
                          if (b[0] === "Selected") return 1;
                          
                          // Put feedback columns next
                          const aIsFeedback = a[0].toLowerCase().includes('feedback');
                          const bIsFeedback = b[0].toLowerCase().includes('feedback');
                          if (aIsFeedback && !bIsFeedback) return -1;
                          if (!bIsFeedback && aIsFeedback) return 1;
                          
                          // For all other entries, maintain their original order by not sorting them
                          return 0;  // This preserves the original order for non-Selected, non-Feedback items
                        })
                        .map(([groupName, fields]) => (
                          <div key={groupName} className="mb-2 px-2">
                            <div className="font-bold py-1 text-blue-500">{groupName}</div>
                            {fields.map((field: ExpandedColumn) => (
                              <DropdownMenuCheckboxItem
                                key={field.path}
                                checked={expandedColumns.some(col => col.path === field.path)}
                                onCheckedChange={(checked) => {
                                  handleColumnChange(field, checked);
                                  setTimeout(() => {
                                    const event = new Event('keydown');
                                    Object.defineProperty(event, 'keyCode', { value: 27 });
                                    document.dispatchEvent(event);
                                  }, 0);
                                }}
                                className="py-2 break-words"
                              >
                                <div className="flex flex-col gap-1 min-w-0">
                                  <span className="break-words font-bold">
                                    {field.label.split(' > ').pop()}
                                  </span>
                                  <span className="text-xs text-muted-foreground break-all">
                                    {field.path}
                                  </span>
                                </div>
                              </DropdownMenuCheckboxItem>
                            ))}
                          </div>
                        ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  className="h-7 bg-white text-red-500 hover:bg-red-50"
                  disabled={selectedRows.length !== 1}
                  onClick={() => selectedRows[0] && handleDeleteRow(selectedRows[0])}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Row
                </Button>
              </div>
            </div>
          {showDashboard && selectedExperiment && (
            <ExperimentDashboard 
                rows={rows}
                expandedColumns={expandedColumns}
                feedbackGrouping={feedbackGrouping}
            />
          )}
          <TabsContent value="experiments">
            <div className="flex-1 overflow-auto pb-10">
              <ExperimentTable
                rows={rows}
                loading={loading}
                onRowClick={handleRowClick}
                expandedColumns={expandedColumns}
                selectedRows={selectedRows}
                onRowSelect={handleRowSelect}
                rowsPerPage={20}
                rowHeight={60}
                wrapText={true}
                feedbackGrouping={feedbackGrouping}
                onFilteredRowsChange={setFilteredRows}
              />
            </div>
          </TabsContent>
          <TabsContent value="prompts">
            <div className="flex flex-wrap gap-4 p-4">
                <PromptHistoryPage
                  projectId={selectedProject?.id || ''}
                />
            </div>
          </TabsContent>
          <TabsContent value="scorers">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {scorers.map((scorer) => (
                <ScorerCard
                  key={scorer.id}
                  name={scorer.name}
                  type={scorer.type}
                  metaInfo={scorer.meta_info}
                  gitInfo={{
                    branch: scorer.git_branch,
                    commit: scorer.git_commit,
                    repo: scorer.git_repo,
                  }}
                  createdAt={scorer.created_at}
                />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="summary">
            <SummaryTab experiments={experiments} />
          </TabsContent>
          </Tabs>
        </div>

      </div>
      {selectedRow && (
          <SpanPanel
          row={selectedRow} 
          onClose={closeSpanPanel}
          onNext={handleNextRow}
          onPrevious={handlePreviousRow}
          hasNext={filteredRows.findIndex(row => row.id === selectedRow.id) < filteredRows.length - 1}
          hasPrevious={filteredRows.findIndex(row => row.id === selectedRow.id) > 0}
          feedbackTemplate={selectedExperiment?.feedback_template}
        />
      )}
      <AssignFeedbackModal
        isOpen={isAssignModalOpen}
        onClose={() => setIsAssignModalOpen(false)}
        users={users}
        selectedRows={selectedRows.length}
        onAssign={handleAssignFeedback}
      />
      <FeedbackTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        expandedColumns={expandedColumns}
        experimentId={selectedExperiment?.id || ''}
        onSave={handleSaveTemplate}
        rows={rows}
        initialTemplate={selectedExperiment?.feedback_template || null}
      />
      <PromptPlaygroundModal
        key={selectedExperiment?.id || 'no-experiment'}
        isOpen={isPromptPlaygroundOpen}
        onClose={() => setIsPromptPlaygroundOpen(false)}
        expandedColumns={expandedColumns}
        selectedRows={selectedRows}
        onRunExperiment={handleRunExperiment}
      />
      <ScorerModal
        isOpen={isScorerModalOpen}
        onClose={() => setIsScorerModalOpen(false)}
        expandedColumns={expandedColumns}
        selectedRows={selectedRows}
        onRunScorer={handleRunScorer}
      />
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the row
              and all its associated data (spans, feedback, etc.).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog 
        open={showDeleteExperimentDialog} 
        onOpenChange={setShowDeleteExperimentDialog}
      >
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="h-5 w-5" />
              Delete Entire Experiment?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This action cannot be undone. This will permanently delete:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>The experiment configuration</li>
                <li>All rows in the experiment</li>
                <li>All spans and their data</li>
                <li>All feedback and annotations</li>
                <li>All associated templates</li>
              </ul>
              <p className="font-semibold mt-4">
                Are you absolutely sure you want to delete{' '}
                {selectedExperiment?.name}?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExperiment}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete Experiment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showCloneDialog} onOpenChange={(open) => {
        if (!open) {
          setCloneName('');  // Reset when dialog closes
        }
        setShowCloneDialog(open);
      }}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Clone Experiment</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a name for the cloned experiment. This will create a new experiment with all the same rows and data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              placeholder="New Experiment Name"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              className="w-full"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowCloneDialog(false);
              setCloneName('');
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCloneExperiment}
              className="bg-blue-500 hover:bg-blue-600"
              disabled={!cloneName}
            >
              Clone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
