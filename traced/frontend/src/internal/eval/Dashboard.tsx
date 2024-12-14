import React, { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, RotateCcw, X } from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  AreaChart,
  Legend,
  Rectangle,
} from 'recharts';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from '@/components/ui/carousel';

import { getNestedValue } from '@/internal/eval/utils/nestUtils';
import { getFeedbackValue } from '@/internal/eval/utils/feedbackUtils';
import { Row, ExpandedColumn } from '@/types/eval';

interface ProcessedFeedbackColumn {
  type: 'feedback';
  fieldKey: string;
  userId: string | number;
  feedbackType: string;
  grouping: string;
  label: string;
  value: string; // The constructed column ID
  path: string;
}

interface ProcessedRegularColumn {
  type: 'regular';
  path: string;
  label: string;
}

type ProcessedColumn = ProcessedFeedbackColumn | ProcessedRegularColumn;

const PLOT_WIDTH = 800;
const PLOT_HEIGHT = 300;
const MARGIN = { top: 20, right: 30, bottom: 30, left: 40 };
const AXIS_STYLE = {
  fontSize: 10,
  tickSize: 8,
};

type PlotType = 'histogram' | 'bar-grouped' | 'bar-stacked' | 'bar-biaxial' | 'line' | 'scatter' | 'distribution';

interface Plot {
  id: string;
  type: PlotType;
  series: PlotSeries[];
  title: string;
  xLabel?: string;
  yLabel?: string;
  bins?: number;
}

interface PlotSeries {
  name: string;
  columns: string[];
  groupBy?: string[];
  color?: string;
  opacity?: number;
  embed?: boolean[];
}

interface ExperimentDashboardProps {
  rows: Row[];
  expandedColumns: ExpandedColumn[];
  feedbackGrouping: string;
}

const calculateDy = (label: string = '') => {
  const baseOffset = 10; // minimum offset
  const charOffset = 3; // additional offset per character
  return baseOffset + label.length * charOffset;
};

// Helper function to get embeddings (placeholder)
const getEmbeddings = (data: any[]) => {
  // You need to implement API calls to get embeddings from the backend
  // For now, let's just return random numbers
  return data.map(() => Math.random());
};

// Add color palette
const COLOR_PALETTE = [
  '#8884d8',
  '#82ca9d',
  '#ffc658',
  '#ff7300',
  '#d88484',
  '#8dd1e1',
  '#a4de6c',
  '#d0ed57'
];

