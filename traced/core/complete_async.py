# Import necessary modules
import asyncio
import time
import uuid
import os
import sys
import traceback
from datetime import datetime
from dataclasses import dataclass
from functools import wraps
import re
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union, cast
import inspect
from typing import get_origin
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine, select, update, text, func
from sqlalchemy.orm import sessionmaker, selectinload
import aioboto3
from typing import List, Optional, Dict, Any
from datetime import datetime
from pathlib import Path
from datetime import datetime
import logging
from termcolor import colored
from enum import Enum
import threading
import queue  # For thread-safe Queue
from string import Formatter
import hashlib
import numpy as np

sys.path.append(str(Path(__file__).resolve().parents[2]))

from context import current_row_id, current_span_id, current_span, current_experiment_id, current_project_id, current_experiment_name
from utils.serialization import serialize_object
from git.gitutil import get_repo_info, GitMetadataSettings
from traced.core.logger_model import (
    Experiment, Row, SpanModel, AttachmentModel, FeedbackModel, Project, Prompt, experiment_prompts, span_prompts
)

class LogType(Enum):
    BACKGROUND = "BACKGROUND"
    REALTIME = "REALTIME"
    ERROR = "ERROR"
    SUCCESS = "SUCCESS"

class ColoredFormatter(logging.Formatter):
    """Custom formatter that adds colors and prefixes based on log type"""
    
    def format(self, record):
        # Extract log type from extra data, default to BACKGROUND
        log_type = getattr(record, 'log_type', LogType.BACKGROUND)
        
        # Format the basic message
        message = super().format(record)
        
        # Color and prefix based on log type
        if log_type == LogType.REALTIME:
            return colored(f"[REALTIME] {message}", 'green')
        elif log_type == LogType.ERROR:
            return colored(f"[ERROR] {message}", 'red')
        elif log_type == LogType.SUCCESS:
            return colored(f"[SUCCESS] {message}", 'blue')
        else:  # BACKGROUND
            return colored(f"[BACKGROUND] {message}", 'grey')

# Set up logging
log_dir = "logs"
if not os.path.exists(log_dir):
    os.makedirs(log_dir)

# Create logger
logger = logging.getLogger('llm_logger')
logger.setLevel(logging.DEBUG)

# Create handlers
log_file = os.path.join(log_dir, f'llm_logger_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log')
file_handler = logging.FileHandler(log_file)
console_handler = logging.StreamHandler()

# Create formatters
file_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
console_formatter = ColoredFormatter('%(asctime)s - %(levelname)s - %(message)s')

# Set formatters
file_handler.setFormatter(file_formatter)
console_handler.setFormatter(console_formatter)

# Add handlers
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Create convenience logging functions
def log_realtime(msg: str, level: int = logging.INFO):
    """Log a realtime message (shown to user immediately)"""
    logger.log(level, msg, extra={'log_type': LogType.REALTIME})

def log_background(msg: str, level: int = logging.DEBUG):
    """Log a background task message"""
    logger.log(level, msg, extra={'log_type': LogType.BACKGROUND})

def log_error(msg: str, level: int = logging.ERROR):
    """Log an error message"""
    logger.log(level, msg, extra={'log_type': LogType.ERROR})

def log_success(msg: str, level: int = logging.INFO):
    """Log a success message"""
    logger.log(level, msg, extra={'log_type': LogType.SUCCESS})


# Type variable for generic return type
T = TypeVar('T')

@dataclass
class PoolConfig:
    pool_size: int = 5
    max_overflow: int = 10
    pool_timeout: int = 30
    pool_recycle: int = 1800
    pool_pre_ping: bool = True

class StorageMetrics:
    """Track storage operation metrics."""
    def __init__(self):
        self.active_connections: int = 0
        self.total_operations: int = 0
        self.failed_operations: int = 0
        self.slow_queries: int = 0
        self.query_times: Dict[str, float] = {}

class LoggingTask:
    """Represents a logging task to be processed by the worker."""
    def __init__(self, coroutine):
        self.coroutine = coroutine


def compute_prompt_hash(prompt_text: str) -> str:
    """Compute SHA256 hash of the prompt text."""
    return hashlib.sha256(prompt_text.encode('utf-8')).hexdigest()


def extract_variables_from_prompt(prompt_text: str) -> List[str]:
    """Extract variable names from a prompt template string."""
    variables = set()

    # Parse using string.Formatter
    formatter = Formatter()
    for literal_text, field_name, format_spec, conversion in formatter.parse(prompt_text):
        if field_name is not None:
            # Handle nested variables (e.g., {user.name})
            base_field = field_name.split('.')[0]
            variables.add(base_field)

    # Additional regex parsing with multiline flag
    pattern = re.compile(r'{([^{}]+)}', re.MULTILINE | re.DOTALL)
    matches = re.findall(pattern, prompt_text)
    for match in matches:
        # Handle nested variables and strip any formatting syntax
        base_field = match.split('.')[0].split('!')[0].split(':')[0]
        variables.add(base_field.strip())

    return list(variables)


