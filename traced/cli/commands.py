import click
import uvicorn
import os
import webbrowser
from multiprocessing import Process
import signal
import sys
from typing import Optional

# Environment variable name for database URL
TRACED_DATABASE_URL = "TRACED_DATABASE_URL"

@click.group()
def cli():
    """Traced CLI tool for experiment tracking"""
    pass

def run_backend(port: int, db_url: Optional[str] = None):
    # Set environment variable for database URL if provided
    if db_url:
        os.environ[TRACED_DATABASE_URL] = db_url
    
    from traced.backend.main import app
    uvicorn.run(app, host="0.0.0.0", port=port)

def run_frontend(port):
    # Serve frontend static files using a simple HTTP server
    import http.server
    import socketserver
    
    frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend/build')
    if not os.path.exists(frontend_dir):
        click.echo(f"Error: Frontend build directory not found at {frontend_dir}")
        sys.exit(1)
        
    os.chdir(frontend_dir)
    
    Handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("", port), Handler)
    httpd.serve_forever()

@cli.command()
@click.option('--backend-port', default=8000, help='Port for the backend server')
@click.option('--frontend-port', default=3000, help='Port for the frontend server')
@click.option('--db-url', 
              envvar=TRACED_DATABASE_URL,
              help='Database URL. Can also be set via TRACED_DATABASE_URL environment variable. '
                   'Example: postgresql+asyncpg://user:password@localhost:5432/experiment_logs')
@click.option('--db-type', 
              type=click.Choice(['postgresql', 'mysql']), 
              default='postgresql',
              help='Database type to use if no URL is provided')
def startup(backend_port: int, frontend_port: int, db_url: Optional[str], db_type: str):
    """Start both backend and frontend servers"""
    
    # If no db_url is provided, use default local database URL based on db_type
    if not db_url:
        if db_type == 'postgresql':
            db_url = "postgresql+asyncpg://user:password@localhost:5432/experiment_logs"
        else:  # mysql
            db_url = "mysql+aiomysql://user:password@localhost:3306/experiment_logs"
        
        click.echo(f"No database URL provided. Using default local {db_type} database: {db_url}")
    
    click.echo(f"Starting Traced servers...")
    
    # Start backend process with database configuration
    backend_process = Process(target=run_backend, args=(backend_port, db_url))
    backend_process.start()
    
    # Start frontend process
    frontend_process = Process(target=run_frontend, args=(frontend_port,))
    frontend_process.start()
    
    # Open browser
    webbrowser.open(f'http://localhost:{frontend_port}')
    
    click.echo(f"Backend running on http://localhost:{backend_port}")
    click.echo(f"Frontend running on http://localhost:{frontend_port}")
    
    def signal_handler(sig, frame):
        click.echo("Shutting down servers...")
        backend_process.terminate()
        frontend_process.terminate()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    # Keep the main process running
    try:
        backend_process.join()
        frontend_process.join()
    except KeyboardInterrupt:
        click.echo("Shutting down servers...")
        backend_process.terminate()
        frontend_process.terminate()

@cli.command()
def version():
    """Show the version of traced"""
    from traced import __version__
    click.echo(f"traced version {__version__}")

if __name__ == '__main__':
    cli()
