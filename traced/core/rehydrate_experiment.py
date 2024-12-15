import asyncio
import json
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from sqlalchemy import select, text
from sqlalchemy.orm import joinedload


from .utils.serialization import serialize_object
from ..backend.database import get_async_session_maker
from .logger_model import Experiment, Row, SpanModel


class ExperimentRehydrator:
    def __init__(self, project_name: str, experiment_name: str):
        """Initialize the rehydrator with experiment name."""
        self.experiment_name = experiment_name
        self.session_maker = get_async_session_maker("research_etl")

    async def extract_variables(
        self,
        variable_specs: List[str],
        limit: Optional[int] = None,
        time_range: Optional[str] = None,
        tags: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Extract specified variables from experiment traces.
        
        Args:
            variable_specs: List of strings in format "function_name::variable_name" or 
                          "function_name::input::variable_name" or
                          "function_name::meta::variable_name"
            limit: Optional limit on number of traces to process
            time_range: Optional time range filter ("1h", "24h", "7d", "30d")
            tags: Optional list of tags to filter by
        
        Returns:
            List of dictionaries containing extracted variables
        """
        # Parse variable specifications
        var_map = {}
        for spec in variable_specs:
            parts = spec.split("::")
            func_name = parts[0]
            if func_name not in var_map:
                var_map[func_name] = {'output': [], 'input': [], 'meta': []}
            
            if len(parts) == 2:
                # Handle function_name::variable_name format (output)
                var_map[func_name]['output'].append(parts[1])
            elif len(parts) == 3:
                # Handle function_name::type::variable_name format
                if parts[1] == 'input':
                    var_map[func_name]['input'].append(parts[2])
                elif parts[1] == 'meta':
                    var_map[func_name]['meta'].append(parts[2])
                elif parts[1] == 'output':
                    var_map[func_name]['output'].append(parts[2])
                else:
                    raise ValueError(f"Invalid variable specification: {spec}")

        # Get experiment traces
        traces = await self.get_experiment_traces(
            limit=limit,
            time_range=time_range,
            tags=tags
        )

        if not traces:
            return []

        # Extract variables from traces
        results = []
        for trace in traces['traces']:
            result = {
                'row_id': trace['row']['id'],
                'created_at': trace['row']['created_at'],
                'variables': {}
            }
            
            # Process spans to extract variables
            for span in self._flatten_spans(trace['spans']):
                if span['name'] in var_map:
                    # Extract output variables
                    output_data = span.get('output_data', {})
                    if output_data is not None:
                        for var_name in var_map[span['name']]['output']:
                            if var_name in output_data:
                                result['variables'][f"{span['name']}::output::{var_name}"] = output_data[var_name]
                    
                    # Extract input variables
                    input_data = span.get('input_data', {})
                    if input_data is not None:
                        for var_name in var_map[span['name']]['input']:
                            if var_name in input_data:
                                result['variables'][f"{span['name']}::input::{var_name}"] = input_data[var_name]
                    
                    # Extract metadata variables
                    metadata = span.get('metadata', {})
                    if metadata is not None:
                        for var_name in var_map[span['name']]['meta']:
                            if var_name in metadata:
                                result['variables'][f"{span['name']}::meta::{var_name}"] = metadata[var_name]

            results.append(result)

        return results

    def _flatten_spans(self, spans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Flatten hierarchical spans into a single list."""
        flattened = []
        for span in spans:
            flattened.append(span)
            if span.get('children'):
                flattened.extend(self._flatten_spans(span['children']))
        return flattened

    async def get_experiment_traces(
        self,
        limit: Optional[int] = None,
        time_range: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Get experiment traces with pagination and optimized queries."""
        async with self.session_maker() as session:
            try:
                # Start with base query
                stmt = (
                    select(Experiment)
                    .join(Row, Row.experiment_id == Experiment.id)
                    .options(
                        joinedload(Experiment.rows)
                        .joinedload(Row.spans),
                        joinedload(Experiment.rows)
                        .joinedload(Row.feedbacks),
                        joinedload(Experiment.rows)
                    )
                    .where(Experiment.name == self.experiment_name)
                )

                # Apply time range filter if specified
                if time_range:
                    time_map = {
                        "1h": timedelta(hours=1),
                        "24h": timedelta(hours=24),
                        "7d": timedelta(days=7),
                        "30d": timedelta(days=30)
                    }
                    cutoff = datetime.utcnow() - time_map[time_range]
                    stmt = stmt.where(Row.created_at >= cutoff)

                # Apply tag filters if specified
                if tags:
                    for tag in tags:
                        stmt = stmt.where(text("JSON_CONTAINS(tags, :tag)")).params(tag=f'"{tag}"')

                if limit is not None:
                    stmt = stmt.limit(limit)

                result = await session.execute(stmt)
                experiment = result.unique().scalar_one_or_none()
                
                if not experiment:
                    return None

                return {
                    'experiment': {
                        'id': experiment.id,
                        'name': experiment.name,
                        'version': experiment.version,
                        'created_at': experiment.created_at,
                        'git_info': experiment.git_repo
                    },
                    'traces': [
                        self._build_trace(row)
                        for row in experiment.rows
                    ]
                }
            except Exception as e:
                import traceback
                traceback.print_exc()
                raise

    def _build_trace(self, row: Row) -> Dict[str, Any]:
        """Build trace structure from row data."""
        return {
            'row': {
                'id': row.id,
                'experiment_id': row.experiment_id,
                'created_at': row.created_at,
                'input_data': row.input_data,
                'output_data': row.output_data,
                'tags': row.tags if row.tags else [],
                'feedback_count': len(row.feedbacks) if row.feedbacks else 0,
                'feedbacks': [{
                    'id': feedback.id,
                    'feedback': feedback.feedback,
                    'feedback_type': feedback.feedback_type,
                    'user_id': feedback.user_id
                } for feedback in row.feedbacks] if row.feedbacks else [],
            },
            'spans': self._build_span_tree(row.spans)
        }

    def _build_span_tree(
        self,
        spans: List[SpanModel],
        parent_id: Optional[str] = None,
        level: int = 0
    ) -> List[Dict[str, Any]]:
        """Build hierarchical span tree with improved efficiency."""
        tree = []
        child_spans = {
            span.id: [s for s in spans if s.parent_id == span.id]
            for span in spans
        }

        for span in [s for s in spans if s.parent_id == parent_id]:
            span_info = {
                'id': span.id,
                'name': span.name,
                'duration': f"{span.duration:.3f}s" if span.duration else 'N/A',
                'level': level,
                'metadata': span.meta_info,
                'input_data': span.input_data,
                'output_data': span.output_data,
                'error': span.error,
                'children': self._build_span_tree(
                    child_spans.get(span.id, []),
                    span.id,
                    level + 1
                )
            }
            tree.append(span_info)

        return tree


# Example usage
async def main():
    # Initialize rehydrator
    rehydrator = ExperimentRehydrator("apeiron_enterprise", "enterprise_sleep_gap_analysis")
    
    # Define variables to extract
    variables = [
        "gap_analysis::meta::client_id",
        "gap_analysis::output::gap_analysis",
    ]
    # "gap_analysis::input::afi",
    
    # Extract variables from last 24 hours of traces
    results = await rehydrator.extract_variables(
        variable_specs=variables,
        time_range="24h",
        limit=10
    )
    results = serialize_object(results)
    # print(results)
    # Print results
    # save to file
    with open("extracted_variables.json", "w") as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    asyncio.run(main())