class SQLStorage:
    def __init__(
        self,
        sql_uri: str,
        s3_bucket: str = os.environ.get("AWS_LOGGING_BUCKET", "logging-data"),
        s3_region: str = os.environ.get("AWS_LOGGING_REGION", "us-west-1"),
        pool_config: Optional[PoolConfig] = None,
        aws_access_key_id: Optional[str] = os.environ.get("AWS_LOGGING_ACCESS_KEY"),
        aws_secret_access_key: Optional[str] = os.environ.get("AWS_LOGGING_SECRET_ACCESS_KEY"),
        endpoint_url: Optional[str] = os.environ.get("AWS_LOGGING_ENDPOINT_URL"),
        max_retries: int = 3,
        retry_delay: float = 1.0
    ):
        """Initialize SQL storage with improved connection management."""
        self.metrics = StorageMetrics()
        self.sql_uri = sql_uri
        self.s3_config = {
            'bucket': s3_bucket,
            'region': s3_region,
            'access_key_id': aws_access_key_id,
            'secret_access_key': aws_secret_access_key,
            'endpoint_url': endpoint_url
        }
        self.pool_config = pool_config or PoolConfig()
        self.max_retries = max_retries
        self.retry_delay = retry_delay

        # Get git info once during initialization
        try:
            git_info = get_repo_info(GitMetadataSettings())
            self.git_metadata = {
                'branch': git_info.branch,
                'commit': git_info.commit,
                'repo_url': git_info.repo_url
            }
        except Exception as e:
            logger.warning(f"Failed to get git metadata: {e}")
            self.git_metadata = {
                'branch': None,
                'commit': None,
                'repo_url': None
            }

        # Initialize other components
        self._engine_lock = threading.Lock()
        self._session_lock = threading.Lock()
        self._initialize_database_connections()
        self.s3_session = aioboto3.Session(
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            region_name=s3_region
        )
        self._task_queue = queue.Queue()
        self._shutdown_event = threading.Event()
        self._worker_thread = threading.Thread(
            target=self._worker, name="SQLStorageWorker", daemon=True
        )
        self._worker_thread.start()
        self._task_dependencies = {}  # Track task dependencies
        self._completed_tasks = set()  # Track completed tasks
        self._task_completion_events = {}  # Events for task completion
        self._task_lock = threading.Lock()

    def _initialize_database_connections(self):
        """Initialize database engines and session makers with proper error handling."""
        # Validate and normalize database URI
        valid_async_dialects = {
            'mysql': 'mysql+aiomysql://',
            'postgresql': 'postgresql+asyncpg://'
        }
        valid_sync_dialects = {
            'mysql': 'mysql+pymysql://',
            'postgresql': 'postgresql+psycopg2://'
        }

        # Check if URI is valid and determine database type
        db_type = None
        for db, dialect in valid_async_dialects.items():
            if self.sql_uri.startswith(dialect):
                db_type = db
                break

        if not db_type:
            raise ValueError(
                f"Unsupported database URI: {self.sql_uri}. "
                f"Must start with either {valid_async_dialects['mysql']} or {valid_async_dialects['postgresql']}"
            )

        with self._engine_lock:
            try:
                # Create async engine with proper connection management
                self.engine = create_async_engine(
                    self.sql_uri,
                    **self.pool_config.__dict__,
                    # Add connection debugging
                    echo_pool=True if os.environ.get('DEBUG') else False
                )

                # Create sync engine for non-async operations
                sync_uri = self.sql_uri.replace(
                    valid_async_dialects[db_type],
                    valid_sync_dialects[db_type]
                )
                self.sync_engine = create_engine(
                    sync_uri,
                    **self.pool_config.__dict__,
                    echo_pool=True if os.environ.get('DEBUG') else False
                )

                # Initialize session makers
                self.async_session = async_sessionmaker(
                    self.engine,
                    class_=AsyncSession,
                    expire_on_commit=False
                )
                self.sync_session = sessionmaker(
                    self.sync_engine,
                    expire_on_commit=False
                )

            except ImportError as ie:
                # Handle missing database drivers
                if 'psycopg2' in str(ie):
                    raise ImportError(
                        "PostgreSQL driver not found. Install with: pip install traced[postgresql]"
                    ) from ie
                elif 'pymysql' in str(ie) or 'aiomysql' in str(ie):
                    raise ImportError(
                        "MySQL driver not found. Install with: pip install traced[mysql]"
                    ) from ie
                raise
            except Exception as e:
                logger.error(f"Failed to initialize database connections: {str(e)}")
                raise

    async def _execute_with_retry(self, operation: Callable, *args, **kwargs) -> Any:
        """Execute database operation with retry logic."""
        last_exception = None
        for attempt in range(self.max_retries):
            try:
                return await operation(*args, **kwargs)
            except Exception as e:
                last_exception = e
                if "too many connections" in str(e).lower():
                    logger.warning(f"Too many connections (attempt {attempt + 1}/{self.max_retries})")
                    # Wait before retrying, with exponential backoff
                    await asyncio.sleep(self.retry_delay * (2 ** attempt))
                    # Try to clean up any lingering connections
                    await self._cleanup_connections()
                else:
                    raise e
        
        raise last_exception

    async def _cleanup_connections(self):
        """Attempt to clean up database connections."""
        try:
            # Dispose of the current engine pool
            await self.engine.dispose()
            # Reinitialize the connection pool
            self._initialize_database_connections()
        except Exception as e:
            logger.error(f"Error during connection cleanup: {str(e)}")

    def queue_task(self, coroutine, depends_on: Optional[Union[str, List[str]]] = None, task_id: Optional[str] = None):
        """Add a coroutine to the logging task queue with dependency tracking."""
        if self._shutdown_event.is_set():
            raise RuntimeError("Storage is shutting down")
        if not task_id:
            task_id = str(uuid.uuid4())
        with self._task_lock:
            if depends_on:
                if isinstance(depends_on, str):
                    depends_on = [depends_on]
                self._task_dependencies[task_id] = depends_on
                for dep in depends_on:
                    if dep not in self._completed_tasks:
                        # Create completion event if it doesn't exist
                        if dep not in self._task_completion_events:
                            self._task_completion_events[dep] = threading.Event()
            self._task_queue.put((task_id, coroutine))

    async def _get_session(self):
        """Get a database session with proper connection management."""
        return self.async_session()

    def _worker(self):
        """Background worker to process queued tasks with dependency handling."""
        asyncio.set_event_loop(asyncio.new_event_loop())
        loop = asyncio.get_event_loop()
        
        # Process tasks with dependency handling
        while not (self._shutdown_event.is_set() and self._task_queue.empty()):
            try:
                task_id, task = self._task_queue.get(timeout=0.1)
                
                # Check if task has dependencies
                with self._task_lock:
                    dependencies = self._task_dependencies.get(task_id, [])
                    unmet_dependencies = [dep for dep in dependencies if dep not in self._completed_tasks]

                if unmet_dependencies:
                    # Dependencies not yet satisfied, re-queue the task
                    self._task_queue.put((task_id, task))
                    self._task_queue.task_done()  # Mark task as done to allow the counter to decrement
                    # Sleep briefly to avoid tight loop
                    time.sleep(0.1)
                    continue  # Proceed to next task
                else:
                    # All dependencies are satisfied, process the task
                    try:
                        loop.run_until_complete(self._execute_with_retry(task))
                        # Mark task as completed
                        with self._task_lock:
                            self._completed_tasks.add(task_id)
                            if task_id in self._task_completion_events:
                                self._task_completion_events[task_id].set()
                    except Exception as e:
                        logger.error(f"Error processing task: {str(e)}")
                        traceback.print_exc()
                    finally:
                        self._task_queue.task_done()
                        
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Worker error: {str(e)}")
                traceback.print_exc()
                time.sleep(1)
        
        loop.close()

    def create_project_async(self, project_data: Dict[str, Any]) -> None:
        """Asynchronous method to create a project."""
        async def _create_project():
            async with await self._get_session() as session:
                try:
                    project = Project(
                        id=project_data['id'],
                        name=project_data['name'],
                        description=project_data.get('description'),
                    )
                    logger.info(f"Creating project: {project_data['name']}")
                    session.add(project)
                    await session.commit()
                except Exception as e:
                    logger.error(f"Error creating project: {str(e)}")
                    await session.rollback()
                    if "duplicate key value" in str(e) or "Duplicate entry" in str(e):
                        # Project already exists
                        return
                    raise

        # Queue the project creation task with task_id=project_data['id']
        self.queue_task(_create_project, task_id=project_data['id'])

    def create_experiment_async(self, experiment_data: Dict[str, Any]) -> None:
        """Asynchronous method to create an experiment."""
        async def _create_experiment():
            async with await self._get_session() as session:
                try:
                    experiment = Experiment(
                        id=experiment_data['id'],
                        name=experiment_data['name'],
                        description=experiment_data.get('description'),
                        created_at=experiment_data.get('created_at', datetime.utcnow()),
                        version=experiment_data.get('version', 1),
                        git_branch=self.git_metadata['branch'],
                        git_commit=self.git_metadata['commit'],
                        git_repo=self.git_metadata['repo_url'],
                        project_id=experiment_data.get('project_id'),
                    )
                    session.add(experiment)
                    await session.commit()
                except Exception as e:
                    await session.rollback()
                    if "duplicate key value" in str(e) or "Duplicate entry" in str(e):
                        return
                    raise

        # Build dependencies
        dependencies = []
        if 'project_id' in experiment_data:
            dependencies.append(experiment_data['project_id'])
        # Queue the experiment creation task with dependencies
        self.queue_task(_create_experiment, depends_on=dependencies, task_id=experiment_data['id'])

    def save_row(self, row_data: Dict[str, Any]) -> None:
        """Enqueue a row save task."""
        async def _save_row():
            async with await self._get_session() as session:
                try:
                    # Ensure required fields
                    row_data['id'] = row_data.get('id', str(uuid.uuid4()))
                    row_data['created_at'] = (
                        datetime.fromisoformat(row_data['created_at'])
                        if isinstance(row_data.get('created_at'), str)
                        else row_data.get('created_at', datetime.utcnow())
                    )

                    # Efficient upsert using ON CONFLICT
                    stmt = (
                        update(Row)
                        .where(Row.id == row_data['id'])
                        .values(**row_data)
                        .execution_options(synchronize_session=False)
                    )
                    result = await session.execute(stmt)

                    if result.rowcount == 0:
                        session.add(Row(**row_data))

                    await session.commit()
                    logger.info(f"Successfully saved row: {row_data['id']}")
                except Exception as e:
                    await session.rollback()
                    logger.error(f"Error saving row: {str(e)}")
                    raise
                finally:
                    await session.close()

        # Build dependencies
        dependencies = []
        if 'experiment_id' in row_data:
            dependencies.append(row_data['experiment_id'])
        # Queue the row save task with task_id=row_data['id']
        self.queue_task(_save_row, depends_on=dependencies, task_id=row_data['id'])

    def save_span(self, span_data: Dict[str, Any]) -> None:
        """Enqueue a span save task with dependencies on row and parent span."""
        async def _save_span():
            async with await self._get_session() as session:
                try:
                    sanitized_span_data = self._sanitize_for_json(span_data)
                    
                    # Check if parent span exists
                    if span_data.get('parent_id'):
                        stmt = select(SpanModel).where(SpanModel.id == span_data['parent_id'])
                        result = await session.execute(stmt)
                        parent_span = result.scalar_one_or_none()

                        if not parent_span:
                            logger.warning(f"Parent span {span_data['parent_id']} not found for span {span_data['id']}")
                            sanitized_span_data['parent_id'] = None

                    stmt = select(SpanModel).where(SpanModel.id == sanitized_span_data["id"])
                    result = await session.execute(stmt)
                    existing_span = result.scalar_one_or_none()

                    if existing_span:
                        for key, value in sanitized_span_data.items():
                            if hasattr(existing_span, key):
                                setattr(existing_span, key, value)
                    else:
                        span_model = SpanModel(**sanitized_span_data)
                        session.add(span_model)

                    await session.commit()
                    logger.info(f"Successfully saved span: {sanitized_span_data['name']} (ID: {sanitized_span_data['id']})")
                except Exception as e:
                    await session.rollback()
                    raise
                finally:
                    await session.close()

        # Build dependencies: row and parent span
        dependencies = [span_data['row_id']]
        if span_data.get('parent_id'):
            dependencies.append(span_data['parent_id'])
        # Queue the span save task with dependencies and task_id
        self.queue_task(_save_span, depends_on=dependencies, task_id=span_data['id'])

    def save_prompt(self, prompt_data: Dict[str, Any], experiment_id: Optional[str] = None) -> None:
        """Enqueue a task to save a prompt with enhanced tracking."""
        async def _save_prompt():
            async with await self._get_session() as session:
                try:
                    # Extract variables from prompt text
                    variables = extract_variables_from_prompt(prompt_data['prompt_text'])

                    # Update prompt data with git information from initialization
                    prompt_data.update({
                        'variables': variables,
                        'source_info': {"file": prompt_data.get("source_info", {}).get("file")},
                        'git_branch': self.git_metadata['branch'],
                        'git_commit': self.git_metadata['commit'],
                        'git_repo': self.git_metadata['repo_url'],
                    })

                    # Compute hash
                    prompt_hash = compute_prompt_hash(prompt_data['prompt_text'])
                    prompt_data['hash'] = prompt_hash

                    # Git metadata
                    prompt_data.update({
                        'git_branch': self.git_metadata['branch'],
                        'git_commit': self.git_metadata['commit'],
                        'git_repo': self.git_metadata['repo_url'],
                    })

                    # Check for existing prompt
                    stmt = select(Prompt).where(
                        Prompt.project_id == prompt_data['project_id'],
                        Prompt.name == prompt_data['name'],
                        Prompt.hash == prompt_hash,
                        # MySQL JSON path syntax
                        func.json_extract(Prompt.source_info, '$.file') == prompt_data.get('source_info', {}).get('file')
                    )
                    result = await session.execute(stmt)
                    existing_prompt = result.scalar_one_or_none()

                    if existing_prompt:
                        prompt = existing_prompt
                        logger.info(f"Prompt already exists: {prompt_data['name']}")
                    else:
                        prompt = Prompt(**prompt_data)
                        session.add(prompt)

                    # Create span-prompt association if there's a current span
                    current_span_obj = current_span.get()
                    if current_span_obj:
                        # Check if association already exists
                        assoc_stmt = select(span_prompts).where(
                            span_prompts.c.span_id == current_span_obj.id,
                            span_prompts.c.prompt_id == prompt.id
                        )
                        assoc_result = await session.execute(assoc_stmt)
                        existing_association = assoc_result.first()

                        if not existing_association:
                            # Create association only if it doesn't exist
                            stmt = span_prompts.insert().values(
                                span_id=current_span_obj.id,
                                prompt_id=prompt.id,
                                created_at=datetime.utcnow()
                            )
                            await session.execute(stmt)
                            logger.info(f"Created association between prompt {prompt.id} and span {current_span_obj.id}")
                        else:
                            logger.debug(f"Association between prompt {prompt.id} and span {current_span_obj.id} already exists")

                    await session.commit()
                    logger.info(f"Successfully saved prompt: {prompt_data['name']}")

                    # Create experiment-prompt association if experiment_id is provided
                    if experiment_id:
                        # Check if experiment exists
                        stmt = select(Experiment).where(Experiment.id == experiment_id)
                        result = await session.execute(stmt)
                        experiment = result.scalar_one_or_none()

                        if experiment:
                            # Check if association already exists
                            assoc_stmt = select(experiment_prompts).where(
                                experiment_prompts.c.experiment_id == experiment_id,
                                experiment_prompts.c.prompt_id == prompt.id
                            )
                            assoc_result = await session.execute(assoc_stmt)
                            existing_association = assoc_result.first()

                            if not existing_association:
                                # Create association only if it doesn't exist
                                stmt = experiment_prompts.insert().values(
                                    experiment_id=experiment_id,
                                    prompt_id=prompt.id,
                                    created_at=datetime.utcnow()
                                )
                                await session.execute(stmt)
                                logger.info(f"Created association between prompt {prompt.id} and experiment {experiment_id}")
                            else:
                                logger.debug(f"Association between prompt {prompt.id} and experiment {experiment_id} already exists")
                        else:
                            logger.warning(f"Experiment {experiment_id} not found for prompt association")
                    await session.commit()
                    logger.info(f"Successfully saved prompt: {prompt_data['name']}")

                except Exception as e:
                    await session.rollback()
                    logger.error(f"Error saving prompt: {str(e)}")
                    raise
                finally:
                    await session.close()

        # Build dependencies
        dependencies = []
        if 'project_id' in prompt_data:
            dependencies.append(prompt_data['project_id'])
        if experiment_id:
            dependencies.append(experiment_id)
        # Queue the prompt save task with dependencies and task_id
        self.queue_task(_save_prompt, depends_on=dependencies, task_id=prompt_data['id'])

    def save_feedback(self, feedback: Dict[str, Any]) -> None:
        """Enqueue a task to save feedback with improved error handling."""
        async def _save_feedback():
            async with await self._get_session() as session:
                try:
                    feedback_model = FeedbackModel(
                        id=str(uuid.uuid4()),
                        timestamp=datetime.utcnow(),
                        **feedback
                    )
                    session.add(feedback_model)
                    await session.commit()
                    logger.info(f"Successfully saved feedback for row: {feedback.get('row_id')}")
                except Exception as e:
                    await session.rollback()
                    logger.error(f"Error saving feedback: {str(e)}")
                    raise
                finally:
                    await session.close()

        # Build dependencies
        dependencies = []
        if 'row_id' in feedback:
            dependencies.append(feedback['row_id'])
        # Queue the feedback save task with dependencies and task_id
        self.queue_task(_save_feedback, depends_on=dependencies, task_id=feedback['id'])

    def update_row_output(self, row_id: str, output_data: Dict[str, Any]) -> None:
        """Enqueue a task to update row output with dependency tracking."""
        async def _update_row_output():
            async with await self._get_session() as session:
                try:
                    sanitized_output = self._sanitize_for_json(output_data)
                    stmt = (
                        update(Row)
                        .where(Row.id == row_id)
                        .values(output_data=sanitized_output)
                    )
                    result = await session.execute(stmt)

                    if result.rowcount == 0:
                        raise ValueError(f"Row with id {row_id} not found")

                    await session.commit()
                    logger.info(f"Successfully updated output for row: {row_id}")
                except Exception as e:
                    await session.rollback()
                    logger.error(f"Error updating row output: {str(e)}")
                    raise
                finally:
                    await session.close()

        # Queue the update task with dependency on the row
        self.queue_task(_update_row_output, depends_on=row_id, task_id=f"update_output_{row_id}_{uuid.uuid4()}")

    def update_row_tags(self, row_id: str, tags: List[str]) -> None:
        """Enqueue a task to update row tags with dependency tracking."""
        async def _update_row_tags():
            async with await self._get_session() as session:
                try:
                    sanitized_tags = self._sanitize_for_json(tags)
                    stmt = (
                        update(Row)
                        .where(Row.id == row_id)
                        .values(tags=sanitized_tags)
                    )
                    result = await session.execute(stmt)

                    if result.rowcount == 0:
                        raise ValueError(f"Row with id {row_id} not found")

                    await session.commit()
                    logger.info(f"Successfully updated tags for row: {row_id}")
                except Exception as e:
                    await session.rollback()
                    logger.error(f"Error updating row tags: {str(e)}")
                    raise
                finally:
                    await session.close()

        # Queue the update task with dependency on the row
        self.queue_task(_update_row_tags, depends_on=row_id, task_id=f"update_tags_{row_id}_{uuid.uuid4()}")

    def shutdown(self):
        """Shut down the storage worker gracefully."""
        self.wait_until_done()  # Ensure all tasks are processed
        self._shutdown_event.set()
        self._worker_thread.join()
        logger.info("Storage worker has been shut down.")

    def _sanitize_for_json(self, obj: Any) -> Any:
        """Make objects JSON serializable with improved type handling."""
        if isinstance(obj, (str, int, float, bool, type(None))):
            return obj
        elif isinstance(obj, (datetime, uuid.UUID)):
            return str(obj)
        elif isinstance(obj, dict):
            return {k: self._sanitize_for_json(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple, set)):
            return [self._sanitize_for_json(item) for item in obj]
        else:
            return f"<{obj.__class__.__name__} object>"

    def wait_until_done(self, timeout: Optional[float] = None):
        """Block until all tasks in the queue have been processed with improved monitoring."""
        start_time = time.time()
        initial_queue_size = self._task_queue.qsize()
        
        try:
            while True:
                # Check if we've exceeded timeout
                if timeout and (time.time() - start_time) >= timeout:
                    remaining = self._task_queue.qsize()
                    logger.warning(
                        f"wait_until_done() timed out after {timeout}s. "
                        f"{remaining} tasks remaining in queue."
                    )
                    break

                # Log progress
                current_size = self._task_queue.qsize()
                if current_size == 0:
                    break

                progress = (initial_queue_size - current_size) / initial_queue_size * 100 if initial_queue_size else 100
                logger.info(f"Processing queue: {progress:.1f}% complete ({current_size} tasks remaining)")
                
                # Use join with a short timeout to allow for progress updates
                try:
                    self._task_queue.join()
                    break  # Queue is empty and all tasks are done
                except queue.Empty:
                    # Continue monitoring
                    time.sleep(0.1)
                
            if self._task_queue.empty():
                logger.info("All tasks have been processed successfully.")
            else:
                logger.warning("Some tasks may not have completed processing.")
                
        except Exception as e:
            logger.error(f"Error during wait_until_done: {str(e)}")
            raise

    async def _periodic_cleanup(self):
        """Periodically cleanup idle connections."""
        while not self._shutdown_event.is_set():
            await asyncio.sleep(300)  # Run every 5 minutes
            await self._cleanup_connections()


