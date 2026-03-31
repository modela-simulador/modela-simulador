"""Pydantic models for the subdivision API."""
from pydantic import BaseModel
from typing import Optional

class ProductAllocation(BaseModel):
    family_id: str
    product_id: str
    percentage: float  # 0-100
    lot_size_m2: Optional[float] = None  # for comercio/equipamiento

class SubdivisionRequest(BaseModel):
    macrolote_fids: list[str]  # support multiple macrolotes
    product_allocations: list[ProductAllocation]
    max_viviendas: Optional[int] = None  # district-level max housing cap

class LotResult(BaseModel):
    geometry: dict
    product: str
    area_m2: float
    units: int
    frontage_m: float

class SubdivisionMetrics(BaseModel):
    total_lots: int
    total_units: int
    units_by_product: dict[str, int]
    street_area_m2: float
    park_area_m2: float
    efficiency_pct: float
    density_per_ha: float
    total_value_uf: float
    value_by_product: dict[str, float]

class SubdivisionResponse(BaseModel):
    streets: list[dict]
    lots: list[LotResult]
    parks: list[dict]
    metrics: SubdivisionMetrics
