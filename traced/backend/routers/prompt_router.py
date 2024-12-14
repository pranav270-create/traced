import difflib
from typing import List, Dict, Optional, Set, Any, Tuple
import sys
from pathlib import Path
from fastapi import (
    HTTPException,
    Depends,
)
from fastapi.routing import APIRouter
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from traced.core.logger_model import experiment_prompts, Prompt, Scorer
from traced.backend.schemas.eval_schemas import PromptDiff, PromptVersion, PromptHistory, DiffChunk, DiffChange, ChangeType, DiffStats, PromptDiff

from traced.core.sql_db.database import get_db

router = APIRouter()


def process_diff_to_chunks(diff_lines: List[str]) -> List[DiffChunk]:
    chunks: List[DiffChunk] = []
    current_chunk: Optional[DiffChunk] = None
    old_line = 0
    new_line = 0
    
    for line in diff_lines:
        # Start a new chunk when we see a change
        if line.startswith('?'):
            continue
            
        if current_chunk is None:
            current_chunk = DiffChunk(
                old_start=old_line + 1,
                old_lines=0,
                new_start=new_line + 1,
                new_lines=0,
                changes=[]
            )
            
        if line.startswith('+'):
            new_line += 1
            current_chunk.new_lines += 1
            current_chunk.changes.append(DiffChange(
                type=ChangeType.ADD,
                content=line[2:],
                new_line_number=new_line
            ))
        elif line.startswith('-'):
            old_line += 1
            current_chunk.old_lines += 1
            current_chunk.changes.append(DiffChange(
                type=ChangeType.DELETE,
                content=line[2:],
                old_line_number=old_line
            ))
        else:
            old_line += 1
            new_line += 1
            current_chunk.old_lines += 1
            current_chunk.new_lines += 1
            current_chunk.changes.append(DiffChange(
                type=ChangeType.CONTEXT,
                content=line[2:],
                old_line_number=old_line,
                new_line_number=new_line
            ))
            
        # Finish chunk after context lines
        if len(current_chunk.changes) >= 7:  # Adjustable context size
            chunks.append(current_chunk)
            current_chunk = None
            
    if current_chunk and current_chunk.changes:
        chunks.append(current_chunk)
        
    return chunks


def compute_diff_stats(diff_lines: List[str]) -> DiffStats:
    additions = sum(1 for line in diff_lines if line.startswith('+'))
    deletions = sum(1 for line in diff_lines if line.startswith('-'))
    return DiffStats(
        additions=additions,
        deletions=deletions,
        changes=additions + deletions
    )


def compute_prompt_diff(
    old_version: 'PromptVersion',
    new_version: 'PromptVersion'
) -> PromptDiff:
    """Compute structured diff between versions."""
    differ = difflib.Differ()
    diff = list(differ.compare(
        old_version.prompt_text.splitlines(True),
        new_version.prompt_text.splitlines(True)
    ))
    
    return PromptDiff(
        chunks=process_diff_to_chunks(diff),
        stats=compute_diff_stats(diff),
        versions={
            'from': old_version.version,
            'to': new_version.version
        }
    )