# This is so that we can pass through a span that is None
class PassThroughSpan:
    def __init__(self):
        pass

    def log(self, *args, **kwargs):
        pass


def get_current_span():
    """Helper function to get the current span."""
    return current_span.get() or PassThroughSpan()


def get_current_experiment():
    """Helper function to get the current experiment."""
    name = current_experiment_name.get(None)
    id = current_experiment_id.get(None)
    return {"name": name, "id": id}


class Span:
    def __init__(self, name: str, row_id: str, parent_id: Optional[str] = None, storage=None, type: Optional[str] = None, source_file: str = None):
        self.id = str(uuid.uuid4())
        self.name = name
        self.parent_id = parent_id
        self.row_id = row_id
        self.start_time = round(time.time(), 6)  # Keep microsecond precision
        self._start_perf_counter = time.perf_counter()
        self.span_type = type  # Store the span type
        self.end_time = None
        self.duration = None
        self.meta_info: Dict[str, Any] = {}
        self.source_file = source_file
        self.storage = storage
        self.input: Optional[Dict[str, Any]] = None
        self.output: Optional[Any] = None
        self.error: Optional[Dict[str, Any]] = None
        self.model_name: Optional[str] = None
        self.latency: Optional[float] = None
        self.token_count: Optional[int] = None
        self._previous_span = None  # Store the previous span
        self._ended = False

    def __enter__(self) -> 'Span':
        self._id_token = current_span_id.set(self.id)
        self._span_token = current_span.set(self)
        self.save()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is not None:
                error_details = {
                    "error_type": exc_type.__name__,
                    "error_message": str(exc_val),
                    "traceback": traceback.format_exc()
                }
                logger.error(f"Error in span {self.name}: {error_details}")
                self.log_error(error_details)
            self.end()
        finally:
            current_span_id.reset(self._id_token)
            current_span.reset(self._span_token)

    async def __aenter__(self) -> 'Span':
        """Async enter the span context."""
        # Store the current span before setting the new one
        self._previous_span = current_span.get()
        self._id_token = current_span_id.set(self.id)
        self._span_token = current_span.set(self)
        self.save()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async exit the span context."""
        try:
            if exc_type is not None:
                error_details = {
                    "error_type": exc_type.__name__,
                    "error_message": str(exc_val),
                    "traceback": traceback.format_exc()
                }
                self.log_error(error_details)
            self.end()
        finally:
            # Restore the previous span context
            current_span_id.reset(self._id_token)
            current_span.reset(self._span_token)
            if self._previous_span:
                current_span.set(self._previous_span)
                current_span_id.set(self._previous_span.id)

    def end(self):
        """End the span and save final state."""
        if not self._ended:
            self.end_time = round(time.time(), 6)
            self.duration = time.perf_counter() - self._start_perf_counter
            self.save()
            self._ended = True

    def save(self) -> None:
        """Enqueue a task to save the span with enhanced prompt tracking."""
        if self.storage:
            span_data = {
                "id": self.id,
                "row_id": self.row_id,
                "name": self.name,
                "parent_id": self.parent_id,
                "start_time": self.start_time,
                "end_time": self.end_time,
                "duration": self.duration,
                "meta_info": self.meta_info,
                "input_data": self.input,
                "output_data": self.output,
                "error": self.error,
                "model_name": self.model_name,
                "latency": self.latency,
                "token_count": self.token_count,
                "type": self.span_type
            }
            self.storage.save_span(span_data)

            # Check for prompts in meta_info and log them
            system_prompt = self.meta_info.get('system_prompt')
            user_prompt = self.meta_info.get('user_prompt')
            prompt_name = self.meta_info.get('prompt_name', self.name)
            project_id = current_project_id.get()
            experiment_id = current_experiment_id.get()

            if system_prompt or user_prompt:
                # Get source information for the prompts
                if system_prompt:
                    prompt_data = {
                        'id': str(uuid.uuid4()),
                        'source_info': {'file': self.source_file},
                        'project_id': project_id,
                        'name': f"{prompt_name}::system_prompt",
                        'prompt_text': system_prompt,
                        'created_at': datetime.utcnow(),
                    }
                    self.storage.save_prompt(prompt_data, experiment_id=experiment_id)

                if user_prompt:
                    prompt_data = {
                        'id': str(uuid.uuid4()),
                        'project_id': project_id,
                        'source_info': {'file': self.source_file},
                        'name': f"{prompt_name}::user_prompt",
                        'prompt_text': user_prompt,
                        'created_at': datetime.utcnow(),
                    }
                    self.storage.save_prompt(prompt_data, experiment_id=experiment_id)

    def log_input(self, input_data: Dict[str, Any]) -> None:
        """Set input data and enqueue save."""
        self.input = input_data
        self.save()

    def log_output(self, output_data: Any) -> None:
        """Set output data and enqueue save."""
        self.output = output_data
        self.save()

    def log_error(self, error: Union[str, Dict[str, Any]]) -> None:
        """Set error data and enqueue save."""
        self.error = error
        self.save()

    def set_metadata(self, **kwargs) -> None:
        """Set metadata synchronously."""
        self.meta_info.update(kwargs)
        self.save()

    def set_metrics(self, metrics: Dict[str, Any]) -> None:
        """Set metrics in meta_info."""
        if not self.meta_info:
            self.meta_info = {}
        self.meta_info.setdefault("metrics", {}).update(metrics)
        self.save()

    def log(self, *, input: Optional[Dict[str, Any]] = None, output: Optional[Any] = None, metrics: Optional[Dict[str, Any]] = None, metadata: Optional[Dict[str, Any]] = None):
        """Log input, output, metrics, and metadata."""
        if input is not None:
            self.log_input(input)
        if output is not None:
            self.log_output(output)
        if metadata:
            self.set_metadata(**metadata)
        if metrics:
            self.set_metrics(metrics)


class Logger:
    def __init__(self, storage):
        self.storage = storage
        self._experiment_token = None

    async def _get_or_create_row_id(self, row_id: Optional[str] = None) -> str:
        if row_id:
            return row_id
        span = current_span.get(None)
        if span:
            return span.row_id
        current_row = current_row_id.get(None)
        return current_row or str(uuid.uuid4())

    async def _get_effective_experiment_id(self, experiment_id: Optional[str] = None) -> str:
        current_exp_id = current_experiment_id.get(None)
        return experiment_id or current_exp_id or "default_experiment"

    async def _handle_span_context(
        self,
        input_data: Optional[Dict[str, Any]] = None,
        output_data: Optional[Any] = None,
    ) -> bool:
        span = current_span.get(None)
        if span:
            if input_data:
                span.log_input(input_data)
            if output_data:
                span.log_output(output_data)
            span.save()
            return True
        return False

    async def _update_or_create_row(
        self,
        row_id: str,
        experiment_id: Optional[str] = None,
        input_data: Optional[Dict[str, Any]] = None,
        output_data: Optional[Any] = None,
    ) -> None:
        update_data = {}
        if input_data is not None:
            update_data["input_data"] = input_data
        if output_data is not None:
            update_data["output_data"] = output_data
        if experiment_id:
            update_data["experiment_id"] = experiment_id
        if update_data:  # Only update if there are changes
            update_data["id"] = row_id
            self.storage.save_row(update_data)

    async def log_feedback(
        self,
        feedback: Dict[str, Any],
        row_id: Optional[str] = None,
    ) -> None:
        try:
            current_row = current_row_id.get(None)
            row_id = row_id or current_row or str(uuid.uuid4())
            feedback_entry = {
                "id": str(uuid.uuid4()),
                "timestamp": datetime.utcnow(),
                "feedback": feedback,
                "row_id": row_id,
            }
            self.storage.save_feedback(feedback_entry)
        except Exception as e:
            print(f"Error logging feedback: {str(e)}")

    async def log(
        self,
        experiment_id: Optional[str] = None,
        input: Optional[Dict[str, Any]] = None,
        output: Optional[Any] = None,
        row_id: Optional[str] = None
    ) -> str:
        row_id = await self._get_or_create_row_id(row_id)
        await self._update_or_create_row(
            row_id=row_id,
            experiment_id=experiment_id,
            input_data=input,
            output_data=output
        )
        return row_id

    async def start_span(
        self,
        name: str,
        row_id: Optional[str] = None,
        parent_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
        type: Optional[str] = None
    ) -> str:
        """Start a new span and return its ID."""
        row_id, experiment_id = await asyncio.gather(
            self._get_or_create_row_id(row_id),
            self._get_effective_experiment_id()
        )
        existing_span = current_span.get(None)
        span = Span(
            name=name,
            row_id=row_id,
            parent_id=parent_id or (existing_span.id if existing_span else None),
            storage=self.storage,
            type=type
        )
        if metadata:
            span.set_metadata(**metadata)
        tokens = {
            'span_id': current_span_id.set(span.id),
            'span': current_span.set(span),
            'row_id': current_row_id.set(row_id) if not current_row_id.get(None) else None
        }
        if tags:
            self.storage.update_row_tags(row_id, tags)
        return span

    async def end_span(self, span_id: str) -> None:
        """End the span with the given ID."""
        span = current_span.get(None)
        if span and span.id == span_id:
            span.end()  # Span.end handles queuing internally

    async def log_to_span(
        self,
        input: Optional[Dict[str, Any]] = None,
        output: Optional[Any] = None,
        metrics: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """Log data to the current span."""
        span = current_span.get(None)
        if span:
            span.log(input=input, output=output, metrics=metrics, metadata=metadata)

    # async def log_with_attachment(
    #     self,
    #     experiment_id: Optional[str] = None,
    #     input: Optional[Dict[str, Any]] = None,
    #     output: Optional[Any] = None,
    #     attachment: Optional[Any] = None,
    #     row_id: Optional[str] = None
    # ) -> str:
    #     row_id = await self._get_or_create_row_id(row_id)
    #     if attachment:
    #         attachment_url = await self.storage.upload_attachment(attachment, row_id)
    #         if attachment_url:
    #             output = output or {}
    #             if isinstance(output, dict):
    #                 output["attachment_url"] = attachment_url

    async def get_experiment_traces(self, experiment_name: str) -> Dict[str, Any]:
        """Get traces for an experiment."""
        return await self.storage.get_experiment_traces(experiment_name)

    async def wait_until_done(self, timeout: Optional[float] = None):
        """Async wrapper around storage's wait_until_done."""
        # Convert blocking call to async
        await asyncio.get_event_loop().run_in_executor(
            None,
            self.storage.wait_until_done,
            timeout
        )

    async def shutdown(self, timeout: Optional[float] = None):
        """Graceful shutdown of logger and storage."""
        try:
            # Wait for remaining tasks
            await self.wait_until_done(timeout)
        finally:
            # Signal shutdown and cleanup
            self.storage.shutdown()


