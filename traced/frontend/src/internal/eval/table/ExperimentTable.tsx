import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  ColumnFiltersState,
  getFilteredRowModel,
  ColumnSizingState,
  ColumnOrderState,
} from '@tanstack/react-table';
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

import { getNestedValue } from '@/internal/eval/utils/nestUtils';
import { dateFilterFn, numberFilterFn, stringFilterFn } from "@/internal/eval/filters/filters";
import { GlobalFilter } from "@/internal/eval/filters/GlobalFilter";
import { SortButton } from "@/internal/eval/filters/SortButton";
import { Row, ExpandedColumn, ExperimentTableProps, Span } from '@/types/eval';

const MAX_CELL_WIDTH = 400;
const MIN_CELL_WIDTH = 50;
const DEFAULT_CHAR_WIDTH = 8;
const CELL_PADDING = 20;
const MIN_TABLE_WIDTH = 800;
const DEFAULT_TABLE_WIDTH = 2000;

const hasError = (row: Row): boolean => {
  const checkSpanForError = (span: Span): boolean => {
    if (span.error) return true;
    
    if (span.children && span.children.length > 0) {
      return span.children.some((childSpan: Span) => checkSpanForError(childSpan));
    }
    
    return false;
  };

  return row.spans?.some((span: Span) => checkSpanForError(span)) ?? false;
};

// Add this type guard function
const isNumericString = (value: string): boolean => {
  if (typeof value !== 'string') return false;
  return !isNaN(Number(value)) && !isNaN(parseFloat(value));
};

// Update getColumnDataType to handle type inference and conversion
const getColumnDataType = (column: ExpandedColumn | string, rows: Row[]): 'number' | 'date' | 'string' => {
  // Special handling for known columns
  if (typeof column === 'string') {
    switch (column) {
      case 'feedback_count':
      case 'feedback_assigned':
        return 'number';
      case 'tags':
        return 'string';
      default:
        break;
    }
  }

  // Get raw values for the column
  const values = rows.map(row => {
    const value = typeof column === 'string' 
      ? (row as any)[column]
      : getNestedValue(row, column.path);
    return value;
  }).filter(value => value !== null && value !== undefined && value !== '');

  if (values.length === 0) return 'string';

  // Check if all values are numeric strings
  const allNumeric = values.every(value => isNumericString(String(value)));
  if (allNumeric) return 'number';

  // Check for dates
  const allDates = values.every(value => {
    const date = new Date(value);
    return !isNaN(date.getTime());
  });
  if (allDates) return 'date';

  return 'string';
};


