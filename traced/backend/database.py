from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from typing import AsyncGenerator, Dict, Any
from contextlib import asynccontextmanager
import os


# Cache for engines and session makers
_engines: Dict[str, Any] = {}
_async_session_makers: Dict[str, async_sessionmaker[AsyncSession]] = {}

def get_database_url(db_name: str, async_url: bool = False) -> str:
    """Generate database URL based on environment variables and database type."""
    # Get database configuration from environment variables or use defaults
    db_type = os.getenv("TRACED_DB_TYPE", "postgresql")  # or "mysql"
    db_user = os.getenv("TRACED_DB_USER", "user")
    db_pass = os.getenv("TRACED_DB_PASS", "password")
    db_host = os.getenv("TRACED_DB_HOST", "localhost")
    db_port = os.getenv("TRACED_DB_PORT", "5432" if db_type == "postgresql" else "3306")
    
    # Override with full URL if provided
    if db_url := os.getenv("TRACED_DATABASE_URL"):
        return db_url

    # Construct dialect based on database type and async flag
    if db_type == "postgresql":
        dialect = "postgresql+asyncpg" if async_url else "postgresql+psycopg2"
    else:  # mysql
        dialect = "mysql+aiomysql" if async_url else "mysql+pymysql"
    
    return f"{dialect}://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

def create_async_engine_for_db(db_name: str):
    """Create an async engine for the specified database."""
    if db_name not in _engines:
        _engines[db_name] = create_async_engine(
            get_database_url(db_name, async_url=True),
            pool_pre_ping=True,
            pool_recycle=3600,
            pool_size=5,
            max_overflow=10,
            pool_timeout=30,
            echo=os.environ.get('ENVIRONMENT') == 'development'
        )
    return _engines[db_name]

def get_async_session_maker(db_name: str) -> async_sessionmaker[AsyncSession]:
    """Get or create a session maker for the specified database."""
    if db_name not in _async_session_makers:
        engine = create_async_engine_for_db(db_name)
        _async_session_makers[db_name] = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
    return _async_session_makers[db_name]

@asynccontextmanager
async def get_async_session(db_name: str) -> AsyncGenerator[AsyncSession, None]:
    """Async context manager for database sessions."""
    session_maker = get_async_session_maker(db_name)
    async with session_maker() as session:
        try:
            yield session
        finally:
            await session.close()

def get_db(db_name: str):
    """Create a database session dependency that can be used with FastAPI."""
    async def db_dependency() -> AsyncGenerator[AsyncSession, None]:
        async with get_async_session(db_name) as session:
            yield session
    return db_dependency

# Function to clear engine and session maker caches
def clear_db_caches():
    """Clear the cached engines and session makers."""
    _engines.clear()
    _async_session_makers.clear()