# Global logger instances
_default_logger: Optional[Logger] = None
_current_project: Optional[str] = None


def init_logger(
    project: str,
    sql_uri: Optional[str] = None,
    s3_bucket: Optional[str] = None,
    s3_region: Optional[str] = None,
    pool_config: Optional[PoolConfig] = None,
    experiment: Optional[str] = None,  # This is now treated as experiment_name
) -> Logger:
    """
    Initialize the global logger with project configuration.
    
    Args:
        project: Project name/id
        experiment: Experiment name (optional). If provided, creates an experiment and sets it as current
    """
    try:
        if not isinstance(project, str) or not project.strip():
            raise ValueError("Project name must be a non-empty string")
        
        sql_uri = sql_uri or os.getenv(
            'LOGGER_SQL_URI',
            "postgresql+asyncpg://user:password@localhost:5432/experiment_logs"
        )
        s3_bucket = s3_bucket or os.getenv('LOGGER_S3_BUCKET', "logging-data")
        s3_region = s3_region or os.getenv('LOGGER_S3_REGION', "us-west-1")
        
        # Create storage instance without initializing async components
        storage = SQLStorage(
            sql_uri=sql_uri,
            s3_bucket=s3_bucket,
            s3_region=s3_region,
            pool_config=pool_config
        )
        global _default_logger, _current_project
        _default_logger = Logger(storage=storage)
        _current_project = project.strip()
        
        # Enqueue project creation task
        storage.create_project_async({
            "id": project,
            "name": project,
        })
        
        # Set project ID in context
        current_project_id.set(project)

        # Optionally create experiment and set context
        if experiment:
            experiment_id = create_experiment_id(experiment, project)
            storage.create_experiment_async({
                "id": experiment_id,
                "name": experiment,
                "project_id": project,
            })
            # Set both experiment name and ID in context
            current_experiment_name.set(experiment)
            current_experiment_id.set(experiment_id)
        else:
            current_experiment_name.set(None)
            current_experiment_id.set(None)
    
        # Initialize event loop for background tasks if we're in the main thread
        # and there isn't already an event loop
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # Create a background task for the worker if we're not in an async context
        if not loop.is_running():
            def start_background_loop(loop):
                asyncio.set_event_loop(loop)
                loop.run_forever()

            import threading
            thread = threading.Thread(target=start_background_loop, args=(loop,), daemon=True)
            thread.start()

        return _default_logger
    except Exception as e:
        print(f"Failed to initialize logger: {str(e)}")
        raise


