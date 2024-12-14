from setuptools import setup, find_packages
import os
import subprocess
from setuptools.command.develop import develop
from setuptools.command.install import install
import sys

# Read frontend files
def package_files(directory):
    paths = []
    for (path, directories, filenames) in os.walk(directory):
        for filename in filenames:
            paths.append(os.path.join('..', path, filename))
    return paths

# Get frontend files
frontend_files = package_files('traced/frontend/build')

class PreInstallCommand(install):
    """Pre-installation for installation mode."""
    def run(self):
        try:
            subprocess.check_call(['npm', 'install'], cwd='traced/frontend')
            subprocess.check_call(['npm', 'run', 'build'], cwd='traced/frontend')
        except subprocess.CalledProcessError as e:
            print("Warning: Failed to build frontend. UI may not be available.")
            print(e)
        install.run(self)

class PreDevelopCommand(develop):
    """Pre-installation for development mode."""
    def run(self):
        try:
            subprocess.check_call(['npm', 'install'], cwd='traced/frontend')
            subprocess.check_call(['npm', 'run', 'build'], cwd='traced/frontend')
        except subprocess.CalledProcessError as e:
            print("Warning: Failed to build frontend. UI may not be available.")
            print(e)
        develop.run(self)

setup(
    name="traced",
    version="0.1.0",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        'traced': frontend_files + ['frontend/build/*', 'frontend/build/**/*']
    },
    install_requires=[
        # Core dependencies
        "sqlalchemy>=2.0.0",
        "aioboto3>=11.0.0",
        "numpy>=1.21.0",
        "termcolor>=2.0.0",
        "gitpython>=3.1.0",
        
        # FastAPI and related
        "fastapi>=0.68.0",
        "uvicorn>=0.15.0",
        "websockets>=10.0",  # For WebSocket support
        "python-multipart>=0.0.5",  # For form data
        
        # CLI
        "click>=8.0.0",
        
        # Database
        "sqlalchemy[asyncio]>=2.0.0",  # Async support
        "aiosqlite>=0.17.0",  # Async SQLite
        "asyncpg>=0.27.0",  # Async PostgreSQL
        
        # Utilities
        "python-dateutil>=2.8.2",
        "pydantic>=1.8.0",
        "typing-extensions>=4.0.0",
        "aiohttp>=3.8.0",
        "difflib3>=0.1.0",  # For difflib support
        
        # Git support
        "gitpython>=3.1.0",  # Already had this one
        
        # Core Python enhancements
        "dataclasses>=0.8;python_version<'3.7'",  # For Python < 3.7
        "typing-extensions>=4.0.0",  # Already had this
        
        # Async support
        "asyncio>=3.4.3",  # For Python < 3.7
        "aioboto3>=11.0.0",  # Already had this
        
        # Logging and output
        "termcolor>=2.0.0",  # Already had this
        
        # Utilities
        "python-dateutil>=2.8.2",  # Already had this
        "hashlib>=20081119" if sys.version_info < (3, 6) else "",  # Only if needed
        
        # Database
        "sqlalchemy[asyncio]>=2.0.0",  # Already had this
        "asyncpg>=0.27.0",  # Already had this
        
        # Numpy for sampling
        "numpy>=1.21.0",  # Already had this
    ],
    entry_points={
        'console_scripts': [
            'traced=traced.cli.commands:cli',
        ],
    },
    extras_require={
        'dev': [
            'pytest>=6.0',
            'pytest-asyncio>=0.14.0',
            'black>=21.0',
            'mypy>=0.900',
            'isort>=5.0.0',
            'flake8>=3.9.0',
            'pytest-cov>=2.12.0',
        ],
        'docs': [
            'sphinx>=4.0.0',
            'sphinx-rtd-theme>=0.5.0',
            'sphinx-autodoc-typehints>=1.12.0',
        ],
        'mysql': [
            'aiomysql>=0.1.1',  # Async MySQL
            'mysqlclient>=2.0.0',  # Sync MySQL (if needed)
        ],
        'postgresql': [
            'asyncpg>=0.27.0',  # Already in main requirements, but listed here for clarity
            'psycopg2-binary>=2.9.0',  # Sync PostgreSQL (if needed)
        ],
    },
    author="Your Name",
    author_email="your.email@example.com",
    description="A tracing library for Python functions with experiment tracking",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/traced",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.7",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Framework :: FastAPI",
        "Framework :: AsyncIO",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Software Development :: Testing",
        "Topic :: System :: Logging",
    ],
    python_requires=">=3.7",
    cmdclass={
        'develop': PreDevelopCommand,
        'install': PreInstallCommand,
    },
)