export const ExperimentDashboard = ({ 
  rows, 
  expandedColumns, 
  feedbackGrouping = 'none' 
}: ExperimentDashboardProps) => {
  const [plots, setPlots] = React.useState<Plot[]>([]);
  const [isConfiguring, setIsConfiguring] = React.useState(false);
  const [currentPlot, setCurrentPlot] = React.useState<Partial<Plot>>({});
  const [processedColumns, setProcessedColumns] = useState<ProcessedColumn[]>([]);

  // Process columns when component mounts or feedbackGrouping changes
  useEffect(() => {
    const processColumns = () => {
      const processed: ProcessedColumn[] = [];

      expandedColumns.forEach(column => {
        if (column.type !== 'feedback') {
          // Handle regular columns
          processed.push({
            type: 'regular',
            path: column.path,
            label: column.label
          });
        } else {
          // Handle feedback columns
          const { fieldKey, userId, feedbackType } = column;
          
          // Generate column ID based on grouping
          let value = '';
          let label = '';
          
          switch (feedbackGrouping) {
            case 'none':
              value = `${fieldKey}_${userId}_${feedbackType}_individual`;
              label = `${fieldKey} (${userId}) [${feedbackType}]`;
              break;
            case 'averageByUser':
              value = `${fieldKey}_${userId}_average_by_user`;
              label = `${fieldKey} (${userId}) [Average]`;
              break;
            case 'latestByUser':
              value = `${fieldKey}_${userId}_latest_by_user`;
              label = `${fieldKey} (${userId}) [Latest]`;
              break;
            case 'averageByType':
              value = `${fieldKey}_${feedbackType}_average_by_type`;
              label = `${fieldKey} [${feedbackType}]`;
              break;
            case 'averageByTypeByUser':
              value = `${fieldKey}_${userId}_${feedbackType}_average_by_type_by_user`;
              label = `${fieldKey} (${userId}) [${feedbackType} Average]`;
              break;
            default:
              value = `${fieldKey}_${userId}_${feedbackType}_default`;
              label = `${fieldKey} (${userId}) [${feedbackType}]`;
              break;
          }

          processed.push({
            type: 'feedback',
            fieldKey: fieldKey || '',
            userId: userId || '',
            feedbackType: feedbackType || '',
            grouping: feedbackGrouping,
            label,
            value,
            path: column.path
          });
        }
      });

      setProcessedColumns(processed);
    };

    processColumns();
  }, [expandedColumns, feedbackGrouping]);


  const processGroupedData = (rows: Row[], series: PlotSeries) => {
    // Ensure series.groupBy exists and has valid values
    const validGroupBy = series.groupBy?.filter(group => group && group !== '_none') || [];
    
    if (!validGroupBy.length) {
      return [{ groupName: '', data: rows }];
    }

    // Convert the reduced object to array format expected by the rest of the code
    const groupedData = Object.entries(rows.reduce((acc, row) => {
      const groupKeys = validGroupBy.map(groupColumn => {
        const column = processedColumns.find(col => col.path === groupColumn);
        return column ? String(getValue(row, column)) : '';
      }).filter(Boolean);
      
      const groupKey = groupKeys.join(' - ');
      
      if (!acc[groupKey]) {
        acc[groupKey] = [];
      }
      acc[groupKey].push(row);
      return acc;
    }, {} as Record<string, Row[]>)).map(([groupName, data]) => ({
      groupName,
      data
    }));

    return groupedData;
  };
  
  const calculateHistogramData = (
    rows: Row[],
    series: PlotSeries,
    bins: number
  ) => {
    let isDateData = false;
  
  const values = rows
  .map(row => {
    let column;
    const columnPath = series.columns[0];

    column = processedColumns.find(col => col.path === columnPath);
    const value = column ? getValue(row, column) : undefined;
    
    if (value && value instanceof Date) {
      isDateData = true;
      return value.getTime();
    }
    
    if (typeof value === 'string') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}|^\d{4}\/\d{2}\/\d{2}|^\w{3}\s\w{3}\s\d{2}/;
      if (dateRegex.test(value)) {
        const dateValue = new Date(value);
        if (!isNaN(dateValue.getTime())) {
          isDateData = true;
          return dateValue.getTime();
        }
      }
      return parseFloat(value);
    }
    
    return value;
  })
    .filter(value => value !== null && value !== undefined && !isNaN(value as number)) as number[];

    if (values.length === 0) return [];
  
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / bins;
  
    // Create bins using center points
    const histogramBins = Array.from({ length: bins }, (_, i) => {
      const binStart = min + i * binWidth;
      const binCenter = binStart + binWidth / 2;
      
      return {
        x: isDateData ? new Date(binCenter).toISOString() : binCenter,
        binWidth: binWidth,
        count: 0,
      };
    });
  
    // Fill bins
    values.forEach(value => {
      const binIndex = Math.min(
        Math.floor((value - min) / binWidth),
        bins - 1
      );
      if (binIndex >= 0 && binIndex < histogramBins.length) {
        histogramBins[binIndex].count++;
      }
    });
  
    return histogramBins;
  };

  // Update the getValue function to handle both types
  const getValue = (row: any, column: string | ProcessedColumn) => {
    if (typeof column === 'string') {
      return getNestedValue(row, column);
    }

    if (column.type === 'regular') {
      return getNestedValue(row, column.path);
    }

    // Handle feedback column
    return getFeedbackValue(
      row,
      column.fieldKey,
      column.userId,
      column.feedbackType,
      column.grouping as any
    );
  };

  // Update data processing functions
  const processXYData = (rows: Row[], series: PlotSeries) => {
    if (!series.columns || series.columns.length < 2) return [];
    
    const groupedData = processGroupedData(rows, series);
    
    return groupedData.map(group => {
      const xyData = group.data.map(row => {
        const xColumn = processedColumns.find(col => col.path === series.columns[0]);
        const yColumn = processedColumns.find(col => col.path === series.columns[1]);
        return {
          x: getValue(row, xColumn as string | ProcessedColumn),
          y: getValue(row, yColumn as string | ProcessedColumn),
          groupName: group.groupName
        };
      }).filter(d => d.x !== undefined && d.y !== undefined);

      return {
        groupName: group.groupName,
        data: xyData
      };
    });
  };

