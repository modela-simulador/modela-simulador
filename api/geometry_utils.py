"""Geometry helpers using Shapely for subdivision operations."""
from __future__ import annotations
from typing import Union, List
from shapely.geometry import Polygon, MultiPolygon, LineString, box, mapping
from shapely.ops import split, unary_union
from shapely.affinity import rotate
import numpy as np
import math


def get_buildable_area(macrolote: Union[Polygon, MultiPolygon], green_areas: list) -> List[Polygon]:
    """Subtract green areas from macrolote to get buildable sub-polygons."""
    if isinstance(macrolote, MultiPolygon):
        macro = unary_union(list(macrolote.geoms))
    else:
        macro = macrolote

    greens = unary_union(green_areas) if green_areas else Polygon()
    buildable = macro.difference(greens)

    if buildable.is_empty:
        return []
    if isinstance(buildable, Polygon):
        return [buildable]
    return list(buildable.geoms)


def minimum_rotated_rectangle_angle(polygon: Polygon) -> float:
    """Get the rotation angle of the minimum rotated bounding rectangle."""
    mrr = polygon.minimum_rotated_rectangle
    coords = list(mrr.exterior.coords)
    edge1 = np.array(coords[1]) - np.array(coords[0])
    edge2 = np.array(coords[2]) - np.array(coords[1])
    # Use the longer edge as the primary axis
    if np.linalg.norm(edge1) >= np.linalg.norm(edge2):
        angle = math.atan2(edge1[1], edge1[0])
    else:
        angle = math.atan2(edge2[1], edge2[0])
    return math.degrees(angle)


def create_street_line(polygon: Polygon, position_ratio: float, angle_deg: float,
                       width: float = 12.0, depth: int = 0) -> Polygon:
    """Create a street polygon cutting through a polygon.

    Urban design principles — inspired by Chilean loteos:
    - Depth 0 (primary arteries): perfectly straight, 12-14m wide
    - Depth 1 (collectors): straight with very subtle angle offset (2-4°),
      creates natural T-intersections
    - Depth 2+ (interior/residential): gentle single arc (not S-curve),
      narrower width (10-11m), slight angle variety for organic feel
    - The key insight: real urban grids get character from subtle angular
      offsets at intersections, NOT from wavy lines. A 3-5° rotation
      between depth levels creates visual interest while keeping streets
      functional and buildable.
    """
    center = polygon.centroid
    bounds = polygon.bounds  # minx, miny, maxx, maxy
    diagonal = math.sqrt((bounds[2] - bounds[0])**2 + (bounds[3] - bounds[1])**2)

    # NO angle perturbation — Chilean loteos use clean orthogonal grids.
    # Perturbation created diagonal streets that intersect nonsensically.
    # T-intersections come naturally from the recursive depth alternation
    # (depth 0 cuts one way, depth 1 cuts perpendicular).
    effective_angle = angle_deg

    # Adjust width by depth — arterials wider, residential narrower
    if depth == 0:
        effective_width = width  # 12m default
    elif depth == 1:
        effective_width = width * 0.95  # ~11.4m
    else:
        effective_width = width * 0.88  # ~10.5m for interior streets

    # Create line perpendicular to the (perturbed) main axis
    angle_rad = math.radians(effective_angle + 90)
    dx = math.cos(angle_rad) * diagonal
    dy = math.sin(angle_rad) * diagonal

    # Offset from center based on position_ratio (-0.5 to 0.5)
    offset_rad = math.radians(effective_angle)
    offset_dist = position_ratio * diagonal * 0.5
    cx = center.x + math.cos(offset_rad) * offset_dist
    cy = center.y + math.sin(offset_rad) * offset_dist

    # All streets are perfectly straight — clean orthogonal grid.
    line = LineString([
        (cx - dx, cy - dy),
        (cx + dx, cy + dy)
    ])

    street = line.buffer(effective_width / 2, cap_style="flat")
    return street.intersection(polygon)


def split_polygon_with_street(polygon: Polygon, street: Polygon) -> list[Polygon]:
    """Split a polygon using a street corridor, returning the remaining parcels."""
    remainder = polygon.difference(street)
    if remainder.is_empty:
        return []
    if isinstance(remainder, Polygon):
        return [remainder] if remainder.area > 100 else []  # filter tiny slivers
    return [g for g in remainder.geoms if isinstance(g, Polygon) and g.area > 100]


def apply_chamfer(polygon: Polygon, chamfer_m: float = 3.0) -> Polygon:
    """Apply ochavos (chamfered corners) to a polygon."""
    # Negative buffer then positive buffer creates rounded/chamfered corners
    return polygon.buffer(-chamfer_m).buffer(chamfer_m * 0.8)


def calculate_frontage(lot: Polygon, streets: list[Polygon]) -> float:
    """Calculate how much of a lot's perimeter touches streets."""
    street_union = unary_union(streets) if streets else Polygon()
    lot_boundary = lot.boundary
    # Buffer the street slightly to catch adjacency
    street_buffered = street_union.buffer(1.0)
    intersection = lot_boundary.intersection(street_buffered)
    return intersection.length if not intersection.is_empty else 0.0


def min_side_length(polygon: Polygon) -> float:
    """Return the shorter side of the minimum rotated bounding rectangle.

    This represents the narrowest dimension of the lot, useful for
    ensuring lots are wide enough for their intended product type.
    """
    if not isinstance(polygon, Polygon) or polygon.is_empty:
        return 0.0
    mrr = polygon.minimum_rotated_rectangle
    coords = list(mrr.exterior.coords)
    edge1 = math.sqrt((coords[1][0] - coords[0][0])**2 + (coords[1][1] - coords[0][1])**2)
    edge2 = math.sqrt((coords[2][0] - coords[1][0])**2 + (coords[2][1] - coords[1][1])**2)
    return min(edge1, edge2)


