# backend/models.py
from sqlalchemy import Column, String, Float, DateTime, JSON, ForeignKey, Text, Integer, Table, Enum, func
from sqlalchemy.orm import relationship
from datetime import datetime
from sqlalchemy.orm import DeclarativeBase
import uuid
from sqlalchemy.orm import relationship, backref, validates
from sqlalchemy import Index
import enum
import sys
from pathlib import Path
from sqlalchemy import DECIMAL
from enum import Enum as PyEnum
from typing import TypedDict, Literal, Dict, Any, Optional as Opt
from pydantic import BaseModel, Field
import json

sys.path.append(str(Path(__file__).resolve().parents[2]))


class Base(DeclarativeBase):
    pass


class AbstractBase(Base):
    __abstract__ = True  # SQLAlchemy needs to know this method is abstract

    @classmethod
    def bytes_to_int(field: bytes):
        return int.from_bytes(field, "little")


class Project(AbstractBase):
    """
    Project model representing a collection of experiments and prompts.
    """
    __tablename__ = 'projects'

    id = Column(String(36), primary_key=True)
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)

    # Relationships
    experiments = relationship('Experiment', back_populates='project', cascade='all, delete-orphan')
    prompts = relationship('Prompt', back_populates='project', cascade='all, delete-orphan')
    scorers = relationship('Scorer', back_populates='project', cascade='all, delete-orphan')

    def __repr__(self):
        return f"<Project(name='{self.name}', id='{self.id}')>"


