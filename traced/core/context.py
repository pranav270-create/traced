# src/logger/context.py
import contextvars

# Context variables with default values
current_experiment_name = contextvars.ContextVar('current_experiment_name', default=None)
current_experiment_id = contextvars.ContextVar('current_experiment_id', default=None)
current_row_id = contextvars.ContextVar('current_row_id', default=None)
current_span_id = contextvars.ContextVar('current_span_id', default=None)
current_span = contextvars.ContextVar('current_span', default=None)
current_project_id = contextvars.ContextVar('current_project_id', default=None)