const lightenColor = (color: string, percent: number): string => {
  const num = parseInt(color.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;

  return "#" + (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 1 ? 0 : B) : 255)
  ).toString(16).slice(1);
};
  const handleAddPlot = () => {
    setIsConfiguring(true);
    setCurrentPlot({
      id: crypto.randomUUID(),
      type: 'histogram',
      series: [],
      title: '',
      bins: 10,
      xLabel: '',
      yLabel: '',
    });
  };

  const handleSavePlot = () => {
    if (currentPlot.type && currentPlot.series?.length) {
      // Set default labels if not provided
      const plot = {
        ...currentPlot,
        title: currentPlot.title || `Plot ${plots.length + 1}`,
        xLabel: currentPlot.xLabel || 'X-Axis',
        yLabel: currentPlot.yLabel || 'Y-Axis',
      } as Plot;

      setPlots(prev => [...prev, plot]);
      setIsConfiguring(false);
      setCurrentPlot({});
    }
  };

  const handleEmbedToggle = (seriesIndex: number, index: number, embed: boolean) => {
    setCurrentPlot(prev => {
      const newSeries = [...(prev.series || [])];
      const series = { ...newSeries[seriesIndex] };
      const newEmbed = [...(series.embed || [])];
      newEmbed[index] = embed;
      series.embed = newEmbed;
      newSeries[seriesIndex] = series;
      return { ...prev, series: newSeries };
    });
  };

  const updateSeries = (
    seriesIndex: number,
    field: keyof PlotSeries,
    value: any
  ) => {
    console.log(value);
    setCurrentPlot(prev => {
      const newSeries = [...(prev.series || [])];
      if (!newSeries[seriesIndex]) {
        newSeries[seriesIndex] = {
          name: `Series ${seriesIndex + 1}`,
          columns: [],
          groupBy: [],
          color: COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length],
          opacity: 1,
          embed: [],
        };
      }
      
      // Special handling for groupBy
      if (field === 'groupBy') {
        const currentGroupBy = [...(newSeries[seriesIndex].groupBy || [])];
        if (Array.isArray(value)) {
          // If value is already an array, use it directly
          newSeries[seriesIndex] = {
            ...newSeries[seriesIndex],
            groupBy: value.filter(v => v !== '_none'),
          };
        } else if (value === '_none') {
          // If value is '_none', clear the grouping
          newSeries[seriesIndex] = {
            ...newSeries[seriesIndex],
            groupBy: [],
          };
        } else {
          // If it's a single value, add it to existing groupBy
          newSeries[seriesIndex] = {
            ...newSeries[seriesIndex],
            groupBy: [value],
          };
        }
      } else {
        newSeries[seriesIndex] = {
          ...newSeries[seriesIndex],
          [field]: value,
        };
      }
      
      return { ...prev, series: newSeries };
    });
  };

  const handleAddSeries = () => {
    setCurrentPlot(prev => {
      const newSeriesIndex = (prev.series?.length || 0);
      return {
        ...prev,
        series: [
          ...(prev.series || []),
          {
            name: `Series ${newSeriesIndex + 1}`,
            columns: [],
            groupBy: [],
            color: COLOR_PALETTE[newSeriesIndex % COLOR_PALETTE.length],
            opacity: 1,
            embed: [],
          },
        ],
      };
    });
  };

  const getPlotComponent = (plot: Plot) => {
    if (plot.type === 'distribution') {
      const bins = plot.bins || 10;
      
      const seriesData = plot.series.map(series => {
        const groupedData = processGroupedData(rows, series);
        return groupedData.map(group => {
          const histData = calculateHistogramData(group.data, series, bins);
          return {
            name: `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`,
            color: series.color || '#8884d8',
            opacity: series.opacity || 0.5,
            data: histData
          };
        });
      }).flat();

      // Combine all histogram data into a single dataset
      const combinedData = seriesData[0].data.map((bin, index) => {
        const combined: any = { x: bin.x };
        seriesData.forEach(series => {
          combined[series.name] = series.data[index].count;
        });
        return combined;
      });

      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <AreaChart
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            data={combinedData}
            margin={MARGIN}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              tickFormatter={value => {
                if (typeof value === 'number') {
                  return value.toFixed(2);
                }
                return String(value);
              }}
              style={AXIS_STYLE}
            />
            <YAxis
              label={{
                value: plot.yLabel,
                angle: -90,
                position: 'insideLeft',
                offset: -2,
                dy: calculateDy(plot.yLabel),
                fontSize: 10
              }}
              style={AXIS_STYLE}
            />
            <Tooltip />
            <Legend />
            {seriesData.map((series) => (
              <Area
                key={series.name}
                type="monotone"
                dataKey={series.name}
                name={series.name}
                stroke={series.color}
                fill={series.color}
                fillOpacity={series.opacity}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </div>
      );
    }

    if (plot.type === 'histogram') {
      const bins = plot.bins || 10;
      
      // Process all series data
      const seriesData = plot.series.map(series => {
        const groupedData = processGroupedData(rows, series);
        return groupedData.map(group => {
          const histData = calculateHistogramData(group.data, series, bins);
          return {
            name: `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`,
            color: series.color || '#8884d8',
            opacity: series.opacity || 0.5,
            data: histData
          };
        });
      }).flat();

      // Combine all histogram data into a single dataset
      const combinedData = seriesData[0].data.map((bin, index) => {
        const combined: any = { x: bin.x };
        seriesData.forEach(series => {
          combined[series.name] = series.data[index].count;
        });
        return combined;
      });

      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <BarChart 
            width={PLOT_WIDTH} 
            height={PLOT_HEIGHT} 
            data={combinedData}
            margin={MARGIN}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              style={AXIS_STYLE}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              label={{ 
                value: plot.yLabel,
                angle: -90, 
                position: 'insideLeft',
                offset: -2,
                dy: calculateDy(plot.yLabel),
                fontSize: 10
              }}
              style={AXIS_STYLE}
              tick={{ fontSize: 10 }}
            />
            <Tooltip />
            <Legend 
              wrapperStyle={{ paddingTop: '10px' }}
              height={36}
            />
            {seriesData.map((series) => (
              <Bar 
                key={series.name}
                dataKey={series.name}
                name={series.name}
                fill={series.color}
                fillOpacity={series.opacity}
              />
            ))}
          </BarChart>
        </div>
      );
    }

    if (plot.type === 'bar-grouped') {
      const allData: any[] = [];
      const seenXValues = new Set<string>();

      // Process data for each series
      plot.series.forEach(series => {
        const xyData = processXYData(rows, series);
        
        xyData.forEach(({ data, groupName }) => {
          data.forEach(point => {
            const xValue = String(point.x);
            seenXValues.add(xValue);
            
            // Find or create data point
            let dataPoint = allData.find(d => d.x === xValue);
            if (!dataPoint) {
              dataPoint = { x: xValue };
              allData.push(dataPoint);
            }

            // Add value to data point
            const key = `${series.name}${groupName ? ` (${groupName})` : ''}`;
            dataPoint[key] = point.y;
          });
        });
      });

      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <BarChart
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            data={allData}
            margin={MARGIN}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              style={AXIS_STYLE}
            />
            <YAxis
              label={{
                value: plot.yLabel,
                angle: -90,
                position: 'insideLeft',
                offset: -2,
                dy: calculateDy(plot.yLabel),
                fontSize: 10
              }}
              style={AXIS_STYLE}
            />
            <Tooltip />
            <Legend />
            {plot.series.map((series, seriesIndex) => {
              const groupedData = processGroupedData(rows, series);
              return groupedData.map((group, groupIndex) => {
                const key = `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`;
                const colorIndex = (seriesIndex * groupedData.length + groupIndex) % COLOR_PALETTE.length;
                const barColor = series.color || COLOR_PALETTE[colorIndex];
                const activeColor = lightenColor(barColor, 20); // You'll need to implement this helper
                
                return (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={barColor}
                    opacity={series.opacity || 1}
                    activeBar={
                      <Rectangle
                        fill={activeColor}
                        stroke={barColor}
                      />
                    }
                  />
                );
              });
            })}
          </BarChart>
        </div>
      );
    }

    if (plot.type === 'bar-stacked') {
      const allData: any[] = [];
      const seenXValues = new Set<string>();
    
      // Process data for each series
      plot.series.forEach(series => {
        const groupedData = processGroupedData(rows, series);
        
        groupedData.forEach(({ data, groupName }) => {
          data.forEach(row => {
            const xColumn = processedColumns.find(col => col.path === series.columns[0]);
            const yColumn = processedColumns.find(col => col.path === series.columns[1]);
            
            const x = xColumn ? getValue(row, xColumn) : undefined;
            const y = yColumn ? getValue(row, yColumn) : undefined;
            
            const xValue = String(x);
            seenXValues.add(xValue);
            
            // Find or create data point
            let dataPoint = allData.find(d => d.x === xValue);
            if (!dataPoint) {
              dataPoint = { x: xValue };
              allData.push(dataPoint);
            }
    
            // Add value to data point
            const key = `${series.name}${groupName ? ` (${groupName})` : ''}`;
            dataPoint[key] = typeof y === 'string' ? parseFloat(y) : y;
          });
        });
      });
    
      // Sort data points by x value
      allData.sort((a, b) => {
        const aX = parseFloat(a.x);
        const bX = parseFloat(b.x);
        return isNaN(aX) || isNaN(bX) ? a.x.localeCompare(b.x) : aX - bX;
      });
    
      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <BarChart
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            data={allData}
            margin={MARGIN}
          >
            <CartesianGrid />
            <XAxis
              dataKey="x"
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              style={AXIS_STYLE}
            />
            <YAxis
              label={{
                value: plot.yLabel,
                angle: -90,
                position: 'insideLeft',
                offset: -2,
                dy: calculateDy(plot.yLabel),
                fontSize: 10
              }}
              style={AXIS_STYLE}
            />
            <Tooltip />
            <Legend />
            {plot.series.map((series, seriesIndex) => {
              const groupedData = processGroupedData(rows, series);
              return groupedData.map((group, groupIndex) => {
                const key = `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`;
                const colorIndex = (seriesIndex * groupedData.length + groupIndex) % COLOR_PALETTE.length;
                const barColor = COLOR_PALETTE[colorIndex];
                
                return (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={key}
                    fill={barColor}
                    opacity={series.opacity || 1}
                    stackId="stack"
                  />
                );
              });
            })}
          </BarChart>
        </div>
      );
    }

    if (plot.type === 'line') {
      const allData: any[] = [];
      const seenXValues = new Set<string>();
    
      // Process data for each series
      plot.series.forEach(series => {
        const groupedData = processGroupedData(rows, series);
        
        groupedData.forEach(({ data, groupName }) => {
          data.forEach(row => {
            const xColumn = processedColumns.find(col => col.path === series.columns[0]);
            const yColumn = processedColumns.find(col => col.path === series.columns[1]);
            
            const x = xColumn ? getValue(row, xColumn) : undefined;
            const y = yColumn ? getValue(row, yColumn) : undefined;
            
            const xValue = String(x);
            seenXValues.add(xValue);
            
            // Find or create data point
            let dataPoint = allData.find(d => d.x === xValue);
            if (!dataPoint) {
              dataPoint = { x: xValue };
              allData.push(dataPoint);
            }
    
            // Add value to data point
            const key = `${series.name}${groupName ? ` (${groupName})` : ''}`;
            dataPoint[key] = typeof y === 'string' ? parseFloat(y) : y;
          });
        });
      });
    
      // Sort data points by x value
      allData.sort((a, b) => {
        const aX = parseFloat(a.x);
        const bX = parseFloat(b.x);
        return isNaN(aX) || isNaN(bX) ? a.x.localeCompare(b.x) : aX - bX;
      });
    
      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <LineChart
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            data={allData}
            margin={MARGIN}
          >
            <CartesianGrid />
            <XAxis
              dataKey="x"
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              style={AXIS_STYLE}
            />
            <YAxis
              label={{
                value: plot.yLabel,
                angle: -90,
                position: 'insideLeft',
                offset: -2,
                dy: calculateDy(plot.yLabel),
                fontSize: 10
              }}
              style={AXIS_STYLE}
            />
            <Tooltip />
            <Legend />
            {plot.series.map((series, seriesIndex) => {
              const groupedData = processGroupedData(rows, series);
              return groupedData.map((group, groupIndex) => {
                const key = `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`;
                const colorIndex = (seriesIndex * groupedData.length + groupIndex) % COLOR_PALETTE.length;
                const lineColor = COLOR_PALETTE[colorIndex];
                
                return (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={lineColor}
                    strokeWidth={2}
                    opacity={series.opacity || 1}
                    dot={{ fill: lineColor, r: 4 }}
                    activeDot={{ r: 6, stroke: lineColor, strokeWidth: 2 }}
                  />
                );
              });
            })}
          </LineChart>
        </div>
      );
    }

    if (plot.type === 'scatter') {
      // Create a map of group names to colors
      const groupColorMap = new Map();
      let colorIndex = 0;
      
      // Pre-assign colors to all groups
      plot.series.forEach(series => {
        const groupedData = processGroupedData(rows, series);
        console.log(groupedData);
        groupedData.forEach(group => {
          const groupKey = `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`;
          if (!groupColorMap.has(groupKey)) {
            groupColorMap.set(groupKey, COLOR_PALETTE[colorIndex % COLOR_PALETTE.length]);
            colorIndex++;
          }
        });
      });

      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <ScatterChart
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            margin={MARGIN}
          >
            <CartesianGrid />
            <XAxis
              type="number"
              dataKey="x"
              name={plot.xLabel}
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              style={AXIS_STYLE}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={plot.yLabel}
              label={{
                value: plot.yLabel,
                angle: -90,
                position: 'insideLeft',
                offset: -2,
                dy: calculateDy(plot.yLabel),
                fontSize: 10
              }}
              style={AXIS_STYLE}
            />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            {plot.series.map(series => {
              const groupedData = processGroupedData(rows, series);
              
              return groupedData.map((group) => {
                const key = `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`;
                const data = group.data.map(row => {
                  const xColumn = processedColumns.find(col => col.path === series.columns[0]);
                  const yColumn = processedColumns.find(col => col.path === series.columns[1]);
                  
                  const x = xColumn ? getValue(row, xColumn) : undefined;
                  const y = yColumn ? getValue(row, yColumn) : undefined;
                  
                  return {
                    x: typeof x === 'string' ? parseFloat(x) : x,
                    y: typeof y === 'string' ? parseFloat(y) : y
                  };
                }).filter(point => 
                  point.x !== undefined && 
                  point.y !== undefined && 
                  !isNaN(point.x) && 
                  !isNaN(point.y)
                );
                
                return data.length > 0 ? (
                  <Scatter
                    key={key}
                    name={key}
                    data={data}
                    fill={groupColorMap.get(key)}
                    opacity={series.opacity || 1}
                  />
                ) : null;
              }).filter(Boolean);
            })}
          </ScatterChart>
        </div>
      );
    }

    if (plot.type === 'bar-biaxial') {
      const allData: any[] = [];
      const seenXValues = new Set<string>();

      // Process data for each series (limited to 2 series)
      const activeSeries = plot.series.slice(0, 2);

      activeSeries.forEach(series => {
        const groupedData = processGroupedData(rows, series);
        
        groupedData.forEach(({ data, groupName }) => {
          data.forEach(row => {
            const xColumn = processedColumns.find(col => col.path === series.columns[0]);
            const yColumn = processedColumns.find(col => col.path === series.columns[1]);
            
            const x = xColumn ? getValue(row, xColumn) : undefined;
            const y = yColumn ? getValue(row, yColumn) : undefined;
            
            const xValue = String(x);
            seenXValues.add(xValue);
            
            // Find or create data point
            let dataPoint = allData.find(d => d.x === xValue);
            if (!dataPoint) {
              dataPoint = { x: xValue };
              allData.push(dataPoint);
            }

            // Add value to data point
            const key = `${series.name}${groupName ? ` (${groupName})` : ''}`;
            dataPoint[key] = typeof y === 'string' ? parseFloat(y) : y;
          });
        });
      });

      // Sort data by x value for better visualization
      allData.sort((a, b) => {
        const aNum = parseFloat(a.x);
        const bNum = parseFloat(b.x);
        return isNaN(aNum) || isNaN(bNum) ? a.x.localeCompare(b.x) : aNum - bNum;
      });

      return (
        <div className="w-full flex flex-col items-center">
          <h3 className="text-xs font-medium mb-0">{plot.title}</h3>
          <BarChart
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            data={allData}
            margin={MARGIN}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              label={{ value: plot.xLabel, position: 'bottom', offset: 5, fontSize: 10 }}
              style={AXIS_STYLE}
            />
            {activeSeries.map((series, index) => {
              const orientation = index === 0 ? "left" : "right";
              return (
                <YAxis
                  key={`axis-${index}`}
                  yAxisId={orientation}
                  orientation={orientation}
                  label={{
                    value: index === 0 ? plot.yLabel : (series.name || ''),
                    angle: -90,
                    position: 'insideLeft',
                    offset: index === 0 ? -2 : 50,
                    dy: calculateDy(index === 0 ? plot.yLabel : series.name),
                    fontSize: 10
                  }}
                  stroke={series.color || COLOR_PALETTE[index]}
                  style={AXIS_STYLE}
                />
              );
            })}
            <Tooltip />
            <Legend />
            {activeSeries.map((series, index) => {
              const groupedData = processGroupedData(rows, series);
              return groupedData.map(group => {
                const key = `${series.name}${group.groupName ? ` (${group.groupName})` : ''}`;
                return (
                  <Bar
                    key={key}
                    yAxisId={index === 0 ? "left" : "right"}
                    dataKey={key}
                    fill={series.color || COLOR_PALETTE[index]}
                    opacity={series.opacity || 1}
                  />
                );
              });
            })}
          </BarChart>
        </div>
      );
    }

    return <div>Invalid plot configuration</div>;
  };
 
  return (
    <>
    <div className="max-w-[900px] mb-4 ml-24">
        <div className="flex gap-2 mb-2">
          <Button
            onClick={handleAddPlot}
            size="sm"
            className="gap-1 h-7 text-xs"
          >
            <Plus className="h-3 w-3" />
            Add Plot
          </Button>
          <Button
            onClick={() => setPlots([])}
            size="sm"
            className="gap-1 h-7 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </Button>
        </div>

        {isConfiguring && (
          <Card className="p-2 mb-2">
            <div className="space-y-2 text-sm">
              <Select
                onValueChange={(value: PlotType) =>
                  setCurrentPlot(prev => ({
                    ...prev,
                    type: value,
                    series: [],
                    bins: ['histogram', 'distribution'].includes(value) ? 10 : undefined,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select plot type" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="histogram">Histogram</SelectItem>
                  <SelectItem value="distribution">Distribution</SelectItem>
                  <SelectItem value="bar-grouped">Grouped Bar Plot</SelectItem>
                  <SelectItem value="bar-stacked">Stacked Bar Plot</SelectItem>
                  <SelectItem value="bar-biaxial">BiAxial Bar Plot</SelectItem>
                  <SelectItem value="line">Line Plot</SelectItem>
                  <SelectItem value="scatter">Scatter Plot</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="text"
                placeholder="Plot Title"
                value={currentPlot.title || ''}
                onChange={e =>
                  setCurrentPlot(prev => ({ ...prev, title: e.target.value }))
                }
                className="text-sm"
              />

              <Button onClick={handleAddSeries} size="sm">
                Add Series
              </Button>

              {/* Series configuration */}
              {currentPlot.series?.map((series, seriesIndex) => (
                <div key={seriesIndex} className="border p-2 rounded space-y-2">
                  <div className="flex justify-between items-center mb-2">
                    <Input
                      type="text"
                      placeholder="Series Name"
                      value={series.name}
                      onChange={e => updateSeries(seriesIndex, 'name', e.target.value)}
                      className="flex-1 mr-2"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setCurrentPlot(prev => ({
                          ...prev,
                          series: prev.series?.filter((_, i) => i !== seriesIndex)
                        }));
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Column selections based on plot type */}
                  {['histogram', 'distribution'].includes(currentPlot?.type || '') ? (
                    <Select
                      onValueChange={value => updateSeries(seriesIndex, 'columns', [value])}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {expandedColumns.map(col => (
                          <SelectItem key={col.path} value={col.path}>
                            {col.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <>
                      <Select
                        onValueChange={value =>
                          updateSeries(seriesIndex, 'columns', [value, series.columns?.[1] || ''])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select X column" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {expandedColumns.map(col => (
                            <SelectItem key={col.path} value={col.path}>
                              {col.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        onValueChange={value =>
                          updateSeries(seriesIndex, 'columns', [series.columns?.[0] || '', value])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select Y column" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {expandedColumns.map(col => (
                            <SelectItem key={col.path} value={col.path}>
                              {col.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}

                  {currentPlot.type && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Group By (optional)</label>
                      <Select
                        onValueChange={value =>
                          updateSeries(seriesIndex, 'groupBy', value ? [value] : [])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select grouping column" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="_none">None</SelectItem>
                          {expandedColumns.map(col => (
                            <SelectItem key={col.path} value={col.path}>
                              {col.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {series.groupBy?.[0] && (
                        <Select
                          onValueChange={value =>
                            updateSeries(seriesIndex, 'groupBy', 
                              value ? [...(series.groupBy || []).slice(0, 1), value] : [...(series.groupBy || []).slice(0, 1)]
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select second grouping column (optional)" />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            <SelectItem value="_none">None</SelectItem>
                            {expandedColumns.map(col => (
                              <SelectItem key={col.path} value={col.path}>
                                {col.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  {/* Rest of the series configuration (opacity, etc.) */}
                  <div className="flex items-center">
                    <div className="flex items-center gap-2 pr-2">
                      <label>Opacity</label>
                      <span>{series.opacity || 1}</span>
                    </div>
                    <Slider
                      min={0.1}
                      max={1}
                      step={0.1}
                      trackWidth="w-[200px]"
                      trackHeight="h-1"
                      tickHeight="h-1"
                      thumbSize="h-4 w-4"
                      rangeColor="bg-blue-500"
                      tickColor="bg-gray-600"
                      value={[series.opacity || 1]}
                      onValueChange={value => updateSeries(seriesIndex, 'opacity', value[0])}
                    />
                  </div>
                </div>
              ))}

              <Button
                onClick={handleSavePlot}
                size="sm"
                disabled={
                  !currentPlot.type || !currentPlot.series?.length
                }
              >
                Save Plot
              </Button>
            </div>
          </Card>
        )}

        {plots.length > 0 && (
          <Card className="relative mx-auto max-w-[900px]">
            <CardContent className="pt-2">
              <Carousel
                className="w-full relative mx-auto"
                opts={{
                  align: "start",
                  containScroll: "trimSnaps"
                }}
              >
                <CarouselContent>
                  {plots.map(plot => (
                    <CarouselItem key={plot.id} className="basis-full">
                      {getPlotComponent(plot)}
                    </CarouselItem>
                  ))}
                </CarouselContent>
                {plots.length > 1 && (
                  <>
                    <CarouselPrevious className="absolute -left-12 top-1/2 transform -translate-y-1/2" />
                    <CarouselNext className="absolute -right-12 top-1/2 transform -translate-y-1/2" />
                  </>
                )}
              </Carousel>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
};