class Experiment(AbstractBase):
    """
    Experiment model representing a collection of related rows with versioning support.
    """
    __tablename__ = 'experiments'

    id = Column(String(36), primary_key=True)
    project_id = Column(String(36), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    version = Column(Integer, nullable=False, default=1)
    git_branch = Column(String(255), nullable=True)
    git_commit = Column(String(255), nullable=True)
    git_repo = Column(String(255), nullable=True)
    schema_template = Column(JSON, nullable=True)
    dashboard_template = Column(JSON, nullable=True)

    # Relationships
    rows = relationship('Row', back_populates='experiment', cascade='all, delete-orphan')
    feedback_template = relationship(
        'FeedbackTemplate',
        back_populates='experiment',
        uselist=False,
        cascade="all, delete-orphan"
    )
    project = relationship('Project', back_populates='experiments')
    scorers = relationship('Scorer', back_populates='experiments', secondary='experiment_scorers')
    prompts = relationship('Prompt', back_populates='experiments', secondary='experiment_prompts')

    def __repr__(self):
        return f"<Experiment(name='{self.name}', version={self.version}, project_id='{self.project_id}')>"


class Prompt(AbstractBase):
    """
    Prompt model representing prompts associated with a project.
    """
    __tablename__ = 'prompts'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    prompt_text = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    hash = Column(String(64), nullable=False)  # SHA256 hash

    # Store extracted variables
    variables = Column(JSON, nullable=True)

    # Store source file information
    source_info = Column(JSON, nullable=True)  # Contains file path, line number, and function

    # Git information (set at storage initialization)
    git_branch = Column(String(255), nullable=True)
    git_commit = Column(String(255), nullable=True)
    git_repo = Column(String(255), nullable=True)

    # Relationships
    project = relationship('Project', back_populates='prompts')
    experiments = relationship('Experiment', back_populates='prompts', secondary='experiment_prompts')
    spans = relationship('SpanModel', secondary='span_prompts', back_populates='prompts')

    def __repr__(self):
        return f"<Prompt(name='{self.name}', id='{self.id}', project_id='{self.project_id}')>"


class Row(AbstractBase):
    """
    Row model representing a single execution or data point within an experiment.
    """
    __tablename__ = 'rows'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    experiment_id = Column(String(36), ForeignKey('experiments.id', ondelete='CASCADE'), nullable=False)
    input_data = Column(JSON)
    output_data = Column(JSON)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    tags = Column(JSON, nullable=True)

    # Relationships
    experiment = relationship('Experiment', back_populates='rows')
    spans = relationship('SpanModel', back_populates='row', cascade='all, delete-orphan')
    feedbacks = relationship('FeedbackModel', back_populates='row', cascade='all, delete-orphan')

    def __repr__(self):
        return f"<Row(id='{self.id}', experiment_id='{self.experiment_id}')>"


class SpanModel(AbstractBase):
    """
    SpanModel representing a timing/tracing span within a row execution.
    """
    __tablename__ = 'spans'

    id = Column(String(36), primary_key=True)
    row_id = Column(String(36), ForeignKey('rows.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=True)
    parent_id = Column(String(36), ForeignKey('spans.id', ondelete='CASCADE'), nullable=True)
    start_time = Column(DECIMAL(20, 6), nullable=False)
    end_time = Column(DECIMAL(20, 6), nullable=True)
    duration = Column(DECIMAL(20, 6), nullable=True)
    meta_info = Column(JSON, nullable=True)
    input_data = Column(JSON, nullable=True)
    output_data = Column(JSON, nullable=True)
    expected = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    model_name = Column(String(255), nullable=True)
    latency = Column(Float, nullable=True)
    token_count = Column(Integer, nullable=True)

    # Relationships
    row = relationship('Row', back_populates='spans')
    parent = relationship('SpanModel', remote_side=[id], back_populates='children')
    children = relationship('SpanModel', back_populates='parent', cascade='all, delete-orphan')
    prompts = relationship('Prompt', secondary='span_prompts', back_populates='spans')
    attachments = relationship('AttachmentModel', back_populates='span', cascade='all, delete-orphan')  # Changed from 'row'

    def __repr__(self):
        return f"<Span(name='{self.name}', row_id='{self.row_id}', parent_id='{self.parent_id}')>"


class AttachmentModel(AbstractBase):
    """
    AttachmentModel representing files or data attached to a row.
    """
    __tablename__ = 'attachments'

    id = Column(String(36), primary_key=True)
    span_id = Column(String(36), ForeignKey('spans.id', ondelete='CASCADE'), nullable=False)  # Changed from row_id
    filename = Column(String(255), nullable=False)
    content_type = Column(String(255), nullable=False)
    url = Column(String(1024), nullable=False)
    meta_info = Column(JSON, nullable=True)

    # Relationships
    span = relationship('SpanModel', back_populates='attachments')  # Changed from 'Span' to 'SpanModel'

    def __repr__(self):
        return f"<Attachment(filename='{self.filename}', span_id='{self.span_id}')>"


class FeedbackModel(AbstractBase):
    """
    FeedbackModel representing user feedback on a specific row.
    """
    __tablename__ = 'feedback'

    id = Column(String(36), primary_key=True)
    row_id = Column(String(36), ForeignKey('rows.id', ondelete='CASCADE'), nullable=False)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow)
    feedback = Column(JSON, nullable=False)
    feedback_type = Column(String(255), nullable=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    llm_id = Column(String(255), nullable=True)
    meta_info = Column(JSON, nullable=True)

    # Relationships
    row = relationship('Row', back_populates='feedbacks')
    user = relationship('User', back_populates='feedbacks')

    def __repr__(self):
        return f"<Feedback(id='{self.id}', row_id='{self.row_id}')>"


class FeedbackTemplate(AbstractBase):
    """
    FeedbackTemplate model for storing feedback configuration per experiment.
    """
    __tablename__ = 'feedback_templates'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    experiment_id = Column(String(36), ForeignKey('experiments.id', ondelete='CASCADE'), nullable=False)
    fields = Column(JSON, nullable=False)
    display_columns = Column(JSON, nullable=False)
    description = Column(Text, nullable=True)
    walkthrough = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    experiment = relationship('Experiment', back_populates='feedback_template')

    def __repr__(self):
        return f"<FeedbackTemplate(experiment_id='{self.experiment_id}')>"


class AssignmentType(str, enum.Enum):
    REQUIRED = "required"
    POOL = "pool"


feedback_assignments = Table(
    'feedback_assignments',
    AbstractBase.metadata,
    Column('id', Integer, primary_key=True),
    Column('user_email', String(255), ForeignKey('users.email')),
    Column('row_id', String(36)),
    Column('assignment_type', Enum(AssignmentType)),
    Column('status', String(50), default='pending'),
    Column('created_at', DateTime, server_default=func.now()),
    Column('due_date', DateTime, nullable=True),
)

# Association table for many-to-many relationship between experiments and scorers
experiment_scorers = Table(
    'experiment_scorers',
    AbstractBase.metadata,
    Column('experiment_id', String(36), ForeignKey('experiments.id', ondelete='CASCADE')),
    Column('scorer_id', String(36), ForeignKey('scorers.id', ondelete='CASCADE')),
    Column('created_at', DateTime, nullable=False, default=datetime.utcnow),
)

# Add this association table before the class definitions
experiment_prompts = Table(
    'experiment_prompts',
    AbstractBase.metadata,
    Column('experiment_id', String(36), ForeignKey('experiments.id', ondelete='CASCADE')),
    Column('prompt_id', String(36), ForeignKey('prompts.id', ondelete='CASCADE')),
    Column('created_at', DateTime, nullable=False, default=datetime.utcnow),
)

# Add new association table
span_prompts = Table(
    'span_prompts',
    AbstractBase.metadata,
    Column('span_id', String(36), ForeignKey('spans.id', ondelete='CASCADE')),
    Column('prompt_id', String(36), ForeignKey('prompts.id', ondelete='CASCADE')),
    Column('created_at', DateTime, nullable=False, default=datetime.utcnow),
)

Index('ix_experiments_name_version', Experiment.name, Experiment.version)
Index('ix_rows_experiment_id', Row.experiment_id)
Index('ix_spans_row_id', SpanModel.row_id)
Index('ix_feedback_row_id', FeedbackModel.row_id)
Index('ix_feedback_user_id', FeedbackModel.user_id)
Index('ix_feedback_template_experiment_id', FeedbackTemplate.experiment_id)
Index('ix_feedback_assignments_user_email', feedback_assignments.c.user_email)
Index('ix_feedback_assignments_row_id', feedback_assignments.c.row_id)


# Define strict types for scorer meta_info
class LLMScorerConfig(BaseModel):
    model: str
    provider: Literal["openai", "anthropic"]
    temperature: float = 0.0
    system_prompt: str
    scoring_prompt: str
    max_tokens: int = Field(default=500)
    output_schema: Dict[str, str]
    additional_kwargs: Dict[str, Any] = Field(default_factory=dict)


class PythonScorerConfig(BaseModel):
    function_string: str
    input_schema: Dict[str, str]
    output_schema: Dict[str, str]
    additional_kwargs: Dict[str, Any] = Field(default_factory=dict)


class ScorerType(str, PyEnum):
    LLM = "llm_scorer"
    PYTHON = "python_scorer"


class Scorer(AbstractBase):
    """
    Scorer model representing scoring functions associated with a project and experiments.
    Can be either an LLM-based scorer or a Python function scorer.
    """
    __tablename__ = 'scorers'

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey('projects.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(Enum(ScorerType), nullable=False)
    meta_info = Column(JSON, nullable=False)  # Will be validated against LLMScorerConfig or PythonScorerConfig
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Git information
    git_branch = Column(String(255), nullable=True)
    git_commit = Column(String(255), nullable=True)
    git_repo = Column(String(255), nullable=True)

    # Relationships
    project = relationship('Project', back_populates='scorers')
    experiments = relationship('Experiment', back_populates='scorers', secondary='experiment_scorers')

    def __repr__(self):
        return f"<Scorer(name='{self.name}', type='{self.type}', project_id='{self.project_id}')>"

    @validates('meta_info')
    def validate_meta_info(self, key, meta_info):
        """Validate meta_info based on scorer type"""
        if isinstance(meta_info, str):
            # Handle JSON string
            meta_info = json.loads(meta_info)

        if self.type == ScorerType.LLM:
            LLMScorerConfig.model_validate(meta_info)
        elif self.type == ScorerType.PYTHON:
            PythonScorerConfig.model_validate(meta_info)
        return meta_info


if __name__ == '__main__':
    from sqlalchemy import create_engine
    from src.sql_db.database import get_database_url
    url = get_database_url('research_etl', async_url=False)
    engine = create_engine(url)

    # Only drop and recreate the tables defined in this file
    tables_to_manage = [
        Project.__table__,
        Experiment.__table__,
        Row.__table__,
        SpanModel.__table__,
        AttachmentModel.__table__,
        FeedbackModel.__table__,
        FeedbackTemplate.__table__,
        Prompt.__table__,
        Scorer.__table__,
        feedback_assignments,
        experiment_scorers,
        experiment_prompts,
        span_prompts,
    ]

    # Drop only our tables
    for table in reversed(tables_to_manage):
        table.drop(engine, checkfirst=True)

    # Create only our tables
    for table in tables_to_manage:
        table.create(engine)
