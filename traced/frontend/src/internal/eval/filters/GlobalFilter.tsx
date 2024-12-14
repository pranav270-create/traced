import React, { useState, useMemo, useEffect } from 'react';
import { Column, ColumnFiltersState } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { FilterIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { format, parseISO } from 'date-fns';
import { getNestedValue } from '../utils/nestUtils';

interface GlobalFilterProps<TData> {
  rows: TData[];
  columns: Column<TData, any>[];
  setGlobalFilter: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
}

const formatDateTimeForFilter = (dateStr: string, timeStr: string): string => {
  // Convert "YYYY-MM-DD" and "HH:mm" to "YYYY-MM-DD HH:mm"
  return `${dateStr} ${timeStr}`;
};

export const GlobalFilter = <TData,>({
  rows,
  columns,
  setGlobalFilter,
}: GlobalFilterProps<TData>) => {

  const [open, setOpen] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState<string>('');
  const [filterValue, setFilterValue] = useState<any>('');
  const [operator, setOperator] = useState<string>('');

  // Updated filterableColumns to check enableColumnFilter directly
  const filterableColumns = useMemo(() => {
    const filtered = columns.filter((col) => {
      return (
        col.id !== 'select' &&
        // Check both enableColumnFilter and if the column has required metadata
        (col as any)?.enableColumnFilter !== false &&
        (col as any)?.meta?.dataType
      );
    });
    return filtered;
  }, [columns]);

  // Get column data types
  const columnDataTypes = useMemo(() => {
    // @ts-ignore
    const dataTypes: Record<string, string> = {};
    filterableColumns.forEach((col) => {
      // @ts-ignore
      dataTypes[col.id] = col?.meta?.dataType || 'string';
    });
    return dataTypes;
  }, [filterableColumns]);

  const operators = useMemo(() => {
    const dataType = columnDataTypes[selectedColumnId];

    switch (dataType) {
      case 'number':
        return ['=', '>', '<', '>=', '<='];
      case 'date':
        return ['on', 'before', 'after'];
      case 'string':
      default:
        return ['equals', 'contains'];
    }
  }, [selectedColumnId, columnDataTypes]);

  const [uniqueColumnValues, setUniqueColumnValues] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    const values: Record<string, Set<string>> = {};

    if (rows == null) {
        setUniqueColumnValues(values);
        return;
    }

    if (Array.isArray(rows)) {
      filterableColumns.forEach((col) => {
        if (columnDataTypes[col.id] === 'string') {
          const uniqueValues = new Set<string>();

          rows.forEach((row: any) => {
            // const value = (row as Record<string, any>)[col.id]; // Adjust this line if your data structure is different
            const value = getNestedValue(row, col.id);
            if (value != null) {
              uniqueValues.add(String(value));
            }
          });

          values[col.id] = uniqueValues;
        }
      });
    } else {
      console.error('Rows is not an array:', rows);
    }

    setUniqueColumnValues(values);
  }, [filterableColumns, columnDataTypes, rows]);

  // Add a state to handle time input
  const [timeValue, setTimeValue] = useState<string>('00:00');

  const applyFilter = () => {
    let filterDateTimeValue = filterValue;
    
    if (columnDataTypes[selectedColumnId] === 'date' && filterValue) {
      // Format the date-time value consistently
      filterDateTimeValue = formatDateTimeForFilter(filterValue, timeValue);
    }

    setGlobalFilter((prevFilters) => [
      ...prevFilters.filter((f) => f.id !== selectedColumnId),
      {
        id: selectedColumnId,
        value: {
          operator,
          value: filterDateTimeValue,
        },
      },
    ]);
    setOpen(false);
  };

  const resetFilter = () => {
    setGlobalFilter((prevFilters) =>
      prevFilters.filter((f) => f.id !== selectedColumnId)
    );
    setSelectedColumnId('');
    setFilterValue('');
    setOperator('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-7">
        <FilterIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="p-4 flex flex-col gap-2">
          <Select
            value={selectedColumnId}
            onValueChange={(value) => {
              setSelectedColumnId(value);
              setOperator('');
              setFilterValue('');
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Column" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {filterableColumns.map((col) => (
                <SelectItem key={col.id} value={col.id}>
                  {/* @ts-ignore */}
                  {col.columnDef?.meta?.headerName || col.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedColumnId && (
            <>
              <Select
                value={operator}
                onValueChange={(value) => setOperator(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Operator" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  {operators.map((op) => (
                    <SelectItem key={op} value={op}>
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {columnDataTypes[selectedColumnId] === 'string' ? (
                <>
                  <Select
                    value={filterValue}
                    onValueChange={setFilterValue}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select value" />
                    </SelectTrigger>
                    <SelectContent className="bg-white max-h-[200px]">
                        {Array.from(uniqueColumnValues[selectedColumnId] || [])
                            .sort()
                            .map((value) => (
                            <SelectItem 
                              key={value} 
                              value={value || '(empty)'}
                              className="whitespace-normal break-words"
                            >
                              {value === '' 
                                ? '(empty)' 
                                : typeof value === 'string' && value.length > 200 
                                  ? `${value.slice(0, 300)}...` 
                                  : value}
                            </SelectItem>
                            ))}
                        </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    Or use text input for custom filtering:
                  </div>
                  <Input
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    placeholder="Enter custom value"
                  />
                </>
              ) : columnDataTypes[selectedColumnId] === 'date' ? (
                <div style={{ transform: 'scale(0.8)', transformOrigin: 'top left' }}>
                  <Calendar
                    mode="single"
                    selected={filterValue ? parseISO(filterValue) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        // Set the date part of the filter value
                        setFilterValue(format(date, 'yyyy-MM-dd'));
                      }
                    }}
                    initialFocus
                  />
                  <Input
                    type="time"
                    value={timeValue}
                    onChange={(e) => setTimeValue(e.target.value)}
                    placeholder="HH:mm"
                  />
                </div>
              ) : (
                <Input
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  placeholder="Enter value"
                />
              )}
            </>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={resetFilter}>
              Reset
            </Button>
            <Button
              onClick={applyFilter}
              disabled={!selectedColumnId || !operator}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};