def max_side_length(polygon: Polygon) -> float:
    """Return the longer side of the minimum rotated bounding rectangle."""
    mrr = polygon.minimum_rotated_rectangle
    coords = list(mrr.exterior.coords)
    edge1 = math.sqrt((coords[1][0] - coords[0][0])**2 + (coords[1][1] - coords[0][1])**2)
    edge2 = math.sqrt((coords[2][0] - coords[1][0])**2 + (coords[2][1] - coords[1][1])**2)
    return max(edge1, edge2)


def aspect_ratio(polygon: Polygon) -> float:
    """Return the aspect ratio (long side / short side) of the minimum rotated bounding rect.

    A square lot returns 1.0; a lot with 1:3 proportion returns 3.0.
    Strip/franja lots have high aspect ratios (>3).
    """
    if not isinstance(polygon, Polygon) or polygon.is_empty:
        return 999.0
    mrr = polygon.minimum_rotated_rectangle
    coords = list(mrr.exterior.coords)
    edge1 = math.sqrt((coords[1][0] - coords[0][0])**2 + (coords[1][1] - coords[0][1])**2)
    edge2 = math.sqrt((coords[2][0] - coords[1][0])**2 + (coords[2][1] - coords[1][1])**2)
    short = min(edge1, edge2)
    long = max(edge1, edge2)
    if short < 1:
        return 999.0
    return long / short


def has_acute_angle(polygon: Polygon, min_angle_deg: float = 30.0) -> bool:
    """Check if any internal angle of the polygon is less than min_angle_deg.

    Acute angles (< 30°) produce pointed, triangular-looking lot corners
    that are impractical for construction.  This catches lots that pass the
    vertex-count triangle test but still LOOK triangular because of a sharp
    wedge corner.

    Uses the simplified polygon (5m tolerance) to ignore tiny coordinate
    noise while catching real geometric wedges.
    """
    if not isinstance(polygon, Polygon) or polygon.is_empty:
        return False
    # Simplify slightly to remove coordinate noise but keep real shape
    simplified = polygon.simplify(3.0, preserve_topology=True)
    if not hasattr(simplified, 'exterior'):
        return False
    coords = list(simplified.exterior.coords)
    if coords[0] == coords[-1]:
        coords = coords[:-1]  # remove closing duplicate
    n = len(coords)
    if n < 3:
        return False

    for i in range(n):
        p1 = np.array(coords[(i - 1) % n])
        p2 = np.array(coords[i])
        p3 = np.array(coords[(i + 1) % n])
        v1 = p1 - p2
        v2 = p3 - p2
        len1 = np.linalg.norm(v1)
        len2 = np.linalg.norm(v2)
        if len1 < 1.0 or len2 < 1.0:
            continue  # skip degenerate edges
        cos_angle = np.dot(v1, v2) / (len1 * len2)
        cos_angle = np.clip(cos_angle, -1.0, 1.0)
        angle = np.degrees(np.arccos(cos_angle))
        if angle < min_angle_deg:
            return True
    return False


def is_triangular(polygon: Polygon, tolerance: float = 5.0) -> bool:
    """Check if a polygon is effectively triangular or has sharp wedge corners.

    Three detection methods:
    1. Douglas-Peucker simplification — if polygon reduces to 3 vertices at
       any reasonable tolerance, it's a triangle.
    2. MRR fill ratio — triangles fill ~50% of their bounding rect vs
       ~85-100% for rectangles.
    3. Acute angle detection — any internal angle < 25° means the lot has a
       sharp wedge/point that makes it look and behave like a triangle.
    """
    # Safety: handle non-Polygon types (GeometryCollection, Multi)
    if not isinstance(polygon, Polygon):
        if hasattr(polygon, 'geoms'):
            polys = [g for g in polygon.geoms if isinstance(g, Polygon) and g.area > 10]
            if polys:
                polygon = max(polys, key=lambda g: g.area)
            else:
                return True  # degenerate → treat as triangular
        else:
            return True

    # Method 1: simplification at multiple tolerances
    for tol in [tolerance, tolerance * 2, tolerance * 3]:
        simplified = polygon.simplify(tol, preserve_topology=True)
        if not hasattr(simplified, 'exterior'):
            continue
        coords = list(simplified.exterior.coords)
        # Exterior ring has N+1 coords (first=last), so 4 coords = triangle
        if len(coords) <= 4:
            return True

    # Method 2: area ratio to minimum rotated rectangle
    # TRUE triangles fill ~50% of their bounding rect; rectangles fill ~85-100%.
    # Diamonds/parallelograms fill ~55-70% — these are usable lots, not triangles.
    # Only flag genuine triangles (fill < 0.55), not borderline diamonds.
    try:
        mrr = polygon.minimum_rotated_rectangle
        if mrr.area > 0:
            fill_ratio = polygon.area / mrr.area
            if fill_ratio < 0.55:
                return True
    except Exception:
        pass

    # Method 3: acute angle detection — wedge corners < 35°
    # 35° catches more wedge shapes that LOOK triangular even if they
    # technically have 4+ vertices
    if has_acute_angle(polygon, min_angle_deg=35.0):
        return True

    return False


def polygon_to_geojson(polygon: Polygon) -> dict:
    """Convert Shapely polygon to GeoJSON dict."""
    return mapping(polygon)
