# docker/backend.Dockerfile
FROM python:3.9

WORKDIR /app

# Copy requirements first for better caching
COPY setup.py .
COPY README.md .
COPY traced traced/

# Install dependencies
RUN pip install ".[ui,postgresql]"

# Run backend
CMD ["python", "-m", "uvicorn", "traced.backend.main:app", "--host", "0.0.0.0", "--port", "8000"]