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

def build_frontend():
    """Build frontend if the directory exists."""
    if os.path.exists('traced/frontend'):
        try:
            subprocess.check_call(['npm', 'install'], cwd='traced/frontend')
            subprocess.check_call(['npm', 'run', 'build'], cwd='traced/frontend')
            return True
        except subprocess.CalledProcessError as e:
            print("Warning: Failed to build frontend. UI may not be available.")
            print(e)
    return False

class PreInstallCommand(install):
    """Pre-installation for installation mode."""
    def run(self):
        build_frontend()
        install.run(self)

class PreDevelopCommand(develop):
    """Pre-installation for development mode."""
    def run(self):
        build_frontend()
        develop.run(self)

setup(
    name="traced",
    version="0.1.5",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        'traced': ['frontend/build/**/*'] if os.path.exists('traced/frontend/build') else []
    },
    install_requires=[
        # Core SQL and async support
        "sqlalchemy>=2.0.0",
        "sqlalchemy[asyncio]>=2.0.0",
        
        # Core utilities
        "pydantic>=1.8.0",
        "typing-extensions>=4.0.0",
        "python-dateutil>=2.8.2",
        
        # Logging and output
        "termcolor>=2.0.0",
        
        # Git integration
        "gitpython>=3.1.0",
        
        # Numpy for core operations
        "numpy>=1.21.0",

        # AWS
        "aioboto3>=11.0.0",
    ],
    extras_require={
        # UI Components (frontend + backend)
        'ui': [
            # Backend
            "fastapi>=0.68.0",
            "uvicorn>=0.15.0",
            "websockets>=10.0",
            "python-multipart>=0.0.5",
            "click>=8.0.0",  # For CLI commands
            "aiohttp>=3.8.0",
            
            # Frontend dependencies will be handled by npm during install
        ],
        
        # Database Drivers
        'postgresql': [
            'asyncpg>=0.27.0',
            'psycopg2-binary>=2.9.0',
        ],
        'mysql': [
            'aiomysql>=0.1.1',
            'mysqlclient>=2.0.0',
        ],
        
        # AWS Integration
        'aws': [
            "aioboto3>=11.0.0",
        ],
        
        # Data Processing
        'data': [
            "numpy>=1.21.0",
            "difflib3>=0.1.0",
        ],
        
        # Development Tools
        'dev': [
            'pytest>=6.0',
            'pytest-asyncio>=0.14.0',
            'black>=21.0',
            'mypy>=0.900',
            'isort>=5.0.0',
            'flake8>=3.9.0',
            'pytest-cov>=2.12.0',
        ],
        
        # Documentation
        'docs': [
            'sphinx>=4.0.0',
            'sphinx-rtd-theme>=0.5.0',
            'sphinx-autodoc-typehints>=1.12.0',
        ],
        
        # Full installation (everything except dev tools)
        'full': [
            "fastapi>=0.68.0",
            "uvicorn>=0.15.0",
            "websockets>=10.0",
            "python-multipart>=0.0.5",
            "click>=8.0.0",
            "aiohttp>=3.8.0",
            'asyncpg>=0.27.0',
            'psycopg2-binary>=2.9.0',
            'aiomysql>=0.1.1',
            "aioboto3>=11.0.0",
            "numpy>=1.21.0",
            "difflib3>=0.1.0",
        ],
    },
    entry_points={
        'console_scripts': [
            'traced=cli.commands:cli',
        ],
    },
    author="Pranav Iyer",
    author_email="pranaviyer2@gmail.com",
    description="A tracing library for Python functions with experiment tracking",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/pranav270-create/traced",
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