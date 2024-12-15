"""
traced - A tracing library for Python functions with experiment tracking
"""

from .core.complete_async import init_logger, traced, get_current_span
from .core.context import (
    current_experiment_name,
    current_experiment_id,
    current_row_id,
    current_span_id,
    current_span,
    current_project_id,
)

__version__ = "0.1.4"

__all__ = [
    "init_logger",
    "traced",
    "get_current_span",
    "current_experiment_name",
    "current_experiment_id",
    "current_row_id",
    "current_span_id",
    "current_span",
    "current_project_id",
]