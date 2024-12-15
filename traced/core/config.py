# traced/core/config.py
from pathlib import Path
import json

DEFAULT_CONFIG_PATH = Path.home() / ".traced" / "config.json"

def save_config(sql_url: str, config_path: Path = DEFAULT_CONFIG_PATH):
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, 'w') as f:
        json.dump({"sql_url": sql_url}, f)