def create_experiment_id(name: str, project_id: str) -> str:
    """Create a deterministic but unique ID for an experiment"""
    name_hash = hashlib.sha256(f"{project_id}:{name}".encode()).hexdigest()
    return f"{name_hash}"[:36]


def traced(_func: Optional[Callable] = None, *,
           experiment_name: Optional[str] = None,
           output_name: Optional[Union[str, List[str]]] = None,
           type: Optional[str] = None,
           name: Optional[str] = None,
           notrace_io: bool = False,
           sample_prob: float = 1.0) -> Callable:
    """
    Decorator to trace function execution with nested context support.

    Args:
        sample_prob: Float between 0 and 1. Represents the probability of tracing.
                    E.g. 0.1 means trace 10% of calls, 1.0 means trace all calls.
    """
    # Check for active logger immediately
    if not _default_logger or sample_prob == 0.0:
        # Instead of raising an error, return a pass-through decorator
        def passthrough(func: Callable[..., T]) -> Callable[..., T]:
            return func
        if callable(_func):
            return passthrough(_func)
        return passthrough

    # Otherwise, we need to trace the function
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        if not _default_logger:
            raise RuntimeError("Logger not initialized. Call init_logger() first.")

        # Get the caller's frame information
        caller_frame = inspect.currentframe().f_back
        source_file = inspect.getfile(caller_frame)
        source_file = os.path.basename(source_file)  # Get just the filename

        # Check if the function is asynchronous
        if asyncio.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                # Move sampling check here, inside the wrapper
                if np.random.random() > sample_prob:
                    return await func(*args, **kwargs)

                # 1. kwargs (runtime)
                # 2. decorator argument (experiment_name)
                # 3. current context
                # 4. default
                effective_experiment_name = (
                    kwargs.pop('experiment_name', None) or  # Runtime kwargs first
                    experiment_name or                      # Decorator argument second
                    current_experiment_name.get(None) or    # Current context third
                    "default_experiment"                    # Default last
                )

                if effective_experiment_name == "default_experiment":
                    log_background(f"No experiment_name provided. Using default: {effective_experiment_name}")

                # Generate experiment ID from name
                project_id = current_project_id.get()
                effective_experiment_id = create_experiment_id(effective_experiment_name, project_id)

                # Pre-create the experiment if necessary
                try:
                    log_background(f"Creating experiment: {effective_experiment_id}")
                    _default_logger.storage.create_experiment_async({
                        "id": effective_experiment_id,
                        "name": effective_experiment_name,
                        "description": f"Auto-created experiment for function {func.__name__} in project {_current_project}",
                        "project_id": current_project_id.get()
                    })
                except Exception as e:
                    if "duplicate key value" not in str(e):
                        log_error(f"Failed to create experiment: {str(e)}")
                        raise

                # Set both name and ID in context
                exp_name_token = current_experiment_name.set(effective_experiment_name)
                exp_id_token = current_experiment_id.set(effective_experiment_id)

                parent_row_id = current_row_id.get()
                if parent_row_id:
                    actual_row_id = parent_row_id
                    row_token = None
                else:
                    actual_row_id = str(uuid.uuid4())
                    row_token = current_row_id.set(actual_row_id)
                try:
                    sig = inspect.signature(func)
                    bound_args = sig.bind(*args, **kwargs)
                    bound_args.apply_defaults()
                    input_data = {name: serialize_object(value)
                                  for name, value in bound_args.arguments.items()} if not notrace_io else None
                    # Enqueue the task without awaiting
                    row_data = {
                        "id": actual_row_id,
                        "experiment_id": effective_experiment_id,
                        "input_data": input_data,
                        "output_data": None,
                        "created_at": datetime.utcnow().isoformat(),
                    }
                    log_background(f"Saving row: {actual_row_id}")
                    _default_logger.storage.save_row(row_data)

                    parent_span = current_span.get(None)
                    parent_span_id = parent_span.id if parent_span else None
                    span_name = name or func.__name__
                    span = Span(
                        name=span_name,
                        row_id=actual_row_id,
                        parent_id=parent_span_id,
                        storage=_default_logger.storage,
                        type=type,
                        source_file=source_file
                    )
                    log_background(f"Starting span: {span.name} (ID: {span.id})")
                    span_token = current_span.set(span)
                    try:
                        if not notrace_io:
                            span.log_input(input_data)

                        result = await func(*args, **kwargs)
                        serialized_result = serialize_object(result)

                        if isinstance(output_name, list):
                            if not isinstance(result, (tuple, list)) or len(result) != len(output_name):
                                raise ValueError(
                                    f"Expected {len(output_name)} return values for output_names {output_name}, "
                                    f"but got {type(result)} with {len(result) if isinstance(result, (tuple, list)) else 1} values"
                                )
                            output_data = dict(zip(output_name, map(serialize_object, result)))
                        else:
                            output_key = output_name or _determine_output_key(func, serialized_result)
                            output_data = {output_key: serialized_result}
                        if not notrace_io:
                            span.log_output(output_data)
                            if row_token:
                                log_background(f"Updating row output: {actual_row_id} with {output_data}")
                                _default_logger.storage.update_row_output(actual_row_id, output_data)
                        span.end()
                        log_background(f"Span ended: {span.name} (ID: {span.id})")
                        return result
                    except Exception as e:
                        log_error(f"Error in span {span.name}: {str(e)}")
                        span.log_error(str(e))
                        span.end()
                        raise
                    finally:
                        current_span.reset(span_token)
                except Exception as e:
                    log_error(f"Error in async_wrapper: {str(e)}")
                    raise
                finally:
                    if row_token:
                        current_row_id.reset(row_token)
                    if exp_id_token:
                        current_experiment_id.reset(exp_id_token)
                    if exp_name_token:
                        current_experiment_name.reset(exp_name_token)

            return async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                # Move sampling check here, inside the wrapper
                if np.random.random() > sample_prob:
                    return func(*args, **kwargs)
                # Synchronous version of the wrapper

                # 1. kwargs (runtime)
                # 2. decorator argument (experiment_name)
                # 3. current context
                # 4. default
                effective_experiment_name = (
                    kwargs.pop('experiment_name', None) or  # Runtime kwargs first
                    experiment_name or                      # Decorator argument second
                    current_experiment_name.get(None) or    # Current context third
                    "default_experiment"                    # Default last
                )

                if effective_experiment_name == "default_experiment":
                    log_background(f"No experiment_name provided. Using default: {effective_experiment_name}")

                # Generate experiment ID from name
                project_id = current_project_id.get()
                effective_experiment_id = create_experiment_id(effective_experiment_name, project_id)

                # Pre-create the experiment if necessary
                try:
                    log_background(f"Creating experiment: {effective_experiment_id}")
                    _default_logger.storage.create_experiment_async({
                        "id": effective_experiment_id,
                        "name": effective_experiment_name,
                        "description": f"Auto-created experiment for function {func.__name__} in project {_current_project}",
                        "project_id": current_project_id.get()
                    })
                except Exception as e:
                    if "duplicate key value" not in str(e):
                        log_error(f"Failed to create experiment: {str(e)}")
                        raise

                # Set both name and ID in context
                exp_name_token = current_experiment_name.set(effective_experiment_name)
                exp_id_token = current_experiment_id.set(effective_experiment_id)

                parent_row_id = current_row_id.get()
                if parent_row_id:
                    actual_row_id = parent_row_id
                    row_token = None
                else:
                    actual_row_id = str(uuid.uuid4())
                    row_token = current_row_id.set(actual_row_id)
                try:
                    sig = inspect.signature(func)
                    bound_args = sig.bind(*args, **kwargs)
                    bound_args.apply_defaults()
                    input_data = {name: serialize_object(value)
                                  for name, value in bound_args.arguments.items()} if not notrace_io else None
                    # Save the row synchronously
                    row_data = {
                        "id": actual_row_id,
                        "experiment_id": effective_experiment_id,
                        "input_data": input_data,
                        "output_data": None,
                        "created_at": datetime.utcnow().isoformat(),
                    }
                    log_background(f"Saving row: {actual_row_id}")
                    _default_logger.storage.save_row(row_data)

                    parent_span = current_span.get(None)
                    parent_span_id = parent_span.id if parent_span else None
                    span_name = name or func.__name__
                    span = Span(
                        name=span_name,
                        row_id=actual_row_id,
                        parent_id=parent_span_id,
                        storage=_default_logger.storage,
                        type=type,
                        source_file=source_file
                    )
                    log_background(f"Starting span: {span.name} (ID: {span.id})")
                    span_token = current_span.set(span)
                    try:
                        if not notrace_io:
                            span.log_input(input_data)

                        result = func(*args, **kwargs)
                        serialized_result = serialize_object(result)

                        if isinstance(output_name, list):
                            if not isinstance(result, (tuple, list)) or len(result) != len(output_name):
                                raise ValueError(
                                    f"Expected {len(output_name)} return values for output_names {output_name}, "
                                    f"but got {type(result)} with {len(result) if isinstance(result, (tuple, list)) else 1} values"
                                )
                            output_data = dict(zip(output_name, map(serialize_object, result)))
                        else:
                            output_key = output_name or _determine_output_key(func, serialized_result)
                            output_data = {output_key: serialized_result}
                        if not notrace_io:
                            span.log_output(output_data)
                            if row_token:
                                log_background(f"Updating row output: {actual_row_id} with {output_data}")
                                _default_logger.storage.update_row_output(actual_row_id, output_data)
                        span.end()
                        log_background(f"Span ended: {span.name} (ID: {span.id})")
                        return result
                    except Exception as e:
                        log_error(f"Error in span {span.name}: {str(e)}")
                        span.log_error(str(e))
                        span.end()
                        raise
                    finally:
                        current_span.reset(span_token)
                except Exception as e:
                    log_error(f"Error in sync_wrapper: {str(e)}")
                    raise
                finally:
                    if row_token:
                        current_row_id.reset(row_token)
                    if exp_id_token:
                        current_experiment_id.reset(exp_id_token)
                    if exp_name_token:
                        current_experiment_name.reset(exp_name_token)

            return sync_wrapper

    # Handle the case when the decorator is used without parentheses
    if callable(_func):
        return decorator(_func)
    else:
        return decorator


def _determine_output_key(func: Callable, result: Any) -> str:
    """Helper function to determine the output key based on return annotation or type."""
    return_annotation = inspect.signature(func).return_annotation
    if return_annotation is not inspect.Signature.empty:
        origin = get_origin(return_annotation)
        if origin:
            origin_name = origin.__name__ if hasattr(origin, '__name__') else str(origin)
            return origin_name.lower()
        elif hasattr(return_annotation, '__name__'):
            return return_annotation.__name__.lower()
    return type(result).__name__.lower() if hasattr(type(result), '__name__') else "return_value"
