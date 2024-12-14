import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.append(str(Path(__file__).resolve().parents[3]))

from traced.backend.routers.experiment_router import router as experiment_router
# from src.serving.research.autoloop_router import router as autolooop_router
from traced.backend.routers.feedback_router import router as feedback_router
from traced.backend.routers.prompt_router import router as prompt_router

from traced.backend.middleware import base_middleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(base_middleware)

app.include_router(experiment_router, prefix="/api/ml")
app.include_router(prompt_router, prefix="/api/ml")
app.include_router(feedback_router, prefix="/api/ml")


@app.get("/api/ml/health")
async def health_check():
    return {"status": "healthy"}