@router.get("/projects/{project_id}/prompts")
async def get_project_prompts(
    project_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[Dict[str, Any]]:
    """Get all prompts for a specific project."""
    try:
        # Modified query to include experiment associations
        query = (
            select(
                Prompt,
                func.group_concat(experiment_prompts.c.experiment_id).label('experiment_ids')
            )
            .filter(Prompt.project_id == project_id)
            .outerjoin(experiment_prompts)  # Use outer join to include prompts without experiments
            .group_by(Prompt.id)
            .order_by(Prompt.created_at.desc())
        )
        result = await db.execute(query)
        rows = result.all()

        return [
            {
                "id": row.Prompt.id,
                "name": row.Prompt.name,
                "prompt_text": row.Prompt.prompt_text,
                "variables": row.Prompt.variables,
                "source_info": row.Prompt.source_info,
                "git_branch": row.Prompt.git_branch,
                "git_commit": row.Prompt.git_commit,
                "git_repo": row.Prompt.git_repo,
                "created_at": row.Prompt.created_at,
                "updated_at": row.Prompt.updated_at,
                # Convert comma-separated string to list, handle None case
                "experiment_ids": (
                    row.experiment_ids.split(',')
                    if row.experiment_ids is not None 
                    else []
                )
            }
            for row in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/prompts/history")
async def get_project_prompts_history(
    project_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[PromptHistory]:
    """Get the history of all prompts in a project, grouped by name and source file."""
    try:
        # Modified query to include experiment associations
        query = (
            select(
                Prompt,
                func.group_concat(experiment_prompts.c.experiment_id).label('experiment_ids')
            )
            .filter(Prompt.project_id == project_id)
            .outerjoin(experiment_prompts)
            .group_by(Prompt.id)
            .order_by(Prompt.name, Prompt.created_at)
        )
        result = await db.execute(query)
        rows = result.all()

        # Group prompts by name and source file
        prompt_groups: Dict[Tuple[str, str], List[Tuple[Prompt, str]]] = {}
        for row in rows:
            key = (row.Prompt.name, row.Prompt.source_info.get('file', ''))
            if key not in prompt_groups:
                prompt_groups[key] = []
            prompt_groups[key].append((
                row.Prompt,
                row.experiment_ids.split(',') if row.experiment_ids else []
            ))

        # Create history for each prompt
        histories: List[PromptHistory] = []
        for (name, source_file), group in prompt_groups.items():
            # Sort versions by creation date
            versions = sorted(group, key=lambda p: p[0].created_at)

            # Convert to PromptVersion objects
            prompt_versions = [
                PromptVersion(
                    id=p[0].id,
                    version=idx + 1,
                    prompt_text=p[0].prompt_text,
                    variables=p[0].variables or [],
                    git_commit=p[0].git_commit,
                    git_branch=p[0].git_branch,
                    created_at=p[0].created_at,
                    source_info=p[0].source_info or {},
                    experiment_ids=p[1]  # Add experiment_ids to PromptVersion
                )
                for idx, p in enumerate(versions)
            ]

            # Create history object
            history=PromptHistory(
                name=name,
                current_version=prompt_versions[-1],
                versions=prompt_versions,
                diffs=None
            )
            histories.append(history)
        return histories
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/prompts/{prompt_name}/diff")
async def get_prompt_version_diff(
    project_id: str,
    prompt_name: str,
    from_version: int,
    to_version: int,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> PromptDiff:
    """Get the diff between two specific versions of a prompt."""
    try:
        # Get the specified versions
        query = (
            select(Prompt)
            .filter(
                Prompt.project_id == project_id,
                Prompt.name == prompt_name
            )
            .order_by(Prompt.created_at)
        )
        result = await db.execute(query)
        prompts = result.scalars().all()

        if not prompts:
            raise HTTPException(status_code=404, detail="Prompt not found")

        # Sort and validate version numbers
        versions = sorted(prompts, key=lambda p: p.created_at)
        if from_version < 1 or to_version > len(versions) or from_version >= to_version:
            raise HTTPException(
                status_code=400,
                detail="Invalid version numbers"
            )

        # Convert to PromptVersion objects
        old_version = PromptVersion(
            id=versions[from_version - 1].id,
            version=from_version,
            prompt_text=versions[from_version - 1].prompt_text,
            variables=versions[from_version - 1].variables or [],
            git_commit=versions[from_version - 1].git_commit,
            git_branch=versions[from_version - 1].git_branch,
            created_at=versions[from_version - 1].created_at,
            source_info=versions[from_version - 1].source_info or {}
        )

        new_version = PromptVersion(
            id=versions[to_version - 1].id,
            version=to_version,
            prompt_text=versions[to_version - 1].prompt_text,
            variables=versions[to_version - 1].variables or [],
            git_commit=versions[to_version - 1].git_commit,
            git_branch=versions[to_version - 1].git_branch,
            created_at=versions[to_version - 1].created_at,
            source_info=versions[to_version - 1].source_info or {}
        )

        # Compute and return diff
        return compute_prompt_diff(old_version, new_version)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/scorers")
async def get_project_scorers(
    project_id: str,
    db: AsyncSession = Depends(get_db("research_etl"))
) -> List[Dict[str, Any]]:
    """Get all scorers for a specific project."""
    try:
        query = (
            select(Scorer)
            .filter(Scorer.project_id == project_id)
            .order_by(Scorer.created_at.desc())
        )
        result = await db.execute(query)
        scorers = result.scalars().all()

        return [
            {
                "id": scorer.id,
                "name": scorer.name,
                "type": scorer.type,
                "meta_info": scorer.meta_info,
                "git_branch": scorer.git_branch,
                "git_commit": scorer.git_commit,
                "git_repo": scorer.git_repo,
                "created_at": scorer.created_at,
                "updated_at": scorer.updated_at
            }
            for scorer in scorers
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
