"""Default market groups shared by the API and synthetic MT5 symbols."""

from __future__ import annotations

import json
import os
from copy import deepcopy


DEFAULT_MATRIX_GROUPS = {
    "us_stocks": ["US500Cash#", "Nasdaq", "US30Cash#"],
    "eu_stocks": [
        "GER40Cash", "UK100Cash", "EU50Cash", "FRA40Cash",
        "IT40Cash", "SWI20Cash", "SPAIN35Cash", "NETH25Cash",
    ],
    "commodities": ["OILCash#", "GOLD.i#", "SILVER.i#"],
    "crypto": ["BTCUSD", "ETHUSD", "SOLUSD"],
    "usd_assets": [
        "USD_FX_Index#", "US500Cash#", "Nasdaq", "US30Cash#",
        "OILCash#", "GOLD.i#", "SILVER.i#", "BTCUSD", "ETHUSD", "SOLUSD",
    ],
}


def merge_matrix_groups(groups: object) -> dict[str, list[str]]:
    """Fill missing groups from defaults while preserving configured groups."""
    merged = deepcopy(DEFAULT_MATRIX_GROUPS)
    if isinstance(groups, dict):
        for key, symbols in groups.items():
            if isinstance(key, str) and isinstance(symbols, list):
                merged[key] = symbols
    return merged


def load_app_config(path: str) -> dict:
    """Load user settings and supply defaults for newly introduced groups."""
    config = {}
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as config_file:
                loaded = json.load(config_file)
            if isinstance(loaded, dict):
                config = loaded
        except (OSError, ValueError, TypeError):
            pass
    config["matrix_groups"] = merge_matrix_groups(config.get("matrix_groups"))
    return config