export const ExperimentTable: React.FC<ExperimentTableProps> = ({
  rows,
  loading,
  onRowClick,
  expandedColumns,
  selectedRows,
  onRowSelect,
  rowsPerPage = 10,
  rowHeight = 48,
  wrapText: initialWrapText = false,
  feedbackGrouping,
  onFilteredRowsChange,
}) => {
  const [globalFilter, setGlobalFilter] = useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [page, setPage] = useState(0);
  const [currentRowsPerPage, setCurrentRowsPerPage] = useState(rowsPerPage);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(false);
  const [wrapTextState, setWrapTextState] = useState(initialWrapText);
  const [isSnapped, setIsSnapped] = useState(false);
  const [tableWidth, setTableWidth] = useState(DEFAULT_TABLE_WIDTH);
  const resizeRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [currentRowHeight, setCurrentRowHeight] = useState(rowHeight);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [isColumnResizing, setIsColumnResizing] = useState(false);

  const columnHelper = createColumnHelper<any>();

  /**
   * Generates the table columns based on expandedColumns and feedbackGrouping.
   */
  const columns = useMemo(() => {
    // Base columns such as the selection checkbox
    const baseColumns = [
      columnHelper.display({
        id: 'select',
        header: () => (
          <div className="flex justify-center">
            <Checkbox
              checked={
                table.getRowModel().rows.length > 0 &&
                table.getRowModel().rows.every(row => selectedRows.some(r => r.id === row.original.id))
              }
              onCheckedChange={(checked) => {
                // Handle select all for rendered rows
                const renderedRows = table.getRowModel().rows.map(row => row.original);
                renderedRows.forEach(row => {
                  const isSelected = selectedRows.some(r => r.id === row.id);
                  if (checked !== isSelected) {
                    onRowSelect(row);
                  }
                });
              }}
              aria-label="Select all"
              className="h-4 w-4"
            />
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selectedRows.some(r => r.id === row.original.id)}
              onCheckedChange={() => onRowSelect(row.original)}
              aria-label="Select row"
              className="h-4 w-4"
            />
          </div>
        ),
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableColumnFilter: false,
      }),
    ];

    // Generate data columns based on expandedColumns
    const dataColumns = expandedColumns.map((column: ExpandedColumn) => {
      if (column.type !== 'feedback') {
        // **Handling Non-Feedback Columns**
        const dataType = getColumnDataType(column, rows);
        return columnHelper.accessor(
          row => getNestedValue(row, column.path),
          {
            id: column.path,
            header: ({ column: tableColumn }) => (
              <div className="flex items-center space-x-1">
                <span>{column.label.split(' > ').pop()}</span>
                <SortButton column={tableColumn} />
              </div>
            ),
            enableColumnFilter: true,
            filterFn: dataType === 'number'
              ? numberFilterFn
              : dataType === 'date'
                ? dateFilterFn
                : stringFilterFn,
            meta: {
              headerName: column.label,
              dataType: dataType,
            },
            cell: info => {
              const value = info.getValue();
              if (value == null) return 'N/A';
              if (dataType === 'number') return Number(value).toFixed(2);
              if (dataType === 'date') {
                const date = new Date(value);
                date.setHours(date.getHours() - 6); // Subtract 6 hours for EST
                return date.toLocaleString();
              }
              return String(value);
            },
          }
        );
      } else {
        // **Handling Feedback Columns**

        const fieldKey = column.fieldKey as string;
        const feedbackType = column.feedbackType;
        const userId = column.userId;

        // Generate column ID and Label based on feedbackGrouping
        let columnId = '';
        let columnLabel = '';

        switch (feedbackGrouping) {
          case 'none':
            columnId = `${fieldKey}_${userId}_${feedbackType}_individual`;
            columnLabel = `${fieldKey} (${userId}) [${feedbackType}]`;
            break;
          case 'averageByUser':
            columnId = `${fieldKey}_${userId}_average_by_user`;
            columnLabel = `${fieldKey} (${userId}) [Average]`;
            break;
          case 'latestByUser':
            columnId = `${fieldKey}_${userId}_latest_by_user`;
            columnLabel = `${fieldKey} (${userId}) [Latest]`;
            break;
          case 'averageByType':
            columnId = `${fieldKey}_${feedbackType}_average_by_type`;
            columnLabel = `${fieldKey} [${feedbackType}]`;
            break;
          case 'averageByTypeByUser':
            columnId = `${fieldKey}_${userId}_${feedbackType}_average_by_type_by_user`;
            columnLabel = `${fieldKey} (${userId}) [${feedbackType} Average]`;
            break;
          default:
            columnId = `${fieldKey}_${userId}_${feedbackType}_default`;
            columnLabel = `${fieldKey} (${userId}) [${feedbackType}]`;
            break;
        }

        return columnHelper.accessor(
          row => {
            const feedbacks = row.feedbacks || [];
            
            // Filter feedbacks matching the fieldKey, userId, feedbackType
            let matchingFeedbacks = feedbacks.filter((fb: any) => {
              let matches = fb.feedback[fieldKey] !== undefined;

              switch (feedbackGrouping) {
                case 'none':
                  // Match exact feedback by user and type
                  matches = matches && 
                           String(fb.user_id) === String(userId) && 
                           String(fb.feedback_type) === String(feedbackType);
                  break;
                case 'averageByType':
                  // Only match by feedback type (aggregate across users)
                  matches = matches && String(fb.feedback_type) === String(feedbackType);
                  break;
                case 'averageByUser':
                  // Only match by user (aggregate across feedback types)
                  matches = matches && String(fb.user_id) === String(userId);
                  break;
                case 'latestByUser':
                  // Match by user to get their latest feedback
                  matches = matches && String(fb.user_id) === String(userId);
                  break;
                case 'averageByTypeByUser':
                  // Match by both user and type for per-user type averages
                  matches = matches && 
                           String(fb.user_id) === String(userId) && 
                           String(fb.feedback_type) === String(feedbackType);
                  break;
              }

              return matches;
            });

            if (matchingFeedbacks.length === 0) return null;

            // Process the matched feedbacks based on grouping type
            switch (feedbackGrouping) {
              case 'none':
                // Return all matching values
                return matchingFeedbacks.map((fb: any) => fb.feedback[fieldKey]);
              
              case 'averageByType':
              case 'averageByUser':
              case 'averageByTypeByUser':
                // Calculate average for numeric values
                const numericValues = matchingFeedbacks
                  .map((fb: any) => {
                    const value = fb.feedback[fieldKey];
                    if (typeof value === 'string') {
                      const parsed = parseFloat(value);
                      return isNaN(parsed) ? null : parsed;
                    }
                    return typeof value === 'number' ? value : null;
                  })
                  .filter((v: any): v is number => v !== null);

                if (numericValues.length === 0) return null;
                return numericValues.reduce((acc: any, val: any) => acc + val, 0) / numericValues.length;
              
              case 'latestByUser':
                // Sort by timestamp descending and take the first value
                const sortedFeedbacks = [...matchingFeedbacks].sort((a, b) => 
                  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );
                return sortedFeedbacks[0].feedback[fieldKey];

              default:
                return matchingFeedbacks.map((fb: any) => fb.feedback[fieldKey]);
            }
          },
          {
            id: columnId,
            header: ({ column: tableColumn }) => (
              <div className="flex items-center space-x-1">
                <span className="text-blue-600">{columnLabel.split(' > ').pop()}</span>
                <SortButton column={tableColumn} />
              </div>
            ),
            cell: info => {
              const value = info.getValue();

              if (value === null || value === undefined) return 'N/A';

              // Handle different types of values
              if (Array.isArray(value)) {
                if (value.length === 1) {
                  return String(value[0]);
                } else {
                  return (
                    <div className="flex flex-col items-start">
                      {value.map((v, index) => (
                        <span key={index}>{String(v)}</span>
                      ))}
                    </div>
                  );
                }
              } else if (typeof value === 'number') {
                // For averaged values
                return value.toFixed(2);
              } else {
                return String(value);
              }
            },
            filterFn: stringFilterFn,
            meta: {
              headerName: columnLabel,
              dataType: 'string',
            },
          }
        );
      }
    });

    // Combine baseColumns and dataColumns
    return [
      ...baseColumns,
      ...dataColumns,
    ];
  }, [rows, expandedColumns, feedbackGrouping, selectedRows]);

  // Initialize column order when columns change
  useEffect(() => {
    setColumnOrder(columns.map(col => col.id as string));
  }, [columns]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableRowSelection: true,
    enableFilters: true,
    filterFns: {
      dateFilter: dateFilterFn,
      numberFilter: numberFilterFn,
      stringFilter: stringFilterFn,
    },
    state: {
      columnFilters: globalFilter,
      columnSizing,
      columnOrder,
      rowSelection: Object.fromEntries(selectedRows.map((row: Row) => [row.id, true])),
    },
    onColumnOrderChange: setColumnOrder,
  });

  useEffect(() => {
    // Call the callback with the currently filtered rows
    const filteredRows = table.getRowModel().rows.map(row => row.original);
    onFilteredRowsChange?.(filteredRows);
  }, [table.getRowModel().rows, onFilteredRowsChange]);

  const snapColumnsToFit = useCallback(() => {
    if (isSnapped) {
      // Reset to default sizes
      setColumnSizing({});
      setIsSnapped(false);
      return;
    }

    const newColumnSizing: ColumnSizingState = {};

    table.getAllColumns().forEach(column => {
      let maxWidth = 0;

      const headerText = column.columnDef.header
        ? (typeof column.columnDef.header === 'string'
          ? column.columnDef.header
          : column.id)
        : column.id;
      const headerWidth = headerText.length * DEFAULT_CHAR_WIDTH + CELL_PADDING;
      maxWidth = headerWidth;

      table.getRowModel().rows.forEach(row => {
        const cellValue = row.getValue(column.id);
        let cellText = '';

        if (cellValue === null || cellValue === undefined) {
          cellText = 'N/A';
        } else if (Array.isArray(cellValue)) {
          cellValue.forEach(val => {
            const str = String(val);
            if (str.length > cellText.length) {
              cellText = str;
            }
          });
        } else if (typeof cellValue === 'object') {
          cellText = JSON.stringify(cellValue);
        } else {
          cellText = String(cellValue);
        }

        const cellWidth = cellText.length * DEFAULT_CHAR_WIDTH + CELL_PADDING;
        maxWidth = Math.max(maxWidth, cellWidth);
      });

      newColumnSizing[column.id] = Math.min(
        MAX_CELL_WIDTH,
        Math.max(minWidthFromDefinition(column), maxWidth)
      );
    });

    setColumnSizing(newColumnSizing);
    setIsSnapped(true);
  }, [table, isSnapped]);

  const minWidthFromDefinition = (column: any): number => {
    return column.columnDef.minSize || MIN_CELL_WIDTH;
  };

  useEffect(() => {
    if (snapEnabled) {
      snapColumnsToFit();
    }
  }, [snapEnabled, snapColumnsToFit]);

  useEffect(() => {
    setCurrentRowsPerPage(rowsPerPage);
  }, [rowsPerPage]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const container = resizeRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const newWidth = Math.max(MIN_TABLE_WIDTH, e.clientX - containerRect.left);
      setTableWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleDragStart = (e: React.DragEvent, columnId: string) => {
    e.dataTransfer.setData('text/plain', columnId);
    setDraggedColumn(columnId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    const sourceColumnId = e.dataTransfer.getData('text/plain');
    
    if (sourceColumnId === targetColumnId) return;

    const newColumnOrder = [...columnOrder];
    const sourceIndex = newColumnOrder.indexOf(sourceColumnId);
    const targetIndex = newColumnOrder.indexOf(targetColumnId);

    newColumnOrder.splice(sourceIndex, 1);
    newColumnOrder.splice(targetIndex, 0, sourceColumnId);

    setColumnOrder(newColumnOrder);
    setDraggedColumn(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center mb-4 gap-4">
        <div className="flex">
          <Button
            className="h-8 px-0"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft />
          </Button>
          <Button
            className="h-8 px-0 -ml-px"
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * currentRowsPerPage >= table.getRowModel().rows.length}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          {table.getRowModel().rows.length} rows total
        </div>

        <GlobalFilter
          rows={rows}
          columns={columns as any[]}
          setGlobalFilter={setGlobalFilter}
        />

        <Button
          className="h-6 w-6 p-0 m-0"
          onClick={snapColumnsToFit}
          variant="outlined"
          size="small"
          title={isSnapped ? "Reset column widths" : "Fit columns to content"}
        >
          {isSnapped ? "↕" : "↔"}
        </Button>
        <Button
          className="h-6 w-6 pt-0 mt-0"
          onClick={() => setWrapTextState(!wrapTextState)}
          variant="outlined"
          size="small"
          title={wrapTextState ? "Disable text wrapping" : "Enable text wrapping"}
        >
          ↩
        </Button>
        {/* <Popover>
          <PopoverTrigger asChild>
            <Button
              className="h-6 w-6 pt-0 mt-0"
              variant="outlined"
              size="small"
              title="Adjust row height"
            >
              ↕
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48">
            <div className="flex items-center gap-2 p-2">
              <span className="text-sm text-muted-foreground">Height:</span>
              <Input
                type="number"
                value={heightInputValue}
                onChange={(e) => handleHeightChange(e.target.value)}
                onKeyDown={handleHeightKeyDown}
                className="w-20 h-8"
                min="20"
                step="1"
              />
            </div>
          </PopoverContent>
        </Popover> */}
      </div>

      <div 
        ref={resizeRef}
        className="relative border rounded-md overflow-auto"
        style={{ width: tableWidth }}
      >
        <Table className="table-fixed w-full">
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead
                    key={header.id}
                    className={`relative p-2 text-center border-r border-gray-200 ${
                      draggedColumn === header.id ? 'opacity-50' : ''
                    } ${
                      draggedColumn && draggedColumn !== header.id ? 'hover:bg-gray-100' : ''
                    }`}
                    draggable={!isColumnResizing}
                    onDragStart={(e) => {
                      if (isColumnResizing) {
                        e.preventDefault();
                        return;
                      }
                      handleDragStart(e, header.id);
                    }}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, header.id)}
                    style={{
                      width: header.getSize(),
                      minWidth: header.column.columnDef.minSize,
                      maxWidth: header.column.columnDef.maxSize,
                      position: 'relative',
                      overflow: 'hidden',
                      whiteSpace: 'normal',
                      height: currentRowHeight,
                      minHeight: currentRowHeight,
                      maxHeight: currentRowHeight,
                      padding: '8px',
                      cursor: isColumnResizing ? 'col-resize' : 'grab',
                    }}
                  >
                    <div
                      className="font-semibold text-xs flex items-center justify-center h-full overflow-hidden"
                      style={{
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                      }}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                    </div>
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={(e) => {
                          setIsColumnResizing(true);
                          header.getResizeHandler()(e);
                        }}
                        onMouseUp={() => setIsColumnResizing(false)}
                        onMouseLeave={() => setIsColumnResizing(false)}
                        className={`absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-blue-400 transition-colors ${
                          isColumnResizing ? 'bg-blue-500' : 'bg-gray-100'
                        }`}
                        style={{
                          opacity: isColumnResizing ? 1 : 0.5,
                          transform: 'translateX(0%)', // Center the handle on the border
                        }}
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table
              .getRowModel()
              .rows
              .slice(page * currentRowsPerPage, (page + 1) * currentRowsPerPage)
              .map(row => (
                <TableRow
                  key={row.id}
                  className={`cursor-pointer hover:bg-muted/50 ${
                    hasError(row.original) ? 'bg-red-50' : ''
                  }`}
                  onClick={() => onRowClick(row.original)}
                >
                  {row.getVisibleCells().map(cell => (
                    <TableCell
                      key={cell.id}
                      className="p-2 text-center border-r border-gray-200 align-top"
                      style={{
                        width: cell.column.getSize(),
                        minWidth: cell.column.columnDef.minSize,
                        maxWidth: cell.column.columnDef.maxSize,
                        overflow: 'hidden',
                        textOverflow: wrapTextState ? 'clip' : 'ellipsis',
                        whiteSpace: wrapTextState ? 'normal' : 'nowrap',
                        height: currentRowHeight,
                        minHeight: currentRowHeight,
                        maxHeight: currentRowHeight,
                      }}
                    >
                      {cell.column.id === 'select' ? (
                        <div className="flex justify-center items-start" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedRows.some((r: Row) => r.id === (row.original as any).id)}
                            onCheckedChange={() => onRowSelect(row.original)}
                            aria-label="Select row"
                            className="h-4 w-4"
                          />
                        </div>
                      ) : (
                        flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <div
          className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-gray-300 transition-colors"
          onMouseDown={handleMouseDown}
          style={{
            cursor: 'col-resize',
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            backgroundColor: isResizing ? '#718096' : 'transparent',
            transition: 'background-color 0.2s',
          }}
        />
      </div>
    </div>
  );
};