# src/logger/backend/experiment_router.py
# TODO: Add embedding endpoint with UMAP. Add custom parameters to select by
# TODO: Add keyword endpoint
# TODO: Enable AutoEvaluation
# TODO: Enable Optimization
# TODO: Enable grouping by row / similar input
from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
    WebSocket,
    BackgroundTasks,
    WebSocketDisconnect,
    Query,
    Body,
    Request
)
from fastapi.routing import APIRouter
from sqlalchemy import select, text, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict, Any, Annotated
from datetime import datetime, timedelta
import sys
from pathlib import Path
from uuid import uuid4

sys.path.append(str(Path(__file__).resolve().parents[2]))

from traced.core.logger_model import Experiment, Row, SpanModel, feedback_assignments, FeedbackModel, FeedbackTemplate, Project, Prompt, Scorer
from traced.backend.schemas.eval_schemas import ExperimentSchema, RowSchema, SpanSchema
from traced.backend.database import get_db

router = APIRouter()


@router.get("/experiments")
async def get_experiments(
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[ExperimentSchema]:
    """Get all experiments with their feedback templates that have at least one row."""
    try:
        # Update the query to explicitly load relationships including feedback_template
        query = (
            select(Experiment)
            .join(Row, Experiment.id == Row.experiment_id)  # Join with rows
            .options(
                selectinload(Experiment.rows),  # Explicitly load rows relationship
                selectinload(Experiment.feedback_template),  # Load feedback template
            )
            .group_by(Experiment.id)  # Group by experiment ID
            .having(func.count(Row.id) > 0)  # Ensure at least one row exists
            .order_by(Experiment.created_at.desc())
        )
        result = await db.execute(query)
        experiments = result.scalars().unique().all()

        # Convert to schema before returning
        return [
            ExperimentSchema(
                id=exp.id,
                name=exp.name,
                version=exp.version,
                created_at=exp.created_at,
                meta_info=exp.description,
                schema_template=exp.schema_template,
                git_branch=exp.git_branch,
                git_commit=exp.git_commit,
                git_repo=exp.git_repo,
                feedback_template={
                    "fields": exp.feedback_template.fields,
                    "display_columns": exp.feedback_template.display_columns,
                    "description": exp.feedback_template.description,
                    "created_at": exp.feedback_template.created_at,
                    "updated_at": exp.feedback_template.updated_at
                } if exp.feedback_template else None,
                row_count=len(exp.rows) if exp.rows else 0
            )
            for exp in experiments
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/experiments/{experiment_id}")
async def get_experiment(
    experiment_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> ExperimentSchema:
    """Get a specific experiment by ID."""
    try:
        query = (
            select(Experiment)
            .options(
                selectinload(Experiment.rows),  # Explicitly load rows relationship
                selectinload(Experiment.feedback_template)
            )
            .filter(Experiment.id == experiment_id)
        )
        result = await db.execute(query)
        experiment = result.scalar_one_or_none()

        if not experiment:
            raise HTTPException(status_code=404, detail="Experiment not found")

        return ExperimentSchema(
            id=experiment.id,
            name=experiment.name,
            version=experiment.version,
            created_at=experiment.created_at,
            meta_info=experiment.description,
            schema_template=experiment.schema_template,
            feedback_template={
                "fields": experiment.feedback_template.fields,
                "display_columns": experiment.feedback_template.display_columns,
                "description": experiment.feedback_template.description,
                "created_at": experiment.feedback_template.created_at,
                "updated_at": experiment.feedback_template.updated_at
            } if experiment.feedback_template else None,
            row_count=len(experiment.rows) if experiment.rows else 0
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/experiments/{experiment_id}/rows")
async def get_experiment_rows(
    experiment_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    time_range: Optional[str] = Query(None, regex="^(1h|24h|7d|30d)$"),
    tags: Optional[List[str]] = Query(None),
    sort_by: Optional[str] = Query(None, regex="^(created_at|score)$"),
    sort_order: Optional[str] = Query("desc", regex="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[RowSchema]:
    """Get filtered and paginated rows for an experiment."""
    try:
        # Subquery to count feedback assignments for each row
        assignments_count = (
            select(
                feedback_assignments.c.row_id,
                func.count().label('assignment_count')
            )
            .group_by(feedback_assignments.c.row_id)
            .subquery()
        )

        # Update base query to include feedback data
        query = (
            select(Row, func.coalesce(assignments_count.c.assignment_count, 0).label('assignment_count'))
            .options(
                selectinload(Row.spans),
                selectinload(Row.feedbacks)
            )
            .outerjoin(assignments_count, Row.id == assignments_count.c.row_id)
            .filter(Row.experiment_id == experiment_id)
        )

        # Apply filters
        if time_range:
            time_map = {
                "1h": timedelta(hours=1),
                "24h": timedelta(hours=24),
                "7d": timedelta(days=7),
                "30d": timedelta(days=30)
            }
            cutoff = datetime.utcnow() - time_map[time_range]
            query = query.filter(Row.created_at >= cutoff)

        if tags:
            # MySQL JSON array contains syntax
            for tag in tags:
                query = query.filter(text("JSON_CONTAINS(tags, :tag)")).params(tag=f'"{tag}"')

        # Apply sorting
        if sort_by == "created_at":
            query = query.order_by(
                Row.created_at.desc() if sort_order == "desc" else Row.created_at.asc()
            )

        # Apply pagination
        query = query.offset(skip).limit(limit)

        # Execute query
        result = await db.execute(query)
        rows_with_counts = result.unique().all()
        
        # Create response data before closing the session
        response_data = [
            RowSchema(
                id=row.Row.id,
                experiment_id=row.Row.experiment_id,
                created_at=row.Row.created_at,
                input_data=row.Row.input_data,
                output_data=row.Row.output_data,
                tags=row.Row.tags if row.Row.tags else [],
                spans=build_span_tree(row.Row.spans),
                feedback_count=len(row.Row.feedbacks) if row.Row.feedbacks else 0,
                feedback_assigned=row.assignment_count,
                feedbacks=[{
                    'id': feedback.id,
                    'feedback': feedback.feedback,
                    'feedback_type': feedback.feedback_type,
                    'user_id': feedback.user_id
                } for feedback in row.Row.feedbacks] if row.Row.feedbacks else []
            )
            for row in rows_with_counts
        ]
        
        return response_data

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def build_span_tree(spans: List[SpanModel], parent_id: Optional[str] = None) -> List[SpanSchema]:
    """Recursively build a tree structure from spans."""
    # First, sort spans by start_time
    sorted_spans = sorted(spans, key=lambda x: x.start_time)
    
    tree = []
    for span in sorted_spans:
        if span.parent_id == parent_id:
            children = build_span_tree(sorted_spans, span.id)
            span_info = SpanSchema(
                id=span.id,
                name=span.name,
                type=span.type,
                start_time=span.start_time,
                end_time=span.end_time,
                duration=span.duration,
                meta_info=span.meta_info if span.meta_info else {},
                input_data=span.input_data if span.input_data else {},
                output_data=span.output_data,
                error=span.error,
                model_name=span.model_name,
                latency=span.latency,
                token_count=span.token_count,
                children=children
            )
            tree.append(span_info)
    return tree


@router.put("/experiments/{experiment_id}/schema")
async def update_experiment_schema(
    experiment_id: str,
    schema_template: Dict[str, Any],
    db: AsyncSession = Depends(get_db("research_etl"))
):
    """Update the schema template for a specific experiment."""
    try:
        query = select(Experiment).filter(Experiment.id == experiment_id)
        result = await db.execute(query)
        experiment = result.scalar_one_or_none()

        if not experiment:
            raise HTTPException(status_code=404, detail="Experiment not found")

        experiment.schema_template = schema_template
        await db.commit()

        return {"message": "Schema template updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/rows/{row_id}/spans")
async def get_row_spans(
    row_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[SpanSchema]:
    """Get hierarchical span data for a row."""
    try:
        query = (
            select(SpanModel)
            .filter(SpanModel.row_id == row_id)
            .order_by(SpanModel.start_time)
        )
        result = await db.execute(query)
        spans = result.scalars().all()

        span_dict = {span.id: span for span in spans}
        root_spans = []

        for span in spans:
            if span.parent_id is None:
                root_spans.append(build_span_tree(span, span_dict))

        return root_spans
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rows/{row_id}/tags")
async def update_row_tags(
    row_id: str,
    tags: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db("research_etl"))
) -> Dict[str, Any]:
    """Update tags for a specific row."""
    try:
        # Get the row
        query = select(Row).where(Row.id == row_id)
        result = await db.execute(query)
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Row not found")
        # Update tags
        row.tags = tags['tags']
        # Commit changes
        await db.commit()
        return {"status": "success", "tags": row.tags}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/rows/{row_id}")
async def delete_row(
    row_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> Dict[str, str]:
    """Delete a specific row and its associated data."""
    try:
        # Get the row
        query = select(Row).where(Row.id == row_id)
        result = await db.execute(query)
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Row not found")
        # Delete the row (cascading delete will handle related spans and feedbacks)
        await db.delete(row)
        await db.commit()
        return {"message": f"Row {row_id} deleted successfully"}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/experiments/{experiment_id}")
async def delete_experiment(
    experiment_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> Dict[str, str]:
    """Delete a specific experiment and all its associated data."""
    try:
        async with db.begin():
            # Use no_autoflush to prevent premature flushes
            with db.no_autoflush:
                # Get the experiment with its feedback template
                query = (
                    select(Experiment)
                    .options(selectinload(Experiment.feedback_template))
                    .where(Experiment.id == experiment_id)
                )
                result = await db.execute(query)
                experiment = result.scalar_one_or_none()
                
                if not experiment:
                    raise HTTPException(status_code=404, detail="Experiment not found")
                
                # If there's a feedback template, delete it first
                if experiment.feedback_template:
                    await db.delete(experiment.feedback_template)
                
                # Then delete the experiment
                await db.delete(experiment)
        
        await db.commit()
        
        return {"message": f"Experiment {experiment_id} deleted successfully"}
        
    except Exception as e:
        await db.rollback()
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/experiments/{experiment_id}/clone")
async def clone_experiment(
    experiment_id: str,
    new_name: str = Body(..., embed=True),
    db: AsyncSession = Depends(get_db("research_etl"))
) -> Dict[str, Any]:
    """Clone an experiment and all its rows."""
    try:
        # Get the original experiment with related rows and spans
        query = (
            select(Experiment)
            .options(
                selectinload(Experiment.rows).selectinload(Row.spans)
            )
            .where(Experiment.id == experiment_id)
        )
        result = await db.execute(query)
        original_experiment = result.scalar_one_or_none()

        if not original_experiment:
            raise HTTPException(status_code=404, detail="Experiment not found")

        # Create new experiment with project_id
        new_experiment = Experiment(
            id=str(uuid4()),
            project_id=original_experiment.project_id,
            name=new_name,
            description=original_experiment.description,
            schema_template=original_experiment.schema_template,
            git_branch=original_experiment.git_branch,
            git_commit=original_experiment.git_commit,
            git_repo=original_experiment.git_repo,
            created_at=datetime.utcnow()
        )
        db.add(new_experiment)

        # Clone rows and spans
        for original_row in original_experiment.rows:
            new_row = Row(
                id=str(uuid4()),
                experiment_id=new_experiment.id,
                input_data=original_row.input_data,
                output_data=original_row.output_data,
                tags=original_row.tags,
                created_at=datetime.utcnow()
            )
            db.add(new_row)

            # Clone spans for this row
            for original_span in original_row.spans:
                new_span = SpanModel(
                    id=str(uuid4()),
                    row_id=new_row.id,
                    name=original_span.name,
                    type=original_span.type,
                    parent_id=original_span.parent_id,
                    start_time=original_span.start_time,
                    end_time=original_span.end_time,
                    duration=original_span.duration,
                    meta_info=original_span.meta_info,
                    input_data=original_span.input_data,
                    output_data=original_span.output_data,
                    error=original_span.error,
                    model_name=original_span.model_name,
                    latency=original_span.latency,
                    token_count=original_span.token_count,
                    created_at=datetime.utcnow()
                )
                db.add(new_span)

        await db.commit()

        return {
            "id": new_experiment.id,
            "name": new_experiment.name,
            "description": new_experiment.description,
            "git_branch": new_experiment.git_branch,
            "git_commit": new_experiment.git_commit,
            "git_repo": new_experiment.git_repo,
            "created_at": new_experiment.created_at,
            "schema_template": new_experiment.schema_template,
            "feedback_template": None
        }

    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects")
async def get_projects(
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[Dict[str, Any]]:
    """Get all projects with their experiment counts that have at least one experiment."""
    try:
        # Modified query to only include projects with experiments
        query = (
            select(Project)
            .join(Experiment)  # Join with experiments
            .options(
                selectinload(Project.experiments),
                selectinload(Project.prompts),
                selectinload(Project.scorers)
            )
            .group_by(Project.id)  # Group by project ID
            .having(func.count(Experiment.id) > 0)  # Ensure at least one experiment exists
            .order_by(Project.name)
        )
        result = await db.execute(query)
        projects = result.scalars().unique().all()

        return [
            {
                "id": project.id,
                "name": project.name,
                "description": project.description,
                "experiment_count": len(project.experiments),
                "prompt_count": len(project.prompts),
                "scorer_count": len(project.scorers)
            }
            for project in projects
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/experiments")
async def get_project_experiments(
    project_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[ExperimentSchema]:
    """Get all experiments with rows for a specific project."""
    try:
        query = (
            select(Experiment)
            .filter(Experiment.project_id == project_id)
            .join(Row, Experiment.id == Row.experiment_id)  # Join with rows
            .options(
                selectinload(Experiment.rows),
                selectinload(Experiment.feedback_template)
            )
            .group_by(Experiment.id)  # Group by experiment ID
            .having(func.count(Row.id) > 0)  # Ensure at least one row exists
            .order_by(Experiment.created_at.desc())
        )
        result = await db.execute(query)
        experiments = result.scalars().unique().all()

        return [
            ExperimentSchema(
                id=exp.id,
                name=exp.name,
                version=exp.version,
                created_at=exp.created_at,
                meta_info=exp.description,
                schema_template=exp.schema_template,
                git_branch=exp.git_branch,
                git_commit=exp.git_commit,
                git_repo=exp.git_repo,
                feedback_template={
                    "fields": exp.feedback_template.fields,
                    "display_columns": exp.feedback_template.display_columns,
                    "created_at": exp.feedback_template.created_at,
                    "updated_at": exp.feedback_template.updated_at,
                    "description": exp.feedback_template.description
                } if exp.feedback_template else None,
                row_count=len(exp.rows) if exp.rows else 0
            )
            for exp in experiments
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))