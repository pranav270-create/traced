# backend/schemas.py
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Union
from datetime import datetime
from uuid import uuid4
from enum import Enum


class AttachmentSchemaCreate(BaseModel):
    span_id: str
    filename: str
    content_type: str
    url: str
    meta_info: Optional[Dict[str, Any]] = None


class AttachmentSchema(AttachmentSchemaCreate):
    id: str = Field(default_factory=lambda: str(uuid4()))

    class Config:
        from_attributes = True


class SpanSchemaCreate(BaseModel):
    row_id: str
    name: str
    parent_id: Optional[str]
    start_time: float
    end_time: Optional[float] = None
    duration: Optional[float] = None
    metadata: Optional[Dict[str, Any]] = None
    input_data: Optional[Dict[str, Any]] = None
    output_data: Optional[Any] = None
    expected: Optional[Any] = None
    error: Optional[str] = None
    model_name: Optional[str] = None
    latency: Optional[float] = None
    token_count: Optional[int] = None


class SpanSchema(BaseModel):
    id: str
    name: str
    type: Optional[str] = None
    start_time: float
    end_time: Optional[float] = None
    duration: Optional[float] = None
    meta_info: Optional[Dict[str, Any]] = Field(default_factory=dict)
    input_data: Optional[Any] = None
    output_data: Optional[Any] = None
    error: Optional[str] = None
    model_name: Optional[str] = None
    latency: Optional[float] = None
    token_count: Optional[int] = None
    children: List['SpanSchema'] = Field(default_factory=list)

    class Config:
        from_attributes = True


class FeedbackSchemaCreate(BaseModel):
    feedback: Dict[str, Any]
    feedback_type: Optional[str] = None
    user_id: Optional[Union[str, int]] = None


class FeedbackTemplateCreate(BaseModel):
    experiment_id: str
    description: Optional[str] = None
    walkthrough: Optional[str] = None
    fields: List[dict]
    display_columns: List[Any]


class AssignmentType(str, Enum):
    REQUIRED = "required"
    POOL = "pool"


class FeedbackAssignment(BaseModel):
    user_emails: List[str]
    row_ids: List[str]
    assignment_type: AssignmentType
    due_date: Optional[datetime] = None


class FeedbackSchema(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    feedback_type: Optional[str] = None
    feedback: Dict[str, Any]
    user_id: Optional[Union[str, int]] = None

    class Config:
        from_attributes = True


class RowSchema(BaseModel):
    id: str
    experiment_id: str
    created_at: datetime
    input_data: Optional[Any] = None
    output_data: Optional[Any] = None
    tags: Optional[List[str]] = Field(default_factory=list)
    spans: List[SpanSchema] = Field(default_factory=list)
    feedback_count: int = 0
    feedback_assigned: int = 0
    feedbacks: List[FeedbackSchema] = Field(default_factory=list)

    class Config:
        from_attributes = True


class ExperimentSchema(BaseModel):
    id: str
    name: str
    version: int
    created_at: datetime
    meta_info: Optional[str] = None
    schema_template: Optional[Dict[str, Any]] = None
    feedback_template: Optional[Dict[str, Any]] = None
    row_count: int = 0
    git_branch: Optional[str] = None
    git_commit: Optional[str] = None
    git_repo: Optional[str] = None

    class Config:
        from_attributes = True


class PromptVersion(BaseModel):
    id: str
    version: int
    prompt_text: str
    variables: List[str]
    git_commit: Optional[str]
    git_branch: Optional[str]
    created_at: datetime
    source_info: Dict[str, Any]
    experiment_ids: List[str] = []  # Add this field


class ChangeType(str, Enum):
    ADD = 'add'
    DELETE = 'delete'
    CONTEXT = 'context'


class DiffChange(BaseModel):
    type: ChangeType
    content: str
    old_line_number: Optional[int] = None
    new_line_number: Optional[int] = None


class DiffChunk(BaseModel):
    old_start: int
    old_lines: int
    new_start: int
    new_lines: int
    changes: List[DiffChange]


class DiffStats(BaseModel):
    additions: int
    deletions: int
    changes: int


class PromptDiff(BaseModel):
    chunks: List[DiffChunk]
    stats: DiffStats
    versions: Dict[str, int]


class PromptHistory(BaseModel):
    """Represents the complete history of a prompt."""
    name: str
    current_version: PromptVersion
    versions: List[PromptVersion]
    diffs: Optional[List[PromptDiff]] = None
