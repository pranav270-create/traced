// frontend/src/components/internal/eval/SummaryTable.tsx

import React, { useEffect, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { ArrowUpIcon, ArrowDownIcon } from 'lucide-react'; // Make sure to import icons
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { Experiment, Row } from '@/types/eval';
import { getNestedValue } from '@/internal/eval/utils/nestUtils';
import { apiService } from '@/api/axios';

interface SummaryTableProps {
  experimentX: Experiment | null;
  experimentY: Experiment | null;
  groupingColumn: string;
}

export const SummaryTable: React.FC<SummaryTableProps> = ({
  experimentX,
  experimentY,
  groupingColumn,
}) => {
  const [data, setData] = useState<any[]>([]);
  const [feedbackFields, setFeedbackFields] = useState<string[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!groupingColumn || (!experimentX && !experimentY)) return;

      // Fetch rows from both experiments
      const rowsX: Row[] = experimentX
        ? await apiService.get<Row[]>(`/experiments/${experimentX.id}/rows`)
        : [];
      const rowsY: Row[] = experimentY
        ? await apiService.get<Row[]>(`/experiments/${experimentY.id}/rows`)
        : [];

      // Identify numeric or binary feedback fields
      const numericFeedbackFields = getNumericFeedbackFields([...rowsX, ...rowsY]);
      setFeedbackFields(numericFeedbackFields);

      // Group data and calculate metrics
      const groupedData = groupDataByColumn(rowsX, rowsY, groupingColumn, numericFeedbackFields);
      setData(groupedData);
    };

    fetchData();
  }, [experimentX, experimentY, groupingColumn]);

  // Function to get numeric or binary feedback fields
  const getNumericFeedbackFields = (rows: Row[]): string[] => {
    const fieldsSet = new Set<string>();
    rows.forEach(row => {
      const feedbacks = row.feedbacks || [];
      feedbacks.forEach(feedback => {
        Object.entries(feedback.feedback || {}).forEach(([fieldKey, value]) => {
          if (typeof value === 'number' || typeof value === 'boolean') {
            fieldsSet.add(fieldKey);
          }
        });
      });
    });
    return Array.from(fieldsSet);
  };

  // Function to group data by the selected column and calculate metrics
  const groupDataByColumn = (
    rowsX: Row[],
    rowsY: Row[],
    column: string,
    feedbackFields: string[]
  ): any[] => {
    const grouped: Record<string, any> = {};

    const processRows = (rows: Row[], experimentLabel: string) => {
      rows.forEach((row) => {
        const key = getNestedValue(row, column) || 'N/A';
        if (!grouped[key]) {
          grouped[key] = { groupingKey: key, feedbacks: {} };
        }
        if (!grouped[key].feedbacks[experimentLabel]) {
          grouped[key].feedbacks[experimentLabel] = {};
        }

        // Aggregate feedback metrics
        const feedbacks = row.feedbacks || [];
        feedbackFields.forEach(fieldKey => {
          feedbacks.forEach(feedback => {
            const value = feedback.feedback?.[fieldKey];
            if (typeof value === 'number' || typeof value === 'boolean') {
              const numericValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
              if (!grouped[key].feedbacks[experimentLabel][fieldKey]) {
                grouped[key].feedbacks[experimentLabel][fieldKey] = [];
              }
              grouped[key].feedbacks[experimentLabel][fieldKey].push(numericValue);
            }
          });
        });
      });
    };

    if (rowsX.length > 0) processRows(rowsX, 'experimentX');
    if (rowsY.length > 0) processRows(rowsY, 'experimentY');
    // Calculate average metrics
    Object.values(grouped).forEach(group => {
      ['experimentX', 'experimentY'].forEach(expLabel => {
        const expFeedbacks = group.feedbacks[expLabel];
        if (expFeedbacks) {
          Object.entries(expFeedbacks).forEach(([fieldKey, values]) => {
            if (Array.isArray(values)) {
              const sum = values.reduce((acc: number, val: number) => acc + val, 0);
              const avg = sum / values.length;
              expFeedbacks[fieldKey] = avg;
            }
          });
        }
      });
    });

    return Object.values(grouped);
  };

  // Define columns for the table
  const columnHelper = createColumnHelper<any>();
  const columns = [
    columnHelper.accessor('groupingKey', {
      header: 'Group',
      cell: (info) => info.getValue(),
    }),
    ...feedbackFields.map(fieldKey =>
      columnHelper.accessor((row) => row, {
        id: fieldKey,
        header: fieldKey,
        cell: ({ row }) => renderMetricCell(row.original, fieldKey),
      })
    ),
  ];

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const renderMetricCell = (groupData: any, fieldKey: string) => {
    const feedbackX = groupData.feedbacks.experimentX?.[fieldKey];
    const feedbackY = groupData.feedbacks.experimentY?.[fieldKey];

    if (feedbackX == null && feedbackY == null) return 'N/A';

    const delta = (feedbackY ?? 0) - (feedbackX ?? 0);
    const isImprovement = delta > 0;
    // const isRegression = delta < 0;

    return (
      <div className="flex items-center">
        <span>{(feedbackY ?? 'N/A').toFixed(2)}</span>
        {delta !== 0 && (
          <span className={`ml-2 ${isImprovement ? 'text-green-500' : 'text-red-500'}`}>
            {isImprovement ? <ArrowUpIcon className="inline-block" /> : <ArrowDownIcon className="inline-block" />}
            {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="my-4">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};