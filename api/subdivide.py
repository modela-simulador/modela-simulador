"""Core subdivision algorithm: recursive bisection with constraints."""
import geopandas as gpd
from shapely.geometry import Polygon, MultiPolygon, LineString, shape, mapping, Point
from shapely.ops import unary_union
import os
import math

from geometry_utils import (
    get_buildable_area,
    minimum_rotated_rectangle_angle,
    create_street_line,
    split_polygon_with_street,
    apply_chamfer,
    calculate_frontage,
    min_side_length,
    max_side_length,
    aspect_ratio,
    is_triangular,
    has_acute_angle,
    polygon_to_geojson,
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Product definitions — synced with simulador inmobiliario (simulador.html)
# incidencia = fraction of sale price that corresponds to land value
# min_side_m = minimum dimension (shortest side of bounding rect) in meters
PRODUCTS = {
    "casas1":      {"efficiency": 35,  "min_units": 45,  "max_units": 90,  "min_lot_ha": 1.3,  "price_uf": 4900, "incidencia": 0.10, "min_side_m": 90},
    "casas2":      {"efficiency": 32,  "min_units": 45,  "max_units": 90,  "min_lot_ha": 1.4,  "price_uf": 5900, "incidencia": 0.10, "min_side_m": 90},
    "casas3":      {"efficiency": 30,  "min_units": 45,  "max_units": 90,  "min_lot_ha": 1.5,  "price_uf": 6900, "incidencia": 0.10, "min_side_m": 90},
    "townhouses1": {"efficiency": 55,  "min_units": 55,  "max_units": 75,  "min_lot_ha": 1.0,  "price_uf": 4700, "incidencia": 0.10, "min_side_m": 90},
    "townhouses2": {"efficiency": 52,  "min_units": 55,  "max_units": 75,  "min_lot_ha": 1.1,  "price_uf": 5500, "incidencia": 0.10, "min_side_m": 90},
    "townhouses3": {"efficiency": 49,  "min_units": 55,  "max_units": 75,  "min_lot_ha": 1.1,  "price_uf": 6500, "incidencia": 0.10, "min_side_m": 90},
    "ds19":        {"efficiency": 190, "min_units": 300, "max_units": 450, "min_lot_ha": 2.1,  "price_uf": 2200, "incidencia": 0.12, "min_side_m": 60},
    "deptos1":     {"efficiency": 190, "min_units": 120, "max_units": 220, "min_lot_ha": 0.75, "price_uf": 3500, "incidencia": 0.14, "min_side_m": 60},
    "deptos2":     {"efficiency": 190, "min_units": 120, "max_units": 220, "min_lot_ha": 0.75, "price_uf": 4000, "incidencia": 0.14, "min_side_m": 60},
    "deptos3":     {"efficiency": 190, "min_units": 120, "max_units": 220, "min_lot_ha": 0.75, "price_uf": 4500, "incidencia": 0.14, "min_side_m": 60},
    "edificios6p": {"efficiency": 190, "min_units": 120, "max_units": 220, "min_lot_ha": 0.75, "price_uf": 2600, "incidencia": 0.14, "min_side_m": 60},
    "comercio":    {"efficiency": 0,   "min_units": 0,   "max_units": 0,   "min_lot_ha": 0.5,  "price_uf": 0,    "incidencia": 0, "land_value_uf_m2": 3.2, "min_side_m": 55},
    "equipamiento":{"efficiency": 0,   "min_units": 0,   "max_units": 0,   "min_lot_ha": 0.3,  "price_uf": 0,    "incidencia": 0, "land_value_uf_m2": 0,   "min_side_m": 55},
}


def load_geodata():
    """Load all GeoJSON layers (UTM coordinates)."""
    lotes = gpd.read_file(os.path.join(DATA_DIR, "lotes.geojson"), engine="fiona")
    av = gpd.read_file(os.path.join(DATA_DIR, "areas-verdes.geojson"), engine="fiona")
    vial = gpd.read_file(os.path.join(DATA_DIR, "vial-nuevo.geojson"), engine="fiona")
    return lotes, av, vial


def get_macrolotes(lotes_gdf, fids: list[str]) -> list[Polygon]:
    """Get one or more macrolotes. Returns a list of polygons.

    Adjacent macrolotes are merged into one; non-adjacent ones stay separate
    so each gets subdivided independently.
    """
    geoms = []
    for fid in fids:
        row = lotes_gdf[lotes_gdf["fid"] == fid]
        if row.empty:
            raise ValueError(f"Macrolote FID {fid} not found")
        geom = row.iloc[0].geometry
        if isinstance(geom, MultiPolygon):
            geoms.append(max(geom.geoms, key=lambda g: g.area))
        else:
            geoms.append(geom)

    if len(geoms) == 1:
        return geoms

    # Try to merge adjacent macrolotes
    merged = unary_union(geoms)
    if isinstance(merged, MultiPolygon):
        # Buffer slightly to merge near-adjacent, then unbuffer
        merged = unary_union([g.buffer(1) for g in geoms]).buffer(-1)

    if isinstance(merged, MultiPolygon):
        # Non-adjacent: return each polygon separately
        return list(merged.geoms)
    return [merged]


def get_intersecting_greens(macrolote: Polygon, av_gdf) -> list[Polygon]:
    """Get green areas that intersect the macrolote."""
    greens = []
    for _, row in av_gdf.iterrows():
        geom = row.geometry
        if isinstance(geom, MultiPolygon):
            for g in geom.geoms:
                if macrolote.intersects(g):
                    clipped = macrolote.intersection(g)
                    if not clipped.is_empty and clipped.area > 10:
                        greens.append(clipped if isinstance(clipped, Polygon) else max(clipped.geoms, key=lambda x: x.area))
        elif macrolote.intersects(geom):
            clipped = macrolote.intersection(geom)
            if not clipped.is_empty and clipped.area > 10:
                greens.append(clipped if isinstance(clipped, Polygon) else max(clipped.geoms, key=lambda x: x.area))
    return greens


def get_nearby_greens(macrolote: Polygon, av_gdf,
                      proximity_m: float = 25.0) -> list[Polygon]:
    """Get green areas NEAR the macrolote (within proximity_m meters).

    Unlike get_intersecting_greens (which clips to macrolote boundary),
    this returns the ORIGINAL green geometry for nearby green areas.
    Used for street orientation: streets should not point toward nearby
    green areas even if the green is technically outside the macrolote.

    Returns the raw green polygons (not clipped) so we can check if
    streets would visually terminate at them.
    """
    nearby = []
    macro_buffered = macrolote.buffer(proximity_m)
    for _, row in av_gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty or geom.area < 100:
            continue
        if isinstance(geom, MultiPolygon):
            for g in geom.geoms:
                if macro_buffered.intersects(g) and g.area > 100:
                    nearby.append(g)
        elif macro_buffered.intersects(geom):
            nearby.append(geom)
    return nearby


def _green_edge_angle(polygon: Polygon, green_union, tolerance: float = 5.0):
    """Find the dominant angle of polygon edges that border green areas.

    Returns the angle (degrees) of the longest edge segment that is adjacent
    to green areas, or None if no edges border green areas.  Streets should
    be oriented PARALLEL to this angle so they don't dead-end at parks.
    """
    if green_union is None or green_union.is_empty:
        return None

    green_buffered = green_union.buffer(tolerance)
    coords = list(polygon.exterior.coords)

    # Accumulate (angle, length) for edges touching green
    green_edges = []
    for i in range(len(coords) - 1):
        p1, p2 = coords[i], coords[i + 1]
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        edge_len = math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
        if edge_len < 5:
            continue
        mid_pt = Point(mid)
        if green_buffered.contains(mid_pt):
            angle = math.degrees(math.atan2(p2[1] - p1[1], p2[0] - p1[0]))
            green_edges.append((angle, edge_len))

    if not green_edges:
        return None

    # Return angle of the longest green-adjacent edge
    best = max(green_edges, key=lambda x: x[1])
    return best[0]


def _structural_edge_angle(polygon: Polygon, green_union, tolerance: float = 5.0):
    """Find the angle of the longest NON-green edge of the polygon.

    This represents the "structural" boundary — where streets from a parent
    level exist.  Streets should EXIT toward these edges to form proper
    T-intersections with the parent street network.
    """
    if green_union is None or green_union.is_empty:
        return None

    green_buffered = green_union.buffer(tolerance)
    coords = list(polygon.exterior.coords)

    structural_edges = []
    for i in range(len(coords) - 1):
        p1, p2 = coords[i], coords[i + 1]
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        edge_len = math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
        if edge_len < 10:
            continue
        mid_pt = Point(mid)
        if not green_buffered.contains(mid_pt):
            angle = math.degrees(math.atan2(p2[1] - p1[1], p2[0] - p1[0]))
            structural_edges.append((angle, edge_len))

    if not structural_edges:
        return None
    best = max(structural_edges, key=lambda x: x[1])
    return best[0]


def _street_endpoints_touch_green(street_clipped, polygon: Polygon,
                                  green_union, vial_union=None,
                                  tolerance: float = 8.0) -> bool:
    """Check if a street's endpoints dead-end at green areas.

    RULE: Internal streets must start AND end at either:
    - Vialidad estructurante (structural roads)
    - Other internal streets (T-intersections)
    They must NEVER terminate at green areas.

    Only checks against green areas INSIDE the polygon. Nearby greens
    (outside the polygon boundary) should not block street placement —
    the street exits toward structural roads, not toward the green.
    """
    if green_union is None or green_union.is_empty:
        return False

    try:
        # Only consider green areas significantly INSIDE the polygon.
        # A thin sliver of green touching the boundary (nearby green at
        # distance 0) should not block streets — it's not a real internal
        # green area. Use polygon without buffer and require >2000m2.
        internal_green = green_union.intersection(polygon)
        if internal_green.is_empty or internal_green.area < 500:
            return False

        poly_boundary = polygon.boundary
        street_boundary = street_clipped.boundary

        on_edge = street_boundary.intersection(poly_boundary.buffer(2.0))
        if on_edge.is_empty:
            return False

        green_buffered = internal_green.buffer(tolerance)
        green_contact = on_edge.intersection(green_buffered)
        if green_contact.is_empty:
            return False

        # If street also touches structural road at that zone, it's OK
        if vial_union is not None and not vial_union.is_empty:
            vial_buffered = vial_union.buffer(tolerance)
            vial_contact = green_contact.intersection(vial_buffered)
            if not vial_contact.is_empty:
                if vial_contact.length >= green_contact.length * 0.3:
                    return False

        return green_contact.length > 0.3

    except Exception:
        return False


def _street_endpoint_green_contact(street_clipped, polygon: Polygon,
                                   green_union, tolerance: float = 3.0) -> float:
    """Legacy wrapper — returns length of green contact at endpoints.

    Kept for backward compat with _score_street_candidate.
    """
    if green_union is None or green_union.is_empty:
        return 0.0
    try:
        # Only consider green areas significantly inside the polygon
        internal_green = green_union.intersection(polygon)
        if internal_green.is_empty or internal_green.area < 500:
            return 0.0
        poly_boundary = polygon.boundary
        street_boundary = street_clipped.boundary
        on_edge = street_boundary.intersection(poly_boundary.buffer(tolerance))
        if on_edge.is_empty:
            return 0.0
        green_buffered = internal_green.buffer(tolerance)
        green_contact = on_edge.intersection(green_buffered)
        if green_contact.is_empty:
            return 0.0
        return green_contact.length
    except Exception:
        return 0.0


def _score_street_candidate(parcels, street_clipped, polygon, green_union,
                            min_acceptable_side: float = 55.0,
                            vial_union=None) -> float:
    """Score a street placement.  Lower is better.

    Combines:
    - Area-ratio balance (prefer equal-sized parcels)
    - Green-contact penalty (avoid dead-ending at parks)
    - Narrow-strip penalty (avoid creating thin, unusable parcels)
    """
    areas = sorted([p.area for p in parcels], reverse=True)
    ratio = areas[-1] / areas[0] if areas[0] > 0 else 0
    balance_score = abs(ratio - 0.5)  # 0 = perfect balance

    # ── Shape quality penalty (narrow strips, triangles, bad aspect ratio) ──
    shape_penalty = 0.0
    for p in parcels:
        if p.area < 500:
            continue
        side = min_side_length(p)
        if side < min_acceptable_side * 0.7:
            shape_penalty += 2.0
        elif side < min_acceptable_side:
            shape_penalty += 0.5
        # Aspect ratio penalty: penalize strip lots (>1:3)
        ar = aspect_ratio(p)
        if ar > 4.0:
            shape_penalty += 3.0  # very bad strip
        elif ar > 3.0:
            shape_penalty += 1.5  # borderline strip
        elif ar > 2.5:
            shape_penalty += 0.3  # slightly elongated
        # Triangular lot penalty
        if is_triangular(p):
            shape_penalty += 3.0

    # ── Green contact penalty ──
    green_contact = _street_endpoint_green_contact(
        street_clipped, polygon, green_union
    )

    # ── Structural connectivity bonus ──
    # Streets whose endpoints touch structural roads (vial_union) get a strong
    # bonus. This ensures internal streets connect to the existing road network,
    # forming T-intersections rather than dead-ending at green areas.
    connectivity_bonus = 0.0
    if vial_union is not None and not vial_union.is_empty:
        try:
            vial_buffered = vial_union.buffer(8.0)
            from shapely.geometry import MultiPoint
            # Get street endpoints (where it meets the polygon boundary)
            street_boundary = street_clipped.boundary
            poly_boundary = polygon.boundary
            endpoints = street_boundary.intersection(poly_boundary.buffer(3.0))
            if not endpoints.is_empty:
                # Check how many endpoints touch structural roads
                vial_contact = endpoints.intersection(vial_buffered)
                if not vial_contact.is_empty:
                    ratio = vial_contact.length / max(endpoints.length, 0.01)
                    # Strong bonus for streets connecting to structural roads
                    connectivity_bonus = -1.5 * ratio  # up to -1.5 bonus
        except Exception:
            pass
    elif not green_union.is_empty:
        try:
            green_buffered = green_union.buffer(5.0)
            poly_boundary = polygon.boundary
            street_boundary = street_clipped.boundary
            on_edge = street_boundary.intersection(poly_boundary.buffer(2.0))
            if not on_edge.is_empty:
                total_contact = on_edge.length
                green_part = on_edge.intersection(green_buffered).length if not on_edge.intersection(green_buffered).is_empty else 0
                structural_contact = total_contact - green_part
                if structural_contact > 10:
                    connectivity_bonus = -0.3
        except Exception:
            pass

    # Acute angle penalty in scoring
    for p in parcels:
        if p.area > 500 and has_acute_angle(p, 35.0):
            shape_penalty += 3.0

    if green_contact > 1.0:
        # ANY green contact at endpoints → reject (streets must connect to
        # vialidad estructurante, never end at green areas)
        return 999.0
    return balance_score + shape_penalty + connectivity_bonus


def _split_polygon_no_street(polygon: Polygon, angle_deg: float,
                             position_ratio: float = 0.0) -> list[Polygon]:
    """Split a polygon with a thin cut line (no street corridor).

    Used for dividing blocks into lots — two lots can share a boundary
    without a street between them, as long as each lot has at least one
    side facing a street.
    """
    from shapely.geometry import LineString
    center = polygon.centroid
    bounds = polygon.bounds
    diagonal = math.sqrt((bounds[2] - bounds[0])**2 + (bounds[3] - bounds[1])**2)

    angle_rad = math.radians(angle_deg + 90)
    dx = math.cos(angle_rad) * diagonal
    dy = math.sin(angle_rad) * diagonal

    offset_rad = math.radians(angle_deg)
    offset_dist = position_ratio * diagonal * 0.5
    cx = center.x + math.cos(offset_rad) * offset_dist
    cy = center.y + math.sin(offset_rad) * offset_dist

    line = LineString([(cx - dx, cy - dy), (cx + dx, cy + dy)])
    # Use a very thin buffer (0.5m) — just enough for Shapely to split
    splitter = line.buffer(0.5, cap_style="flat")
    remainder = polygon.difference(splitter)

    if remainder.is_empty:
        return [polygon]
    if isinstance(remainder, Polygon):
        return [remainder] if remainder.area > 100 else [polygon]
    parts = [g for g in remainder.geoms if isinstance(g, Polygon) and g.area > 100]
    return parts if len(parts) >= 2 else [polygon]


def recursive_subdivide(polygon: Polygon, target_area_m2: float, angle_deg: float,
                        green_areas: list, street_width: float = 12.0,
                        depth: int = 0, max_depth: int = 8,
                        street_depth_limit: int = 2,
                        min_parcel_area: float = 5000,
                        vial_union: Polygon = None,
                        parent_streets: list = None) -> tuple[list[Polygon], list[Polygon]]:
    """Recursively subdivide a polygon into lots.

    Two-phase approach:
    - Phase A (depth < street_depth_limit): Place REAL streets (12m wide
      corridors) to create urban blocks.  Only 2-3 streets for the main
      road network.
    - Phase B (depth >= street_depth_limit): Split blocks into lots using
      property boundary lines (no street).  Two lots can share a boundary
      without a street, as long as each lot faces at least one street.

    This minimizes streets while maintaining urbanismo: every lot has
    street frontage from the Phase A streets.
    """
    # Ensure polygon is a valid Polygon (not GeometryCollection/Multi)
    if not isinstance(polygon, Polygon) or polygon.is_empty:
        if hasattr(polygon, 'geoms'):
            polys = [g for g in polygon.geoms if isinstance(g, Polygon) and g.area > 100]
            if polys:
                polygon = max(polys, key=lambda g: g.area)
            else:
                return [], []
        else:
            return [], []

    area = polygon.area
    lots = []
    streets_out = []

    # Stop when polygon is small enough for a single lot.
    if depth >= max_depth:
        return [polygon], []
    if area <= target_area_m2 * 1.5:
        # Exception: strip lots (AR > 3.5) should keep splitting along
        # their short axis — stopping here would create unusable lots.
        try:
            ar = aspect_ratio(polygon)
        except Exception:
            ar = 1.0
        if ar <= 3.5 or area < min_parcel_area * 2:
            return [polygon], []
        # Strip lot: fall through to Phase B to split it into squarer pieces

    green_union = unary_union(green_areas) if green_areas else Polygon()

    # ── Phase A: Real streets (depths 0 to street_depth_limit-1) ──
    if depth < street_depth_limit:
        # Candidate angles: grid-aligned + polygon's own MRR + edges.
        # Deeper levels MUST be perpendicular to parent to form L/T patterns.
        if depth == 0:
            primary = angle_deg
        else:
            # Force perpendicular to parent angle → creates L/T intersections
            primary = angle_deg + 90

        candidates_angles = [primary, primary + 90]

        # Add polygon's own optimal angle and its perpendicular
        poly_angle = minimum_rotated_rectangle_angle(polygon)
        for ca in [poly_angle, poly_angle + 90]:
            is_new = all(
                abs(((ca - existing + 180) % 360) - 180) > 15
                for existing in candidates_angles
            )
            if is_new:
                candidates_angles.append(ca)

        # For irregular polygons, also try the angle of the longest edge
        # (the polygon may not align with MRR at all)
        coords = list(polygon.exterior.coords)
        longest_edge_angle = None
        longest_edge_len = 0
        for ci in range(len(coords) - 1):
            ex = coords[ci + 1][0] - coords[ci][0]
            ey = coords[ci + 1][1] - coords[ci][1]
            elen = math.sqrt(ex * ex + ey * ey)
            if elen > longest_edge_len:
                longest_edge_len = elen
                longest_edge_angle = math.degrees(math.atan2(ey, ex))
        if longest_edge_angle is not None:
            for ca in [longest_edge_angle, longest_edge_angle + 90]:
                is_new = all(
                    abs(((ca - existing + 180) % 360) - 180) > 15
                    for existing in candidates_angles
                )
                if is_new:
                    candidates_angles.append(ca)

        offsets = [0.0, 0.1, -0.1, 0.15, -0.15, 0.25, -0.25, 0.35, -0.35]
        best_parcels = None
        best_street = None
        best_score = float('inf')

        for cut_angle in candidates_angles:
            for offset in offsets:
                street = create_street_line(
                    polygon, offset, cut_angle, street_width, depth=depth
                )
                if street.is_empty or not polygon.intersects(street):
                    continue

                # Skip streets that go THROUGH green areas
                if not green_union.is_empty:
                    green_interior = green_union.buffer(-2.0)
                    if not green_interior.is_empty and street.intersection(green_interior).area > 10:
                        continue

                street_clipped = street.intersection(polygon)
                if street_clipped.is_empty:
                    continue

                parcels = split_polygon_with_street(polygon, street_clipped)
                if len(parcels) < 2:
                    continue

                # HARD reject: triangular parcels are PROHIBITED
                if any(is_triangular(p) for p in parcels if p.area > 500):
                    continue

                # HARD reject: strip lots (AR > 4.0) — street too close to edge
                if any(aspect_ratio(p) > 4.0 for p in parcels if p.area > 500):
                    continue

                # HARD reject: streets ending at green areas are PROHIBITED
                # Streets must start and end at vialidad estructurante or
                # other internal streets — NEVER at green areas.
                if not green_union.is_empty:
                    if _street_endpoints_touch_green(
                        street_clipped, polygon, green_union,
                        vial_union=vial_union, tolerance=8.0
                    ):
                        continue

                # HARD reject: parcels with acute angles (< 35°)
                if any(has_acute_angle(p, 35.0) for p in parcels if p.area > 500):
                    continue

                # HARD reject: street must connect to existing road network.
                # At depth >= 1, the new street must touch at least one
                # previously placed street OR vialidad estructurante.
                # Without this check, streets can end up parallel and
                # disconnected — the #1 visual defect in the subdivision.
                if depth >= 1:
                    network_parts = []
                    if vial_union is not None and not vial_union.is_empty:
                        network_parts.append(vial_union)
                    if parent_streets:
                        network_parts.extend(parent_streets)
                    if network_parts:
                        network_union = unary_union(network_parts).buffer(5.0)
                        street_bounds = street_clipped.boundary
                        poly_bounds = polygon.boundary
                        exit_zones = street_bounds.intersection(
                            poly_bounds.buffer(3.0)
                        )
                        if not exit_zones.is_empty:
                            network_touch = exit_zones.intersection(network_union)
                            # At least ONE exit must touch the network
                            if network_touch.is_empty or network_touch.length < 1.0:
                                continue  # disconnected street → reject

                score = _score_street_candidate(
                    parcels, street_clipped, polygon, green_union,
                    vial_union=vial_union
                )

                if score < best_score:
                    best_score = score
                    best_parcels = parcels
                    best_street = street_clipped

        if best_parcels is not None:
            streets_out.append(best_street)

            # Accumulate streets for connectivity checking at deeper levels
            accumulated_streets = list(parent_streets or []) + [best_street]

            for parcel in best_parcels:
                sub_lots, sub_streets = recursive_subdivide(
                    parcel, target_area_m2, angle_deg, green_areas,
                    street_width, depth + 1, max_depth,
                    street_depth_limit=street_depth_limit,
                    min_parcel_area=min_parcel_area,
                    vial_union=vial_union,
                    parent_streets=accumulated_streets,
                )
                lots.extend(sub_lots)
                streets_out.extend(sub_streets)

            return lots, streets_out

        # Phase A failed (all street candidates rejected).
        # FALLBACK: continue to Phase B (property-line split) below
        # instead of returning the whole polygon unsplit (ghost lot).

    # ── Phase B: Property-line splits (no street) ──
    # Try both the grid-aligned angle and the polygon's own optimal angle.
    # For elongated polygons, the optimal split is along the SHORT axis
    # (perpendicular to the long axis), which produces squarer children.
    poly_angle = minimum_rotated_rectangle_angle(polygon)
    grid_angle = angle_deg if (depth % 2 == 0) else (angle_deg + 90)
    candidate_angles = [grid_angle, grid_angle + 90, poly_angle, poly_angle + 90]
    # Deduplicate angles within 10°
    unique_angles = []
    for ca in candidate_angles:
        if all(abs(((ca - ua + 180) % 360) - 180) > 10 for ua in unique_angles):
            unique_angles.append(ca)

    best_parts = None
    best_score = float('inf')

    for cut_angle in unique_angles:
        for offset in [0.0, 0.15, -0.15, 0.3, -0.3]:
            parts = _split_polygon_no_street(polygon, cut_angle, offset)
            if len(parts) < 2:
                continue
            # Reject splits that create parcels too small for any product
            if any(p.area < min_parcel_area for p in parts):
                continue
            # HARD reject: triangular lots, acute angles, and low fill ratio
            if any(is_triangular(p) for p in parts if p.area > 500):
                continue
            if any(has_acute_angle(p, 35.0) for p in parts if p.area > 500):
                continue
            # HARD reject: strip lots (AR > 3.5) — very elongated
            if any(aspect_ratio(p) > 3.5 for p in parts if p.area > 500):
                continue
            areas = sorted([p.area for p in parts], reverse=True)
            ratio = areas[-1] / areas[0] if areas[0] > 0 else 0
            score = abs(ratio - 0.5)

            # Penalize bad lot shapes: narrow strips, bad aspect ratio
            for p in parts:
                side = min_side_length(p)
                if side < 50:
                    score += 2.0
                elif side < 70:
                    score += 0.5
                ar = aspect_ratio(p)
                if ar > 4.0:
                    score += 3.0
                elif ar > 3.0:
                    score += 1.5

            if score < best_score:
                best_score = score
                best_parts = parts

    # If strict Phase B failed, try RELAXED constraints (no triangle/angle checks).
    # Better to split into imperfect lots than leave a huge ghost area.
    if best_parts is None and area > target_area_m2 * 3:
        for cut_angle in unique_angles:
            for offset in [0.0, 0.2, -0.2, 0.4, -0.4]:
                parts = _split_polygon_no_street(polygon, cut_angle, offset)
                if len(parts) < 2:
                    continue
                # Only reject truly degenerate splits
                if any(p.area < 500 for p in parts):
                    continue
                areas = sorted([p.area for p in parts], reverse=True)
                ratio = areas[-1] / areas[0] if areas[0] > 0 else 0
                score = abs(ratio - 0.5)
                if score < best_score:
                    best_score = score
                    best_parts = parts

    if best_parts is None:
        return [polygon], []

    for part in best_parts:
        sub_lots, sub_streets = recursive_subdivide(
            part, target_area_m2, angle_deg, green_areas,
            street_width, depth + 1, max_depth,
            street_depth_limit=street_depth_limit,
            min_parcel_area=min_parcel_area,
            vial_union=vial_union,
            parent_streets=parent_streets,
        )
        lots.extend(sub_lots)
        # Phase B never adds streets

    return lots, streets_out


def _subdivide_block_into_lots(block: Polygon, product_id: str) -> list[dict]:
    """Subdivide a superblock into individual lots for a given product.

    Uses shapely.ops.split with clean cut lines (no buffer gaps).
    Enforces min_lot_area, min_side_m, and min_units with ±10% flex.
    Returns list of lot dicts with polygon, product_id, area_m2, units.
    """
    from shapely.ops import split as shapely_split

    product = PRODUCTS.get(product_id, {})
    # ±10% flexibility on all parameters
    max_area = _max_lot_area(product_id) * 1.10
    min_area = _min_lot_area(product_id) * 0.90
    min_side = product.get("min_side_m", 50) * 0.90
    efficiency = product.get("efficiency", 0)
    max_units = product.get("max_units", 9999)
    min_units = product.get("min_units", 0)

    def _make_lot(poly):
        """Create a lot dict, maximizing units."""
        units = round((poly.area / 10000) * efficiency) if efficiency > 0 else 0
        units = min(units, max_units)
        return {
            "polygon": poly,
            "product_id": product_id,
            "area_m2": poly.area,
            "units": units,
            "_group_idx": 0,
        }

    def _is_valid_lot(poly):
        """Check if a polygon meets minimum lot requirements."""
        if poly.area < min_area:
            return False
        # Check minimum side length
        mrr = poly.minimum_rotated_rectangle
        mrr_c = list(mrr.exterior.coords)
        s1 = math.sqrt((mrr_c[1][0]-mrr_c[0][0])**2 + (mrr_c[1][1]-mrr_c[0][1])**2)
        s2 = math.sqrt((mrr_c[2][0]-mrr_c[1][0])**2 + (mrr_c[2][1]-mrr_c[1][1])**2)
        if min(s1, s2) < min_side:
            return False
        # Check not a sliver (aspect ratio < 6:1)
        if max(s1, s2) / min(s1, s2) > 6:
            return False
        return True

    # If the block fits in one lot, return as-is
    if block.area <= max_area:
        return [_make_lot(block)]

    # How many lots?
    n_lots = max(2, math.ceil(block.area / max_area))
    # Ensure each lot is at least min_area
    while n_lots > 1 and block.area / n_lots < min_area:
        n_lots -= 1

    if n_lots <= 1:
        return [_make_lot(block)]

    # Determine cut direction from minimum rotated rectangle
    mrr = block.minimum_rotated_rectangle
    mrr_coords = list(mrr.exterior.coords)
    edge1 = (mrr_coords[1][0] - mrr_coords[0][0], mrr_coords[1][1] - mrr_coords[0][1])
    edge2 = (mrr_coords[2][0] - mrr_coords[1][0], mrr_coords[2][1] - mrr_coords[1][1])
    len1 = math.sqrt(edge1[0]**2 + edge1[1]**2)
    len2 = math.sqrt(edge2[0]**2 + edge2[1]**2)

    # Cut perpendicular to the LONG axis
    if len1 >= len2:
        long_vec = (edge1[0] / len1, edge1[1] / len1)
        origin = (mrr_coords[0][0], mrr_coords[0][1])
        long_len = len1
    else:
        long_vec = (edge2[0] / len2, edge2[1] / len2)
        origin = (mrr_coords[1][0], mrr_coords[1][1])
        long_len = len2

    perp = (-long_vec[1], long_vec[0])
    cut_ext = max(long_len, 500) * 2

    # Strategy: make ALL cuts at once on the original block, then collect pieces.
    # This avoids the iterative problem where remaining polygon changes shape.

    # Find the extent of block along the long axis
    block_coords = list(block.exterior.coords)
    projections = [(c[0] - origin[0]) * long_vec[0] + (c[1] - origin[1]) * long_vec[1]
                   for c in block_coords]
    proj_min = min(projections)
    proj_max = max(projections)

    # Build all cut lines at equal intervals
    cut_lines = []
    for i in range(1, n_lots):
        t = i / n_lots
        cut_proj = proj_min + (proj_max - proj_min) * t
        cx = origin[0] + long_vec[0] * cut_proj
        cy = origin[1] + long_vec[1] * cut_proj
        cut_lines.append(LineString([
            (cx - perp[0] * cut_ext, cy - perp[1] * cut_ext),
            (cx + perp[0] * cut_ext, cy + perp[1] * cut_ext),
        ]))

    # Apply all cuts to the block
    from shapely.ops import snap
    lots = []
    remaining = block
    for cut_line in cut_lines:
        pieces = []
        try:
            result = shapely_split(remaining, cut_line)
            pieces = [g for g in result.geoms if isinstance(g, Polygon) and g.area > 200]
        except Exception:
            pass
        if len(pieces) < 2:
            try:
                snapped = snap(cut_line, remaining, tolerance=1.0)
                result = shapely_split(remaining, snapped)
                pieces = [g for g in result.geoms if isinstance(g, Polygon) and g.area > 200]
            except Exception:
                pass
        if len(pieces) < 2:
            try:
                diff = remaining.difference(cut_line.buffer(0.05))
                if hasattr(diff, 'geoms'):
                    pieces = [g for g in diff.geoms if isinstance(g, Polygon) and g.area > 200]
            except Exception:
                pass
        if len(pieces) >= 2:
            # Keep only the piece furthest from start as remaining
            pieces.sort(key=lambda p: (p.centroid.x - origin[0]) * long_vec[0]
                                     + (p.centroid.y - origin[1]) * long_vec[1])
            # All pieces except last go to lots_pieces, last becomes remaining
            for p in pieces[:-1]:
                lots.append(_make_lot(p))
            remaining = pieces[-1]

    # Add remaining as last lot
    if isinstance(remaining, Polygon) and remaining.area > 500:
        lots.append(_make_lot(remaining))

    # Post-process: only merge truly degenerate lots (tiny slivers < 30% of min_area)
    if len(lots) > 1:
        valid = []
        to_merge = []
        for lot in lots:
            poly = lot["polygon"]
            # Only merge if VERY small (sliver) — not just under min_area
            if poly.area < min_area * 0.3:
                to_merge.append(lot)
            else:
                valid.append(lot)

        for bad in to_merge:
            if not valid:
                valid.append(bad)
                continue
            best_idx = 0
            best_dist = float('inf')
            for vi, v in enumerate(valid):
                d = bad["polygon"].distance(v["polygon"])
                if d < best_dist:
                    best_dist = d
                    best_idx = vi
            merged_poly = unary_union([valid[best_idx]["polygon"], bad["polygon"]])
            if isinstance(merged_poly, MultiPolygon):
                merged_poly = max(merged_poly.geoms, key=lambda g: g.area)
            if isinstance(merged_poly, Polygon):
                valid[best_idx] = _make_lot(merged_poly)

        lots = valid

    # Fallback: return original block if subdivision failed
    if not lots:
        return [_make_lot(block)]

    return lots


def _max_lot_area(product_id: str) -> float:
    """Calculate max lot area for a product based on max_units / efficiency + 10%.

    For non-residential products (efficiency=0), returns a large default.
    """
    prod = PRODUCTS[product_id]
    if prod["efficiency"] <= 0 or prod["max_units"] <= 0:
        return 100000.0  # 10 ha default for equipamiento/comercio
    # max_units / efficiency gives hectares, * 10000 for m², * 1.1 for 10% margin
    return (prod["max_units"] / prod["efficiency"]) * 10000 * 1.1


def _min_lot_area(product_id: str) -> float:
    """Calculate min lot area for a product based on min_lot_ha."""
    prod = PRODUCTS[product_id]
    return prod["min_lot_ha"] * 10000


def _validate_street(street_clipped, remaining, green_union, vial_union,
                     street_width: float) -> bool:
    """Validate a street placement: green checks, parallel checks."""
    if not green_union.is_empty:
        green_interior = green_union.buffer(-2.0)
        if not green_interior.is_empty and street_clipped.intersection(green_interior).area > 10:
            return False
        if _street_endpoints_touch_green(street_clipped, remaining, green_union,
                                         vial_union=vial_union, tolerance=8.0):
            return False
    if vial_union is not None and not vial_union.is_empty:
        vial_buffered = vial_union.buffer(street_width * 1.5)
        overlap = street_clipped.intersection(vial_buffered)
        if not overlap.is_empty and overlap.area > street_clipped.area * 0.6:
            return False
    return True


def _try_cut(polygon, offset, angle, width, green_union, vial_union,
             street_width, use_street=True):
    """Try a single cut and return (parts, street_clipped) or None."""
    w = street_width if use_street else 0.5
    street = create_street_line(polygon, offset, angle, w, depth=0)
    if street.is_empty:
        return None
    street_clipped = street.intersection(polygon)
    if street_clipped.is_empty or street_clipped.area < 5:
        return None
    parts = split_polygon_with_street(polygon, street_clipped)
    if len(parts) < 2:
        return None
    # Relaxed shape validation — only reject truly degenerate shapes
    for p in parts:
        if p.area < 300:
            continue
        if aspect_ratio(p) > 6.0:
            return None
        if has_acute_angle(p, 15.0):
            return None
    # Street validation (green, parallel checks)
    if use_street and not _validate_street(street_clipped, polygon, green_union,
                                            vial_union, street_width):
        return None
    return parts, street_clipped if use_street else None


def _best_bisect(polygon, target_ratio, poly_angle, green_union, vial_union,
                 street_width, use_street=True):
    """Find the best bisection of a polygon at target_ratio.

    Returns (piece_a, piece_b, street_poly) or None.
    piece_a is closest to target_ratio * polygon.area.
    """
    offset = (target_ratio - 0.5) * 1.2
    try:
        rem_angle = minimum_rotated_rectangle_angle(polygon)
    except Exception:
        rem_angle = poly_angle

    angles = [poly_angle, poly_angle + 90, rem_angle, rem_angle + 90]
    offsets = [offset, offset * 0.8, offset * 1.2, 0.0, offset * 0.5,
               offset * 0.6, -offset * 0.3, offset * 1.5]

    target_area = polygon.area * target_ratio
    best = None
    best_score = float("inf")

    for use_st in ([True, False] if use_street else [False]):
        for ca in angles:
            for off in offsets:
                off = max(-0.45, min(0.45, off))
                result = _try_cut(polygon, off, ca, street_width, green_union,
                                  vial_union, street_width, use_street=use_st)
                if result is None:
                    continue
                parts, st = result
                # Pick piece closest to target_area
                parts.sort(key=lambda p: abs(p.area - target_area))
                piece_a = parts[0]
                rest = [p for p in parts if p is not piece_a]
                piece_b = max(rest, key=lambda p: p.area) if rest else Polygon()
                score = abs(piece_a.area - target_area) / target_area if target_area > 0 else 999
                if score < best_score:
                    best_score = score
                    best = (piece_a, piece_b, st)
        if best is not None and use_st:
            break  # prefer streets over property lines

    return best


def plan_first_subdivide(buildable: Polygon, allocations: list[dict],
                         angle_deg: float, green_union,
                         vial_union, street_width: float = 12.0) -> tuple[list[dict], list[Polygon]]:
    """Grid-based subdivision: place an orthogonal street grid, then assign parcels.

    Based on Chilean loteo patterns (user PDF with 8 options):
    - Determine grid dimensions (rows × cols) from total lot count
    - Place streets as orthogonal grid connecting structural roads
    - Assign resulting parcels to products by target area

    Multiple lots of the same product are normal when product's
    area allocation exceeds its max_lot_area.
    """
    total_area = buildable.area
    poly_angle = minimum_rotated_rectangle_angle(buildable)

    # ── Phase 1: Calculate lot count per product ──
    # Skip products whose target area < min_lot_area and redistribute.
    viable_allocs = []
    skipped_pct = 0.0
    for alloc in allocations:
        pid = alloc["product_id"]
        pct = alloc["percentage"]
        product_target = total_area * pct / 100.0
        min_area = _min_lot_area(pid)
        if product_target < min_area * 0.8:
            skipped_pct += pct
        else:
            viable_allocs.append(alloc)

    # Redistribute skipped percentage proportionally
    if skipped_pct > 0 and viable_allocs:
        viable_total_pct = sum(a["percentage"] for a in viable_allocs)
        if viable_total_pct > 0:
            scale = (viable_total_pct + skipped_pct) / viable_total_pct
            viable_allocs = [
                {"product_id": a["product_id"], "percentage": a["percentage"] * scale}
                for a in viable_allocs
            ]

    product_lots = []  # list of (product_id, target_area_per_lot, n_lots)
    total_lots_needed = 0
    for alloc in viable_allocs:
        pid = alloc["product_id"]
        pct = alloc["percentage"]
        product_target = total_area * pct / 100.0
        max_area = _max_lot_area(pid)
        min_area = _min_lot_area(pid)

        if product_target <= 0:
            continue

        if product_target <= max_area:
            n_lots = 1
        else:
            n_lots = math.ceil(product_target / max_area)

        lot_area = product_target / n_lots
        if lot_area < min_area and n_lots > 1:
            n_lots = max(1, int(product_target / min_area))
            lot_area = product_target / n_lots

        product_lots.append((pid, lot_area, n_lots))
        total_lots_needed += n_lots

    if total_lots_needed == 0:
        return [], []

    # ── Phase 2: Determine grid dimensions ──
    # Grid should approximate the polygon's aspect ratio.
    # Use MRR to determine which axis is longer.
    mrr = buildable.minimum_rotated_rectangle
    mrr_coords = list(mrr.exterior.coords)
    edge1_len = math.sqrt((mrr_coords[1][0]-mrr_coords[0][0])**2 + (mrr_coords[1][1]-mrr_coords[0][1])**2)
    edge2_len = math.sqrt((mrr_coords[2][0]-mrr_coords[1][0])**2 + (mrr_coords[2][1]-mrr_coords[1][1])**2)
    long_edge = max(edge1_len, edge2_len)
    short_edge = min(edge1_len, edge2_len)
    ar = long_edge / short_edge if short_edge > 0 else 2.0

    # Grid: cols along long axis, rows along short axis
    # cols/rows ≈ aspect ratio of polygon
    n = total_lots_needed
    if n <= 1:
        cols, rows = 1, 1
    elif n <= 3:
        cols, rows = n, 1
    else:
        # Optimize: rows * cols >= n, minimize difference from AR
        best = (n, 1)
        best_cost = float("inf")
        for r in range(1, n + 1):
            c = math.ceil(n / r)
            if r * c < n:
                c += 1
            grid_ar = c / r if r > 0 else 999
            cost = abs(grid_ar - ar) + abs(r * c - n) * 0.5
            if cost < best_cost:
                best_cost = cost
                best = (c, r)
        cols, rows = best


    # ── Phase 3: Place grid streets ──
    # Cut the polygon into a grid using orthogonal streets.
    # First cut into columns (along long axis), then each column into rows.
    streets = []

    # Determine which angle aligns with long edge
    edge1_vec = (mrr_coords[1][0]-mrr_coords[0][0], mrr_coords[1][1]-mrr_coords[0][1])
    edge2_vec = (mrr_coords[2][0]-mrr_coords[1][0], mrr_coords[2][1]-mrr_coords[1][1])
    if edge1_len >= edge2_len:
        long_angle = math.degrees(math.atan2(edge1_vec[1], edge1_vec[0]))
    else:
        long_angle = math.degrees(math.atan2(edge2_vec[1], edge2_vec[0]))

    # Cut into columns (perpendicular to long axis)
    columns = [buildable]
    if cols > 1:
        remaining = buildable
        new_columns = []
        for ci in range(cols - 1):
            if remaining.is_empty or remaining.area < 500:
                break
            # Each column gets 1/remaining_cols of the remaining area
            remaining_cols = cols - ci
            col_ratio = 1.0 / remaining_cols
            result = _best_bisect(remaining, col_ratio, long_angle, green_union,
                                  vial_union, street_width, use_street=True)
            if result is None:
                result = _best_bisect(remaining, col_ratio, long_angle, green_union,
                                      vial_union, street_width, use_street=False)
            if result is None:
                break
            piece, rest, street = result
            if isinstance(piece, MultiPolygon):
                piece = max(piece.geoms, key=lambda g: g.area)
            if isinstance(rest, MultiPolygon):
                rest = max(rest.geoms, key=lambda g: g.area)
            new_columns.append(piece)
            if street is not None:
                streets.append(street)
            remaining = rest if isinstance(rest, Polygon) and not rest.is_empty else Polygon()
        # Add last column
        if not remaining.is_empty and remaining.area > 500:
            new_columns.append(remaining if isinstance(remaining, Polygon) else
                               max(remaining.geoms, key=lambda g: g.area))
        columns = new_columns if new_columns else [buildable]

    # Cut each column into rows (perpendicular to short axis = along long axis + 90)
    parcels = []
    for col_poly in columns:
        if rows <= 1 or col_poly.is_empty:
            parcels.append(col_poly)
            continue

        remaining = col_poly
        for ri in range(rows - 1):
            if remaining.is_empty or remaining.area < 500:
                break
            remaining_rows = rows - ri
            row_ratio = 1.0 / remaining_rows
            result = _best_bisect(remaining, row_ratio, long_angle + 90, green_union,
                                  vial_union, street_width, use_street=True)
            if result is None:
                result = _best_bisect(remaining, row_ratio, long_angle + 90, green_union,
                                      vial_union, street_width, use_street=False)
            if result is None:
                break
            piece, rest, street = result
            if isinstance(piece, MultiPolygon):
                piece = max(piece.geoms, key=lambda g: g.area)
            if isinstance(rest, MultiPolygon):
                rest = max(rest.geoms, key=lambda g: g.area)
            parcels.append(piece)
            if street is not None:
                streets.append(street)
            remaining = rest if isinstance(rest, Polygon) and not rest.is_empty else Polygon()
        if not remaining.is_empty and remaining.area > 500:
            parcels.append(remaining if isinstance(remaining, Polygon) else
                           max(remaining.geoms, key=lambda g: g.area))

    # Filter out tiny slivers
    parcels = [p for p in parcels if isinstance(p, Polygon) and p.area > 500]

    if not parcels:
        # Fallback: return buildable as single lot for largest product
        pid = max(allocations, key=lambda a: a["percentage"])["product_id"]
        return [{"polygon": buildable, "product_id": pid, "area_m2": buildable.area}], streets

    # ── Phase 4: Assign parcels to products ──
    # Sort parcels by area descending.
    # Build assignment queue: for each product, how many lots and what target area.
    parcels.sort(key=lambda p: p.area, reverse=True)

    # Build lot demand list sorted by target_area descending
    lot_demand = []
    for pid, lot_area, n_lots in product_lots:
        for i in range(n_lots):
            lot_demand.append({"product_id": pid, "target_area": lot_area})
    lot_demand.sort(key=lambda d: d["target_area"], reverse=True)

    # Greedy assignment: match largest parcels to largest demands
    assigned_lots = []
    used_parcels = set()
    for demand in lot_demand:
        best_pi = None
        best_diff = float("inf")
        for pi, parcel in enumerate(parcels):
            if pi in used_parcels:
                continue
            diff = abs(parcel.area - demand["target_area"])
            if diff < best_diff:
                best_diff = diff
                best_pi = pi
        if best_pi is not None:
            used_parcels.add(best_pi)
            assigned_lots.append({
                "polygon": parcels[best_pi],
                "product_id": demand["product_id"],
                "area_m2": parcels[best_pi].area,
            })

    # Assign any remaining unassigned parcels to the most under-allocated product
    for pi, parcel in enumerate(parcels):
        if pi in used_parcels:
            continue
        if parcel.area < 500:
            continue
        best_pid = None
        best_deficit = -float("inf")
        for alloc in allocations:
            pid = alloc["product_id"]
            target = total_area * alloc["percentage"] / 100.0
            actual = sum(a["area_m2"] for a in assigned_lots if a["product_id"] == pid)
            deficit = target - actual
            if deficit > best_deficit:
                best_deficit = deficit
                best_pid = pid
        if best_pid:
            assigned_lots.append({
                "polygon": parcel,
                "product_id": best_pid,
                "area_m2": parcel.area,
            })

    # ── Phase 5: Calculate units ──
    for lot in assigned_lots:
        prod = PRODUCTS[lot["product_id"]]
        if prod["efficiency"] > 0:
            units = int((lot["area_m2"] / 10000) * prod["efficiency"])
            if prod["max_units"] > 0 and units > prod["max_units"]:
                units = prod["max_units"]
            lot["units"] = units
        else:
            lot["units"] = 0
        lot["min_side_m"] = min_side_length(lot["polygon"])

    return assigned_lots, streets


def _lot_fits_product(lot: Polygon, product_id: str, lot_min_side: float = None) -> bool:
    """Check if a lot meets a product's constraints.

    Checks: units range, min side, aspect ratio (max 1:3), no triangular lots.
    """
    prod = PRODUCTS[product_id]
    side = lot_min_side if lot_min_side is not None else min_side_length(lot)

    # Universal shape constraints: no strip lots (>1:4) and no triangles
    ar = aspect_ratio(lot)
    if ar > 3.5:  # 1:3.5 tolerance — merged lots through street corridors are elongated
        return False
    if is_triangular(lot):
        return False

    if prod["efficiency"] == 0:
        # Comercio/equipamiento: conditional min side
        required_side = prod["min_side_m"]  # 55m
        if lot.area < 3000:
            required_side = 30  # relaxed for small lots
        return side >= required_side * 0.7

    # Residential: check units + min side
    area_ha = lot.area / 10000
    units = int(area_ha * prod["efficiency"])
    if units < prod["min_units"]:
        return False
    if units > prod["max_units"] * 1.3:
        return False
    # Relaxed side check
    if prod["efficiency"] >= 100:
        if side < prod["min_side_m"] * 0.5:
            return False
    else:
        if side < prod["min_side_m"] * 0.7:
            return False
    return True


def _merge_lots_with_neighbor(lots: list[Polygon], bad_idx: int) -> list[Polygon]:
    """Merge lot at bad_idx with its nearest neighbor. Returns new list."""
    if len(lots) <= 1:
        return lots

    small = lots[bad_idx]
    best_neighbor = -1
    best_dist = float("inf")
    for ni, neighbor in enumerate(lots):
        if ni == bad_idx:
            continue
        d = small.distance(neighbor)
        if d < best_dist and d <= 15.0:  # within street width
            best_dist = d
            best_neighbor = ni

    if best_neighbor < 0:
        return lots  # no nearby neighbor

    # Bridge street gap
    gap = best_dist
    if gap < 1:
        combined = unary_union([small, lots[best_neighbor]])
    else:
        buf = gap / 2 + 1.0
        combined = unary_union([small.buffer(buf), lots[best_neighbor].buffer(buf)]).buffer(-buf)

    if isinstance(combined, MultiPolygon):
        combined = max(combined.geoms, key=lambda g: g.area)

    result = []
    for i, l in enumerate(lots):
        if i == bad_idx:
            continue
        if i == best_neighbor:
            result.append(combined)
        else:
            result.append(l)
    return result


def _merge_small_lots(lots: list[Polygon], product_ids: list[str]) -> list[Polygon]:
    """Merge lots that don't fit ANY of the requested products.

    A lot is "bad" if _lot_fits_product returns False for every product in product_ids.
    Keeps merging until all lots fit at least one product, or no more merges possible.
    """
    if len(lots) <= 1:
        return lots

    merged = list(lots)
    max_iters = len(lots) * 4  # safety limit

    for _ in range(max_iters):
        if len(merged) <= 1:
            break

        # Find first lot that doesn't fit any product
        bad_idx = None
        for i, l in enumerate(merged):
            fits_any = any(_lot_fits_product(l, pid) for pid in product_ids)
            if not fits_any:
                bad_idx = i
                break

        if bad_idx is None:
            break  # all lots fit at least one product

        merged = _merge_lots_with_neighbor(merged, bad_idx)

    return merged


def _find_best_neighbor(lots, idx, assigned, exclude_merged=True, filter_fn=None,
                        max_distance: float = 15.0):
    """Find best neighbor for lot at idx.

    Lots are separated by street corridors (~12m), so they never share boundaries.
    Uses distance-based proximity: closer lots are better merge candidates.
    max_distance limits how far apart lots can be to be considered neighbors.
    """
    lot = lots[idx]
    best_ni = -1
    best_dist = float("inf")
    for ni in range(len(lots)):
        if ni == idx:
            continue
        if exclude_merged and (assigned[ni] == "__MERGED__" or lots[ni].is_empty):
            continue
        if filter_fn and not filter_fn(ni):
            continue
        d = lot.distance(lots[ni])
        if d < best_dist and d <= max_distance:
            best_dist = d
            best_ni = ni
    return best_ni


def _do_merge(lots, lot_sides, assigned, src_idx, dst_idx,
              exclusion_zone=None, check_shape=True):
    """Merge lot src_idx into dst_idx. Updates lists in place.

    Returns True if merge succeeded, False if rejected due to shape violation.

    Lots may be separated by street corridors (~12m). The merge absorbs the
    street between them. We clip against exclusion_zone but EXCLUDE the corridor
    between the two lots (since that street is absorbed by the merge).

    check_shape: if True, rejects merges that would create strip lots (AR > 3.5)
    or triangular lots. Set to False for force-merges (ghost elimination).
    """
    gap = lots[src_idx].distance(lots[dst_idx])
    expected_area = lots[src_idx].area + lots[dst_idx].area

    # Strategy: try progressively stronger bridging to merge two lots.
    # Lots may be separated by 0-12m gaps (streets). We need a single
    # connected Polygon, not a MultiPolygon (which loses pieces downstream).
    combined = None

    # 1) Direct union — works when lots overlap or share boundaries
    if gap < 0.1:
        trial = unary_union([lots[src_idx], lots[dst_idx]])
        if isinstance(trial, Polygon) and trial.area >= expected_area * 0.8:
            combined = trial

    # 2) Buffer/unbuffer with increasing strength
    if combined is None:
        for buf_extra in [1.0, 2.0, 3.0]:
            buf = gap / 2 + buf_extra
            trial = unary_union([lots[src_idx].buffer(buf),
                                 lots[dst_idx].buffer(buf)]).buffer(-buf)
            if isinstance(trial, MultiPolygon):
                trial = max(trial.geoms, key=lambda g: g.area)
            if not trial.is_empty and trial.area >= expected_area * 0.7:
                combined = trial
                break

    # 3) Bridge fallback: create an explicit narrow bridge between the
    #    two closest points, then union everything into one Polygon.
    if combined is None or combined.area < expected_area * 0.7:
        from shapely.geometry import LineString
        from shapely.ops import nearest_points
        p1, p2 = nearest_points(lots[src_idx], lots[dst_idx])
        bridge_line = LineString([p1, p2])
        bridge_poly = bridge_line.buffer(1.0)  # 2m wide bridge
        combined = unary_union([lots[src_idx], lots[dst_idx], bridge_poly])
        if isinstance(combined, MultiPolygon):
            combined = max(combined.geoms, key=lambda g: g.area)

    # Clip against exclusion zone, but preserve ALL area that's inside
    # either of the two lots being merged. When dst_idx was already merged
    # with a previous lot (absorbing a street), that street area is now
    # part of lots[dst_idx]. We must not re-clip it.
    if exclusion_zone is not None and not exclusion_zone.is_empty:
        # Only clip exclusion zones that are OUTSIDE both lots.
        # Buffer must cover the street gap between them — otherwise the
        # absorbed street corridor gets re-clipped, losing the merged area.
        original_area = unary_union([lots[src_idx], lots[dst_idx]])
        corridor_buf = max(2.0, gap / 2 + 2.0)
        external_exclusion = exclusion_zone.difference(original_area.buffer(corridor_buf))
        if not external_exclusion.is_empty:
            clipped = combined.difference(external_exclusion)
            if not clipped.is_empty:
                if isinstance(clipped, MultiPolygon):
                    combined = max(clipped.geoms, key=lambda g: g.area)
                else:
                    combined = clipped

    # Shape quality gate: reject merges that create strip or triangle lots.
    # This prevents cascading shape violations in post-validation where
    # merging a lot into a neighbor creates a new strip, which gets merged
    # again, destroying product diversity.
    if check_shape and combined.area > 5000:
        ar = aspect_ratio(combined)
        tri = is_triangular(combined)
        if ar > 3.5:
            return False  # would create strip
        if tri:
            return False  # would create triangle

    lots[dst_idx] = combined
    lot_sides[dst_idx] = min_side_length(combined)
    lots[src_idx] = Polygon()
    lot_sides[src_idx] = 0
    assigned[src_idx] = "__MERGED__"
    return True


def assign_products(lots: list[Polygon], allocations: list[dict],
                    exclusion_zone: Polygon = None) -> list[dict]:
    """Assign products to lots with STRICT constraint enforcement.

    Strategy:
    0. Redistribute unviable allocations (product needs more area than allocated)
    1. Proactively merge lots to create big enough areas for demanding products
    2. Assign special products (comercio/equipamiento) first — validate fit
    3. Assign residential by round-robin deficit — strict constraint check
    4. Merge unassigned lots into assigned neighbors
    5. Post-validation: merge any remaining violations

    exclusion_zone: streets + green areas for clipping (corridor between merged
    lots is automatically excluded so absorbed streets are preserved).
    """
    all_product_ids = [a["product_id"] for a in allocations]
    lot_sides = [min_side_length(l) for l in lots]
    assigned = [None] * len(lots)

    total_area = sum(l.area for l in lots)

    # Phase -1: Redistribute unviable allocations.
    # If a residential product's allocated area < its minimum viable area,
    # OR if no lot (even merged) can meet the product's min_side requirement,
    # redistribute that percentage to other residential products.
    viable_allocs = []
    excess_pct = 0
    # Pre-compute: max min_side achievable by merging 2-3 adjacent lots
    max_achievable_side = max(lot_sides) if lot_sides else 0
    for alloc in allocations:
        prod = PRODUCTS[alloc["product_id"]]
        if prod["efficiency"] > 0 and prod["min_units"] > 0:
            min_viable_area = prod["min_units"] / prod["efficiency"] * 10000
            allocated_area = total_area * (alloc["percentage"] / 100.0)
            # Check 1: area viability.
            # Use 0.5x tolerance — Phase 0 can merge lots to create
            # larger areas, so allocated_area < min_viable doesn't mean
            # the product can't be served. Only reject if hopelessly small.
            if allocated_area < min_viable_area * 0.5:
                excess_pct += alloc["percentage"]
                continue
            # Check 2: shape viability — can ANY lot meet the relaxed min_side?
            # Merging can increase min_side somewhat, so use 0.6x threshold
            # (slightly below the 0.7x used in _lot_fits_product)
            relaxed_side = prod["min_side_m"] * 0.6
            if max_achievable_side < relaxed_side:
                excess_pct += alloc["percentage"]
                continue
        viable_allocs.append(alloc)

    if excess_pct > 0 and viable_allocs:
        # Redistribute excess to remaining residential products proportionally
        residential_viable = [a for a in viable_allocs if PRODUCTS[a["product_id"]]["efficiency"] > 0]
        if residential_viable:
            total_res_pct = sum(a["percentage"] for a in residential_viable)
            if total_res_pct > 0:
                for a in residential_viable:
                    a["percentage"] += excess_pct * (a["percentage"] / total_res_pct)
        allocations = viable_allocs
        all_product_ids = [a["product_id"] for a in allocations]

    # Separate special vs residential allocations with targets
    special_allocs = []
    residential_allocs = []
    for alloc in allocations:
        product_id = alloc["product_id"]
        prod = PRODUCTS[product_id]
        pct = alloc["percentage"] / 100.0
        target_area = total_area * pct
        entry = {
            "product_id": product_id,
            "target_area": target_area,
            "assigned_area": 0,
            "lot_size_m2": alloc.get("lot_size_m2"),
            "percentage": alloc["percentage"],
        }
        if prod["efficiency"] == 0:
            # Cap special product target_area to lot_size_m2 when specified.
            # If the user says "7500 m² equipamiento", we should not create
            # more than ~7500 m² total, regardless of percentage.
            if entry["lot_size_m2"] and entry["lot_size_m2"] > 0:
                entry["target_area"] = min(target_area, entry["lot_size_m2"] * 1.3)
            special_allocs.append(entry)
        else:
            residential_allocs.append(entry)

    # Define all_allocs early so it's available throughout the function
    all_allocs = residential_allocs + special_allocs

    # Pre-Phase 0: Reserve lots for special products.
    # When there are special products (comercio, equipamiento), reserve the
    # smallest fitting lots so Phase 0 doesn't consume them during merging.
    # This prevents the scenario where 6 products compete for 6 lots and
    # special products get nothing because residential products merged first.
    # SAFETY: after reserving, verify every residential product can still find
    # at least one fitting unreserved lot. If not, release reservations.
    reserved_indices = set()
    if special_allocs:
        # Sort special by target_area ascending (smallest first)
        for sp in sorted(special_allocs, key=lambda t: t.get("lot_size_m2") or t["target_area"]):
            desired = sp.get("lot_size_m2") or sp["target_area"]
            hard_cap = desired * 2.0
            # Find smallest unassigned, unreserved lot that fits
            candidates = [(i, lots[i]) for i in range(len(lots))
                         if assigned[i] is None and i not in reserved_indices
                         and not lots[i].is_empty
                         and _lot_fits_product(lots[i], sp["product_id"], lot_sides[i])
                         and lots[i].area <= hard_cap]
            if candidates:
                # Pick the lot closest to desired size
                best = min(candidates, key=lambda x: abs(x[1].area - desired))
                reserved_indices.add(best[0])

        # Safety check: every residential product must still have at least one
        # fitting unreserved lot (or be able to merge). If reservation starves
        # a residential product, release the most recently reserved lot.
        for r_alloc in residential_allocs:
            r_pid = r_alloc["product_id"]
            unreserved_fits = [i for i in range(len(lots))
                              if assigned[i] is None and i not in reserved_indices
                              and not lots[i].is_empty
                              and _lot_fits_product(lots[i], r_pid, lot_sides[i])]
            if not unreserved_fits and reserved_indices:
                # Release the reservation that best helps this product
                # (the reserved lot closest to fitting this product)
                best_release = None
                best_release_deficit = float("inf")
                for ri in list(reserved_indices):
                    if _lot_fits_product(lots[ri], r_pid, lot_sides[ri]):
                        deficit = abs(lots[ri].area - r_alloc["target_area"])
                        if deficit < best_release_deficit:
                            best_release_deficit = deficit
                            best_release = ri
                if best_release is not None:
                    reserved_indices.discard(best_release)

    # Phase 0: Proactive merge — ensure each product gets at least ONE lot.
    # Only create 1 lot per product via merging; Phase 2 assigns additional lots.
    #
    # Sort strategy: products that NEED merges go first (their min_area exceeds
    # the biggest available lot), sorted by min_area descending (most demanding
    # first). Products that can fit a single lot go second, sorted by viable
    # range ascending (most constrained first).
    #
    # Why: ds19 needs 15,789+ m² but no single lot is that big — it must merge.
    # If processed after edificios6p (which fits single lots), the best merge
    # candidates are already taken. Merge-needing products must pick first.
    def _viable_range(t):
        prod = PRODUCTS[t["product_id"]]
        if prod["efficiency"] <= 0:
            return float("inf")
        min_a = prod["min_units"] / prod["efficiency"] * 10000
        max_a = prod["max_units"] / prod["efficiency"] * 10000
        return max_a - min_a

    def _min_area_needed(t):
        prod = PRODUCTS[t["product_id"]]
        if prod["efficiency"] <= 0 or prod["min_units"] <= 0:
            return 0
        return prod["min_units"] / prod["efficiency"] * 10000

    max_single_lot = max((l.area for l in lots if not l.is_empty), default=0)

    res_sorted = sorted(residential_allocs,
                        key=lambda t: (
                            0 if _min_area_needed(t) > max_single_lot else 1,
                            _viable_range(t),
                            -t["target_area"],
                        ))

    for target in res_sorted:
        prod = PRODUCTS[target["product_id"]]
        min_area_needed = prod["min_units"] / prod["efficiency"] * 10000
        max_area = (prod["max_units"] / prod["efficiency"] * 10000) if prod["efficiency"] > 0 else float("inf")
        min_side = prod["min_side_m"]

        # Phase 0: secure exactly 1 lot per product.
        # Getting 1 lot for EVERY product is more important than getting
        # 2 lots for one product. Phase 2/Rebalance handle additional lots.
        max_phase0_lots = 1

        for _p0_slot in range(max_phase0_lots):
            # First check: does any unassigned, unreserved lot already fit?
            candidates = [(i, lots[i]) for i in range(len(lots))
                         if assigned[i] is None and i not in reserved_indices
                         and not lots[i].is_empty
                         and _lot_fits_product(lots[i], target["product_id"], lot_sides[i])]

            if candidates:
                # Reserve the lot closest to min_area_needed.
                best_i = min(candidates, key=lambda x: abs(x[1].area - min_area_needed))[0]
                assigned[best_i] = target["product_id"]
                target["assigned_area"] += lots[best_i].area
                continue  # Try to get another slot (or move to next product)

            # No single lot fits — try merging to create a lot for this product.
            unassigned = [(i, lots[i]) for i in range(len(lots))
                         if assigned[i] is None and i not in reserved_indices
                         and not lots[i].is_empty
                         and lots[i].area < max_area]
            if not unassigned:
                break  # No unassigned lots left — stop trying

            # Pick seed: prefer lots meeting the RELAXED min_side threshold
            relaxed_side = min_side * (0.5 if prod["efficiency"] >= 100 else 0.7)
            good_side = [(i, lots[i]) for i, _ in unassigned if lot_sides[i] >= relaxed_side]
            if good_side:
                good_side.sort(key=lambda x: lot_sides[x[0]], reverse=True)
                seed_idx = good_side[0][0]
            else:
                best_candidate = max(unassigned, key=lambda x: lot_sides[x[0]])
                seed_idx = best_candidate[0]

            # Merge neighbors into seed until it fits.
            # Cap at 3 merges to avoid consuming too many lots.
            max_merges = min(3, len(unassigned) - 1)
            for merge_attempt in range(max_merges):
                if _lot_fits_product(lots[seed_idx], target["product_id"], lot_sides[seed_idx]):
                    break
                if lots[seed_idx].area >= max_area:
                    break
                best_ni = _find_best_neighbor(
                    lots, seed_idx, assigned,
                    filter_fn=lambda ni: assigned[ni] is None and ni not in reserved_indices,
                )
                if best_ni < 0:
                    break
                combined_area_est = lots[seed_idx].area + lots[best_ni].area
                if combined_area_est > max_area * 1.2:
                    break
                pre_area = lots[seed_idx].area
                ok = _do_merge(lots, lot_sides, assigned, best_ni, seed_idx,
                              exclusion_zone=exclusion_zone)

            if _lot_fits_product(lots[seed_idx], target["product_id"], lot_sides[seed_idx]):
                assigned[seed_idx] = target["product_id"]
                target["assigned_area"] += lots[seed_idx].area
            else:
                break  # Merge failed — don't try another slot

    # Phase 1: Assign special products — ONE lot per special product.
    # Strategy: find the single best-fitting lot (closest to target area).
    # Never assign more than 1 lot to each special product to prevent
    # over-allocation.
    #
    # STRICT: when lot_size_m2 is specified by the user, it's a hard cap.
    # The lot must not exceed lot_size_m2 * 1.3 (±30% tolerance).
    # The overall target_area (from percentage) is also a cap.
    special_allocs.sort(key=lambda t: t["target_area"])
    for target in special_allocs:
        desired = target["lot_size_m2"] or target["target_area"]
        # Maximum acceptable lot size: 130% of the smaller of desired and target
        max_lot_area = min(desired, target["target_area"]) * 1.3

        available = [(i, lots[i]) for i in range(len(lots))
                    if assigned[i] is None and not lots[i].is_empty
                    and _lot_fits_product(lots[i], target["product_id"], lot_sides[i])
                    and lots[i].area <= max_lot_area]

        if not available:
            # Fallback: if NO lot fits within cap, pick the smallest lot that fits.
            # But still cap at 2x desired — beyond that, it's better to skip
            # and let Phase 5 handle it via rebalance.
            hard_cap = desired * 2.0
            fallback = [(i, lots[i]) for i in range(len(lots))
                       if assigned[i] is None and not lots[i].is_empty
                       and _lot_fits_product(lots[i], target["product_id"], lot_sides[i])
                       and lots[i].area <= hard_cap]
            if fallback:
                available = [min(fallback, key=lambda x: x[1].area)]
            else:
                continue  # Skip — don't assign a wildly oversized lot

        # Pick lot closest to desired size
        available.sort(key=lambda x: abs(x[1].area - desired))
        best_idx, best_lot = available[0]

        assigned[best_idx] = target["product_id"]
        target["assigned_area"] += best_lot.area

    # Clear reservations — from Phase 2 onward, all lots are available
    reserved_indices.clear()

    # Phase 2: Assign remaining lots — minimize deviation from target mix.
    #
    # Strategy: for each unassigned lot, evaluate ALL products and pick the
    # (lot, product) pair that brings the overall allocation closest to target.
    # This prevents greedy assignment where one product consumes everything.
    #
    # Two passes:
    # Pass A: Direct assignment (lot fits product as-is)
    # Pass B: Merge-based assignment (merge adjacent lots for products needing bigger areas)
    all_targets = residential_allocs + special_allocs

    for _round in range(len(lots) * 3):
        unassigned_ids = [i for i in range(len(lots))
                         if assigned[i] is None and not lots[i].is_empty]
        if not unassigned_ids:
            break

        # Evaluate all (lot, product) pairs
        best_pair = None
        best_pair_score = -float("inf")

        for idx in unassigned_ids:
            side = lot_sides[idx]
            for t in all_targets:
                pid = t["product_id"]
                prod = PRODUCTS[pid]

                # Skip if product is already significantly over-allocated
                if t["target_area"] > 0 and t["assigned_area"] / t["target_area"] >= 1.15:
                    continue

                # Special product caps — strict enforcement of lot_size_m2
                if prod["efficiency"] == 0:
                    if t["assigned_area"] >= t["target_area"]:
                        continue
                    if t.get("lot_size_m2"):
                        # Hard cap: lot must not exceed lot_size_m2 * 1.5
                        if lots[idx].area > t["lot_size_m2"] * 1.5:
                            continue
                    if t["assigned_area"] + lots[idx].area > t["target_area"] * 1.3:
                        continue

                if not _lot_fits_product(lots[idx], pid, side):
                    continue

                # Score: how much does this assignment improve overall allocation?
                new_assigned = t["assigned_area"] + lots[idx].area
                new_ratio = new_assigned / max(t["target_area"], 1)
                old_ratio = t["assigned_area"] / max(t["target_area"], 1)
                improvement = abs(old_ratio - 1.0) - abs(new_ratio - 1.0)
                deficit_bonus = max(0, 1.0 - old_ratio) * 0.5
                score = improvement + deficit_bonus
                # Penalty for over-allocation (beyond 100%)
                if new_ratio > 1.0:
                    score -= (new_ratio - 1.0) * 2.0
                # Residential priority: penalize special products on big lots.
                # Large lots (>8000m²) should go to residential products first
                # because residential products NEED them (min_units constraints).
                # Special products can use any size lot.
                if prod["efficiency"] == 0 and lots[idx].area > 8000:
                    # Heavy penalty scales with lot oversizing
                    oversize = lots[idx].area / max(t.get("lot_size_m2") or t["target_area"], 1)
                    score -= oversize * 0.5

                if score > best_pair_score:
                    best_pair_score = score
                    best_pair = (idx, t)

        if best_pair is None or best_pair_score < -0.5:
            # No good direct assignment — try merging
            break

        idx, target = best_pair
        assigned[idx] = target["product_id"]
        target["assigned_area"] += lots[idx].area

    # Pass B: merge adjacent unassigned lots to fill remaining deficits
    for _round in range(len(lots) * 2):
        unassigned_ids = [i for i in range(len(lots))
                         if assigned[i] is None and not lots[i].is_empty]
        if not unassigned_ids:
            break

        # Find most under-allocated residential product that needs merging
        best_target = None
        best_deficit_ratio = float("inf")
        for t in residential_allocs:
            if t["target_area"] <= 0:
                continue
            ratio = t["assigned_area"] / t["target_area"]
            if ratio >= 1.15:
                continue
            prod = PRODUCTS[t["product_id"]]
            min_area = prod["min_units"] / max(prod["efficiency"], 1) * 10000 if prod["efficiency"] > 0 else 0
            # Only try merging if no single lot fits this product
            fits_any = any(_lot_fits_product(lots[i], t["product_id"], lot_sides[i]) for i in unassigned_ids)
            if fits_any:
                continue  # pass A would have handled it
            if ratio < best_deficit_ratio:
                best_deficit_ratio = ratio
                best_target = t

        if best_target is None:
            break

        pid = best_target["product_id"]
        prod = PRODUCTS[pid]
        min_area_needed = prod["min_units"] / max(prod["efficiency"], 1) * 10000 if prod["efficiency"] > 0 else 0

        merged_one = False
        for idx in unassigned_ids:
            def _unassigned_neighbor(ni):
                return assigned[ni] is None and not lots[ni].is_empty
            ni = _find_best_neighbor(lots, idx, assigned, filter_fn=_unassigned_neighbor)
            if ni >= 0:
                combined_est = lots[idx].area + lots[ni].area
                if combined_est >= min_area_needed * 0.85:
                    max_area = (prod["max_units"] / prod["efficiency"] * 10000) if prod["efficiency"] > 0 else float("inf")
                    if combined_est <= max_area * 1.3:
                        _do_merge(lots, lot_sides, assigned, ni, idx, exclusion_zone=exclusion_zone)
                        if _lot_fits_product(lots[idx], pid, lot_sides[idx]):
                            assigned[idx] = pid
                            best_target["assigned_area"] += lots[idx].area
                            merged_one = True
                            break
        if not merged_one:
            break

    # Cleanup: assign any still-unassigned lots to best-fitting product
    remaining = [(i, lots[i]) for i in range(len(lots))
                if assigned[i] is None and not lots[i].is_empty]
    remaining.sort(key=lambda x: x[1].area, reverse=True)
    for idx, lot in remaining:
        side = lot_sides[idx]
        best_t = None
        best_score = -float("inf")
        for t in all_targets:
            if t["assigned_area"] + lot.area > t["target_area"] * 1.3:
                continue
            if t.get("lot_size_m2") and lot.area > t["lot_size_m2"] * 1.3:
                continue
            if _lot_fits_product(lot, t["product_id"], side):
                new_ratio = (t["assigned_area"] + lot.area) / max(t["target_area"], 1)
                score = -abs(new_ratio - 1.0)
                if score > best_score:
                    best_score = score
                    best_t = t
        if best_t is not None:
            assigned[idx] = best_t["product_id"]
            best_t["assigned_area"] += lot.area

    for t in residential_allocs + special_allocs:
        pct_achieved = t['assigned_area']/t['target_area']*100 if t['target_area'] > 0 else 0
    unassigned_count = sum(1 for a in assigned if a is None)

    # Phase 2.5: Merge unassigned lots into under-allocated product lots.
    # After Phase 2, some lots remain unassigned because they're too small
    # for any product. Merge these into adjacent lots of the MOST
    # under-allocated product to improve percentage accuracy.
    for _ in range(len(lots) * 2):
        unassigned_for_merge = [i for i in range(len(lots))
                                if assigned[i] is None and not lots[i].is_empty]
        if not unassigned_for_merge:
            break

        # Sort under-allocated products by deficit ratio (most deficit first)
        under_products = sorted(residential_allocs,
                                key=lambda t: t["assigned_area"] / max(t["target_area"], 1))

        merged_any = False
        for idx in unassigned_for_merge:
            # Try to merge into the most under-allocated product's adjacent lot
            for target in under_products:
                if target["assigned_area"] >= target["target_area"] * 1.15:
                    continue  # already near target
                prod = PRODUCTS[target["product_id"]]

                def _merge_into_under(ni, _pid=target["product_id"], _prod=prod, _target=target):
                    if assigned[ni] != _pid:
                        return False
                    if lots[ni].is_empty:
                        return False
                    combined_area = lots[ni].area + lots[idx].area
                    if _prod["efficiency"] > 0:
                        combined_units = int((combined_area / 10000) * _prod["efficiency"])
                        if combined_units > _prod["max_units"] * 1.15:
                            return False
                    return True

                ni = _find_best_neighbor(lots, idx, assigned,
                                         filter_fn=_merge_into_under)
                if ni >= 0:
                    old_area = lots[ni].area
                    ok = _do_merge(lots, lot_sides, assigned, idx, ni,
                                   exclusion_zone=exclusion_zone)
                    if ok:
                        added = lots[ni].area - old_area
                        target["assigned_area"] += added
                        merged_any = True
                        break  # restart loop
        if not merged_any:
            break

    # Phase 3: Handle unassigned lots.
    # Strategy: first try to ASSIGN to a fitting product (no merge needed);
    # only merge as last resort, and CHECK that merge doesn't violate constraints.
    for _ in range(len(lots) * 3):
        unassigned = [i for i in range(len(lots))
                     if assigned[i] is None and not lots[i].is_empty]
        if not unassigned:
            break
        idx = unassigned[0]

        # First: try to assign directly to a fitting product.
        # Prefer residential products; only use special if they have deficit.
        # This prevents comercio/equipamiento from absorbing residential lots.
        best_t = None
        best_deficit = -float("inf")
        for t in residential_allocs:
            if _lot_fits_product(lots[idx], t["product_id"], lot_sides[idx]):
                deficit = t["target_area"] - t["assigned_area"]
                if deficit > best_deficit:
                    best_deficit = deficit
                    best_t = t
        if best_t is None:
            # Only try special products if they still have significant deficit
            # AND lot doesn't exceed lot_size_m2 cap or target_area * 2.0
            # AND total accumulated area wouldn't exceed 1.5x target
            for t in special_allocs:
                if t["assigned_area"] >= t["target_area"]:
                    continue  # cap reached
                # Enforce lot_size_m2 cap (user-specified hard limit)
                if t.get("lot_size_m2") and lots[idx].area > t["lot_size_m2"] * 1.3:
                    continue  # lot too large for this special product's cap
                # General area cap: lot should not exceed 2x the product's target
                if lots[idx].area > t["target_area"] * 2.0:
                    continue  # lot way too large for this product's allocation
                # Check that TOTAL accumulated area won't exceed 1.5x target
                if t["assigned_area"] + lots[idx].area > t["target_area"] * 1.5:
                    continue  # would over-allocate
                if _lot_fits_product(lots[idx], t["product_id"], lot_sides[idx]):
                    deficit = t["target_area"] - t["assigned_area"]
                    if deficit > 0 and (best_t is None or deficit > best_deficit):
                        best_deficit = deficit
                        best_t = t
        if best_t is not None:
            assigned[idx] = best_t["product_id"]
            best_t["assigned_area"] += lots[idx].area
            continue

        # Can't assign — merge into nearest assigned neighbor.
        # Prefer merging into RESIDENTIAL neighbors (not special products).
        # This prevents comercio/equipamiento from growing beyond their target.
        def _good_merge_neighbor(ni):
            if assigned[ni] is None or assigned[ni] == "__MERGED__":
                return False
            return True

        def _prefer_residential(ni):
            """Prefer residential neighbors to avoid inflating special products."""
            if assigned[ni] is None or assigned[ni] == "__MERGED__":
                return False
            return PRODUCTS[assigned[ni]]["efficiency"] > 0

        # Try residential neighbors first, then any neighbor
        ni = _find_best_neighbor(lots, idx, assigned, filter_fn=_prefer_residential)
        if ni < 0:
            ni = _find_best_neighbor(lots, idx, assigned, filter_fn=_good_merge_neighbor)
        if ni < 0:
            ni = _find_best_neighbor(lots, idx, assigned, max_distance=40.0,
                                     filter_fn=_good_merge_neighbor)
        if ni >= 0:
            combined_area_est = lots[idx].area + lots[ni].area
            neighbor_prod = PRODUCTS[assigned[ni]]

            # ALWAYS check constraints — even for tiny lots.
            # A tiny lot merged into an already-large neighbor can push it
            # over max_units, causing cascading reassignment problems.
            should_merge = True
            if neighbor_prod["efficiency"] > 0:
                combined_units = int((combined_area_est / 10000) * neighbor_prod["efficiency"])
                should_merge = combined_units <= neighbor_prod["max_units"] * 1.3
            elif neighbor_prod["efficiency"] == 0:
                # Special product: check if merge would over-allocate
                pid = assigned[ni]
                alloc_target = None
                for t in special_allocs:
                    if t["product_id"] == pid:
                        alloc_target = t
                        break
                if alloc_target:
                    should_merge = (alloc_target["assigned_area"] + lots[idx].area) <= alloc_target["target_area"] * 1.3
                else:
                    should_merge = True
            if should_merge:
                ok = _do_merge(lots, lot_sides, assigned, idx, ni, exclusion_zone=exclusion_zone)
                if ok:
                    continue

        # Last resort: force-merge into ANY nearest neighbor (even far ones).
        # BUT check that merge doesn't create a lot exceeding max_units
        # (for residential) or target_area (for special products).
        def _ok_force_merge_any(ni):
            if assigned[ni] is None or assigned[ni] == "__MERGED__":
                return False
            pid = assigned[ni]
            prod = PRODUCTS[pid]
            combined_area = lots[ni].area + lots[idx].area
            if prod["efficiency"] > 0:
                combined_units = int((combined_area / 10000) * prod["efficiency"])
                return combined_units <= prod["max_units"] * 1.3
            # Special product: strict cap
            for t in special_allocs:
                if t["product_id"] == pid:
                    return (t["assigned_area"] + lots[idx].area) <= t["target_area"] * 1.5
            return True

        ni = _find_best_neighbor(lots, idx, assigned, max_distance=80.0,
                                 filter_fn=_ok_force_merge_any)
        if ni >= 0:
            ok = _do_merge(lots, lot_sides, assigned, idx, ni, exclusion_zone=exclusion_zone)
            if ok:
                continue

        # Before force-assigning, try to SPLIT the lot into smaller pieces.
        # A big lot that doesn't fit any product might fit if halved.
        # Minimum part area = 8000m² (enough for the smallest residential product)
        if lots[idx].area > 15000:  # only split lots > 1.5ha
            angle_guess = minimum_rotated_rectangle_angle(lots[idx])
            split_parts = _split_polygon_no_street(lots[idx], angle_guess, 0.0)
            if len(split_parts) >= 2 and all(p.area > 8000 for p in split_parts):
                # Replace this lot with the parts
                lots[idx] = split_parts[0]
                lot_sides[idx] = min_side_length(split_parts[0])
                for extra_part in split_parts[1:]:
                    lots.append(extra_part)
                    lot_sides.append(min_side_length(extra_part))
                    assigned.append(None)
                continue  # re-process in next iteration

        # ── Last resort: force-assign or convert to green adjustment area ──
        #
        # Strategy (in order):
        # 1. Assign to residential product with most deficit (even if below
        #    min_units — "adjustment lot" rule for casas/townhouses)
        # 2. Assign to special product within area cap
        # 3. If lot is very small (< 3000m²), convert to adjustment green area
        # 4. Absolute fallback: assign to product with most deficit

        # Option A: residential with most deficit (allow adjustment lots)
        best_t = max(residential_allocs,
                    key=lambda t: t["target_area"] - t["assigned_area"],
                    default=None)

        # No green adjustments — all lots must get a product.
        # If no residential product fits, try special products.
        if best_t is None:
            # Only consider special products that won't exceed 1.5x target
            eligible_special = [t for t in special_allocs
                               if t["assigned_area"] + lots[idx].area <= t["target_area"] * 1.5
                               and not (t.get("lot_size_m2") and lots[idx].area > t["lot_size_m2"] * 1.3)]
            if not eligible_special:
                eligible_special = [t for t in special_allocs
                                   if t["assigned_area"] + lots[idx].area <= t["target_area"] * 2.0
                                   and not (t.get("lot_size_m2") and lots[idx].area > t["lot_size_m2"] * 1.3)]
            if not eligible_special:
                eligible_special = list(special_allocs)
            if eligible_special:
                best_t = max(eligible_special,
                            key=lambda t: t["target_area"] - t["assigned_area"])
            elif special_allocs:
                best_t = max(special_allocs,
                            key=lambda t: t["target_area"] - t["assigned_area"])
            else:
                # No special products available — fall back to ANY product with most deficit
                best_t = max(all_allocs,
                            key=lambda t: t["target_area"] - t["assigned_area"])
        assigned[idx] = best_t["product_id"]
        best_t["assigned_area"] += lots[idx].area


    # Phase 4: Post-validation — fix lots that violate their product constraints.
    # Strategy: reassign to a product the lot fits. NEVER merge — merging caused
    # cascading violations in previous versions. If nothing fits, keep as-is
    # (units will be clamped in output).
    for _ in range(len(lots) * 2):
        violation_idx = None
        for i in range(len(lots)):
            if assigned[i] == "__MERGED__" or lots[i].is_empty:
                continue
            if not _lot_fits_product(lots[i], assigned[i], lot_sides[i]):
                violation_idx = i
                break

        if violation_idx is None:
            break

        # Try reassigning to a different product that fits
        reassigned = False
        for t in residential_allocs + special_allocs:
            if t["product_id"] == assigned[violation_idx]:
                continue
            if _lot_fits_product(lots[violation_idx], t["product_id"], lot_sides[violation_idx]):
                assigned[violation_idx] = t["product_id"]
                t["assigned_area"] += lots[violation_idx].area
                reassigned = True
                break
        if not reassigned:
            # Reassignment failed — try merging with same-product neighbor.
            # This handles single-product scenarios where an undersized lot
            # can't be reassigned but CAN be absorbed by a neighbor.
            vid = violation_idx
            vpid = assigned[vid]
            vprod = PRODUCTS[vpid]

            def _ok_phase4_merge(ni):
                if assigned[ni] is None or assigned[ni] == "__MERGED__":
                    return False
                if assigned[ni] != vpid:
                    return False  # only same-product merges
                combined_area = lots[ni].area + lots[vid].area
                if vprod["efficiency"] > 0:
                    combined_units = int((combined_area / 10000) * vprod["efficiency"])
                    return combined_units <= vprod["max_units"] * 1.15
                return True

            merge_ni = _find_best_neighbor(lots, vid, assigned,
                                           max_distance=80.0,
                                           filter_fn=_ok_phase4_merge)
            if merge_ni >= 0:
                _do_merge(lots, lot_sides, assigned, vid, merge_ni,
                          exclusion_zone=exclusion_zone)
                continue  # re-check for more violations

            # Last resort: cross-product merge — absorb undersized lot into
            # ANY adjacent neighbor. The merged lot keeps the neighbor's product
            # (since the violation lot doesn't fit its own product anyway).
            def _ok_cross_merge(ni):
                if assigned[ni] is None or assigned[ni] == "__MERGED__":
                    return False
                npid = assigned[ni]
                nprod = PRODUCTS[npid]
                combined_area = lots[ni].area + lots[vid].area
                if nprod["efficiency"] > 0:
                    combined_units = int((combined_area / 10000) * nprod["efficiency"])
                    return combined_units <= nprod["max_units"] * 1.3
                return True

            cross_ni = _find_best_neighbor(lots, vid, assigned,
                                            max_distance=80.0,
                                            filter_fn=_ok_cross_merge)
            if cross_ni >= 0:
                # Absorb violation lot into neighbor — neighbor keeps its product
                _do_merge(lots, lot_sides, assigned, vid, cross_ni,
                          exclusion_zone=exclusion_zone)
                continue  # re-check for more violations
            # Truly nothing works — keep as-is, units will be clamped
            break

    # Phase 5: Rebalance — reassign lots from over-allocated products to
    # under-allocated ones. Iterates multiple rounds, trying ALL possible
    # over→under swaps, not just the single most imbalanced pair.
    all_allocs = residential_allocs + special_allocs
    # Recalculate assigned_area from actual assignments
    for t in all_allocs:
        t["assigned_area"] = sum(lots[i].area for i in range(len(lots))
                                 if assigned[i] == t["product_id"] and not lots[i].is_empty)

    # Track swaps to prevent infinite loops (lot bouncing between products)
    swap_history = set()
    for _ in range(len(lots) * 3):
        # Find ALL over-allocated products (>1.05x target), sorted by ratio desc
        over_candidates = []
        for t in all_allocs:
            if t["target_area"] <= 0:
                continue
            ratio = t["assigned_area"] / t["target_area"]
            if ratio > 1.05:
                over_candidates.append((ratio, t))
        over_candidates.sort(key=lambda x: x[0], reverse=True)

        if not over_candidates:
            break

        # Find ALL under-allocated products, sorted by ratio asc
        under_candidates = []
        for t in all_allocs:
            if t["target_area"] <= 0:
                continue
            ratio = t["assigned_area"] / t["target_area"]
            if ratio < 0.95:
                under_candidates.append((ratio, t))
        under_candidates.sort(key=lambda x: x[0])

        if not under_candidates:
            break

        swapped = False
        for _, over_alloc in over_candidates:
            # PROTECT: Don't strip a product down to 0 lots if its min_area
            # exceeds its target. These products are INHERENTLY over-allocated
            # because their minimum viable lot is bigger than their share.
            over_pid = over_alloc["product_id"]
            over_prod = PRODUCTS[over_pid]
            over_lot_count = sum(1 for i in range(len(lots))
                                if assigned[i] == over_pid and not lots[i].is_empty)
            if over_lot_count <= 1 and over_prod["efficiency"] > 0:
                min_viable = over_prod["min_units"] / over_prod["efficiency"] * 10000
                if min_viable > over_alloc["target_area"]:
                    continue  # This product NEEDS its only lot

            for _, under_alloc in under_candidates:
                if over_alloc["product_id"] == under_alloc["product_id"]:
                    continue

                # Try to reassign one lot from over to under
                over_lots = [(i, lots[i]) for i in range(len(lots))
                            if assigned[i] == over_alloc["product_id"] and not lots[i].is_empty]
                over_lots.sort(key=lambda x: x[1].area)

                found = False
                for idx, lot in over_lots:
                    # Prevent infinite swap: skip if this lot was already swapped
                    swap_key = (idx, over_alloc["product_id"], under_alloc["product_id"])
                    if swap_key in swap_history:
                        continue
                    if under_alloc.get("lot_size_m2") and lot.area > under_alloc["lot_size_m2"] * 1.3:
                        continue
                    # Check reassigning wouldn't over-allocate under_alloc
                    if under_alloc["assigned_area"] + lot.area > under_alloc["target_area"] * 1.15:
                        continue
                    if _lot_fits_product(lot, under_alloc["product_id"], lot_sides[idx]):
                        assigned[idx] = under_alloc["product_id"]
                        over_alloc["assigned_area"] -= lot.area
                        under_alloc["assigned_area"] += lot.area
                        swap_history.add(swap_key)
                        # Also block reverse swap
                        swap_history.add((idx, under_alloc["product_id"], over_alloc["product_id"]))
                        found = True
                        swapped = True
                        break

                if not found:
                    # Try merging over lot into adjacent under-allocated neighbor
                    for idx, lot in over_lots:
                        ni = _find_best_neighbor(
                            lots, idx, assigned,
                            filter_fn=lambda ni: assigned[ni] == under_alloc["product_id"]
                        )
                        if ni >= 0:
                            u_prod = PRODUCTS[under_alloc["product_id"]]
                            combined_area = lot.area + lots[ni].area
                            if under_alloc.get("lot_size_m2") and combined_area > under_alloc["lot_size_m2"] * 1.3:
                                continue
                            ok = False
                            if u_prod["efficiency"] > 0:
                                combined_units = int((combined_area / 10000) * u_prod["efficiency"])
                                ok = combined_units <= u_prod["max_units"] * 1.3
                            else:
                                ok = True
                            if ok:
                                _do_merge(lots, lot_sides, assigned, idx, ni, exclusion_zone=exclusion_zone)
                                over_alloc["assigned_area"] -= lot.area
                                under_alloc["assigned_area"] += lot.area
                                found = True
                                swapped = True
                                break

                if found:
                    break  # restart outer loop to recalculate ratios
            if swapped:
                break

        if not swapped:
            break  # no more swaps possible

    for t in all_allocs:
        pct_achieved = t['assigned_area']/t['target_area']*100 if t['target_area'] > 0 else 0

    # FINAL CATCH-ALL: No ghost lots allowed.
    # Strategy: first try to MERGE unassigned lots into their nearest assigned
    # neighbor (preferred — eliminates the ghost entirely). If no neighbor is
    # reachable, force-assign to the product with most deficit.
    for _ in range(len(lots) * 2):
        ghost_idx = None
        for i in range(len(lots)):
            if assigned[i] is None and not lots[i].is_empty and lots[i].area >= 50:
                ghost_idx = i
                break
        if ghost_idx is None:
            break

        # Try merging into nearest assigned neighbor (any product, any distance)
        best_ni = -1
        best_dist = float("inf")
        for ni in range(len(lots)):
            if ni == ghost_idx or lots[ni].is_empty:
                continue
            if assigned[ni] is None or assigned[ni] == "__MERGED__":
                continue
            d = lots[ghost_idx].distance(lots[ni])
            if d < best_dist:
                best_dist = d
                best_ni = ni

        if best_ni >= 0 and best_dist <= 80.0:
            # Merge ghost into neighbor — force merge (no shape checks)
            _do_merge(lots, lot_sides, assigned, ghost_idx, best_ni,
                      exclusion_zone=exclusion_zone, check_shape=False)
        else:
            # No neighbor reachable — force-assign
            best_t = max(all_allocs,
                         key=lambda t: t["target_area"] - t["assigned_area"])
            assigned[ghost_idx] = best_t["product_id"]
            best_t["assigned_area"] += lots[ghost_idx].area

    # Collect green adjustment areas (lots converted from unusable slivers)
    green_adjustments = []
    for i in range(len(lots)):
        if assigned[i] == "__GREEN_ADJUST__" and not lots[i].is_empty:
            green_adjustments.append(lots[i])

    # Build results (skip merged placeholders and green adjustments)
    results = []
    for i in range(len(lots)):
        if assigned[i] in ("__MERGED__", "__GREEN_ADJUST__") or lots[i].is_empty or lots[i].area < 50:
            continue
        product_id = assigned[i]
        prod = PRODUCTS[product_id]
        area_ha = lots[i].area / 10000
        units = int(area_ha * prod["efficiency"]) if prod["efficiency"] > 0 else 0
        # Clamp units to max
        if prod["max_units"] > 0 and units > prod["max_units"]:
            units = prod["max_units"]
        results.append({
            "polygon": lots[i],
            "product_id": product_id,
            "area_m2": lots[i].area,
            "units": units,
            "min_side_m": lot_sides[i],
        })

    return results, green_adjustments


def calc_lot_value(product_id: str, area_m2: float, units: int) -> float:
    """Calculate land value in UF for a lot."""
    prod = PRODUCTS[product_id]
    # Direct land value (comercio)
    if "land_value_uf_m2" in prod and prod["land_value_uf_m2"] > 0:
        return area_m2 * prod["land_value_uf_m2"]
    # Residential: value = units * ticket * incidencia
    if prod["price_uf"] > 0 and prod["incidencia"] > 0:
        return units * prod["price_uf"] * prod["incidencia"]
    return 0


def generate_mini_parks(lots: list[Polygon], streets: list[Polygon],
                        min_area: float = 400, max_area: float = 1500) -> list[Polygon]:
    """Place mini-parks at street intersections."""
    parks = []
    if len(streets) < 1:
        return parks

    street_union = unary_union(streets) if streets else Polygon()

    if len(streets) >= 2:
        for i in range(len(streets)):
            for j in range(i + 1, len(streets)):
                intersection = streets[i].intersection(streets[j])
                if not intersection.is_empty and intersection.area > 20:
                    park = intersection.buffer(12).intersection(street_union.buffer(18))
                    if park.area >= min_area:
                        parks.append(park)

    if not parks and len(streets) >= 1:
        for s in streets:
            centroid = s.centroid
            park_candidate = centroid.buffer(15)
            park = park_candidate.intersection(street_union.buffer(8))
            if not park.is_empty and park.area >= min_area * 0.5:
                parks.append(park)

    if not parks and len(lots) >= 3:
        for i in range(len(lots)):
            for j in range(i + 1, len(lots)):
                touch = lots[i].boundary.intersection(lots[j].boundary)
                if not touch.is_empty and touch.length > 5:
                    mid = touch.interpolate(0.5, normalized=True)
                    park_candidate = mid.buffer(12)
                    lot_union = unary_union(lots)
                    park = park_candidate.difference(lot_union.buffer(-3))
                    if not park.is_empty and park.area >= min_area * 0.3:
                        parks.append(park)
                        if len(parks) >= 2:
                            break
            if len(parks) >= 2:
                break

    return parks[:4]


def run_subdivision(fids: list[str], allocations: list[dict], max_viviendas: int = None, custom_streets: list = None) -> dict:
    """Main entry: run full subdivision pipeline for one or more macrolotes.

    Args:
        fids: Macrolote feature IDs to subdivide.
        allocations: Product allocations with percentages.
        max_viviendas: Optional district-level max housing units cap.
        custom_streets: Optional user-drawn street lines [{coordinates: [[lng,lat],...], width_m: float}].
    """
    lotes_gdf, av_gdf, vial_gdf = load_geodata()

    # Get macrolotes (may be multiple non-adjacent polygons)
    macrolote_polys = get_macrolotes(lotes_gdf, fids)
    macro_area = sum(p.area for p in macrolote_polys)

    # Get green areas and buildable parts for ALL macrolote polygons
    all_buildable = []
    all_green_areas = []  # Green areas INSIDE macrolotes (for buildable area subtraction)
    angles = []
    for poly in macrolote_polys:
        green_areas = get_intersecting_greens(poly, av_gdf)
        all_green_areas.extend(green_areas)
        parts = get_buildable_area(poly, green_areas)
        all_buildable.extend(parts)
        angles.append(minimum_rotated_rectangle_angle(poly))

    # Also collect green areas NEAR the macrolotes (within 25m).
    # These don't affect buildable area but ARE used for street orientation:
    # streets must not point toward nearby green areas even if green is
    # technically outside the macrolote boundary.
    merged_macro = unary_union(macrolote_polys)
    nearby_greens = get_nearby_greens(merged_macro, av_gdf, proximity_m=25.0)
    # Combine: all_green_for_streets = internal + nearby (for street avoidance)
    all_green_for_streets = list(all_green_areas) + nearby_greens

    if not all_buildable:
        raise ValueError("No buildable area after removing green areas")

    # Use most common angle (or first)
    angle = angles[0] if angles else 0

    # Build structural road union for street orientation checks
    all_streets = []
    try:
        vial_geoms = []
        for _, row in vial_gdf.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            geom = geom.buffer(0)
            if isinstance(geom, MultiPolygon):
                vial_geoms.extend(g for g in geom.geoms if g.area > 1)
            elif isinstance(geom, Polygon) and geom.area > 1:
                vial_geoms.append(geom)
        vial_union = unary_union(vial_geoms) if vial_geoms else Polygon()
    except Exception:
        vial_union = Polygon()

    # ── Plan-first subdivision ──
    green_for_streets_union = unary_union(all_green_for_streets) if all_green_for_streets else Polygon()

    # ── Custom streets mode ──
    # User-drawn streets define the ONLY internal streets.
    # Each resulting block = one lot assigned to a product.
    # No internal subdivision — the user controls the layout.
    if custom_streets and len(custom_streets) > 0:
        from pyproj import Transformer
        wgs_to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32719", always_xy=True)
        macro_union = unary_union(macrolote_polys)

        # ── Step 1: Convert street lines to UTM and snap endpoints to vialidad ──
        custom_street_polys = []
        for cs in custom_streets:
            coords = cs["coordinates"]
            if len(coords) < 2:
                continue
            utm_coords = [wgs_to_utm.transform(c[0], c[1]) for c in coords]

            # Snap endpoints to structural roads if within 50m
            if not vial_union.is_empty:
                SNAP_DIST = 50.0
                start = Point(utm_coords[0])
                end = Point(utm_coords[-1])
                # Snap start
                nearest_start = vial_union.boundary.interpolate(
                    vial_union.boundary.project(start)
                )
                if start.distance(nearest_start) < SNAP_DIST:
                    utm_coords[0] = (nearest_start.x, nearest_start.y)
                # Snap end
                nearest_end = vial_union.boundary.interpolate(
                    vial_union.boundary.project(end)
                )
                if end.distance(nearest_end) < SNAP_DIST:
                    utm_coords[-1] = (nearest_end.x, nearest_end.y)

            # Also extend endpoints to macrolote boundary if close
            macro_boundary = macro_union.boundary
            for idx in [0, -1]:
                pt = Point(utm_coords[idx])
                nearest_on_boundary = macro_boundary.interpolate(
                    macro_boundary.project(pt)
                )
                if pt.distance(nearest_on_boundary) < 30.0:
                    utm_coords[idx] = (nearest_on_boundary.x, nearest_on_boundary.y)

            line = LineString(utm_coords)
            width = cs.get("width_m", 12.0)
            street_poly = line.buffer(width / 2.0, cap_style=2)
            if street_poly.is_valid and not street_poly.is_empty:
                custom_street_polys.append(street_poly)

        if custom_street_polys:
            custom_street_union = unary_union(custom_street_polys)
            # Clip streets to macrolote boundary
            custom_street_union = custom_street_union.intersection(macro_union)

            # Get buildable area minus streets and greens
            green_union = unary_union(all_green_areas) if all_green_areas else Polygon()
            remaining = macro_union.difference(custom_street_union)
            if not green_union.is_empty:
                remaining = remaining.difference(green_union)

            # Extract blocks — filter out slivers and ghost fragments
            MIN_BLOCK_AREA = 500  # m² — blocks smaller than this are slivers
            raw_blocks = []
            if isinstance(remaining, MultiPolygon):
                raw_blocks = [g for g in remaining.geoms if isinstance(g, Polygon)]
            elif isinstance(remaining, Polygon):
                raw_blocks = [remaining]
            elif hasattr(remaining, 'geoms'):
                raw_blocks = [g for g in remaining.geoms if isinstance(g, Polygon)]

            # Separate real blocks from slivers
            blocks = []
            slivers = []
            for b in raw_blocks:
                if b.area < MIN_BLOCK_AREA:
                    slivers.append(b)
                    continue
                # Check aspect ratio — reject very thin strips
                mrr = b.minimum_rotated_rectangle
                mc = list(mrr.exterior.coords)
                s1 = math.sqrt((mc[1][0]-mc[0][0])**2 + (mc[1][1]-mc[0][1])**2)
                s2 = math.sqrt((mc[2][0]-mc[1][0])**2 + (mc[2][1]-mc[1][1])**2)
                short_side = min(s1, s2)
                if short_side < 15:  # thinner than 15m = sliver
                    slivers.append(b)
                else:
                    blocks.append(b)

            # Merge slivers into nearest real block
            for sliver in slivers:
                if not blocks:
                    break
                best_idx = 0
                best_dist = float('inf')
                for bi, blk in enumerate(blocks):
                    d = sliver.distance(blk)
                    if d < best_dist:
                        best_dist = d
                        best_idx = bi
                merged = unary_union([blocks[best_idx], sliver])
                if isinstance(merged, Polygon):
                    blocks[best_idx] = merged
                elif isinstance(merged, MultiPolygon):
                    blocks[best_idx] = max(merged.geoms, key=lambda g: g.area)

            if not blocks:
                raise ValueError("No buildable blocks after subtracting custom streets")

            # ── Step 2: Assign products to blocks by proportion ──
            blocks.sort(key=lambda b: b.area, reverse=True)
            total_block_area = sum(b.area for b in blocks)

            # Build product list with target areas, sorted by percentage desc
            product_demands = []
            for alloc in allocations:
                pid = alloc["product_id"]
                pct = alloc["percentage"]
                if pct <= 0:
                    continue
                product_demands.append({
                    "product_id": pid,
                    "percentage": pct,
                    "target_area": total_block_area * pct / 100.0,
                    "assigned_area": 0.0,
                })
            product_demands.sort(key=lambda d: d["target_area"], reverse=True)

            # Assign each block to the best-fit product considering:
            # - Largest remaining deficit (target_area - assigned_area)
            # - Don't assign huge blocks to low-% products (cap at 2x target)
            # - If block exceeds max_lot_area, subdivide into multiple same-product lots
            assigned = []
            for block in blocks:
                # Score each product: deficit, but penalize over-assignment
                best = None
                best_score = -float('inf')
                for d in product_demands:
                    deficit = d["target_area"] - d["assigned_area"]
                    # Skip products already over-assigned by >20%
                    if d["assigned_area"] > d["target_area"] * 1.2 and deficit < 0:
                        score = deficit * 2  # strong penalty
                    elif block.area > d["target_area"] * 2 and deficit < block.area * 0.5:
                        # Block is way bigger than what this product needs total
                        score = deficit - block.area
                    else:
                        score = deficit
                    if score > best_score:
                        best_score = score
                        best = d

                pid = best["product_id"]
                best["assigned_area"] += block.area

                max_area = _max_lot_area(pid) * 1.10  # +10% flex
                if block.area > max_area:
                    sub_lots = _subdivide_block_into_lots(block, pid)
                    assigned.extend(sub_lots)
                else:
                    product = PRODUCTS.get(pid, {})
                    efficiency = product.get("efficiency", 0)
                    max_u = product.get("max_units", 9999)
                    units = round((block.area / 10000) * efficiency) if efficiency > 0 else 0
                    units = min(units, max_u)
                    assigned.append({
                        "polygon": block,
                        "product_id": pid,
                        "area_m2": block.area,
                        "units": units,
                        "_group_idx": 0,
                    })

            # ── Step 3: Build street polygons for response ──
            all_streets = []
            if isinstance(custom_street_union, MultiPolygon):
                all_streets = list(custom_street_union.geoms)
            elif isinstance(custom_street_union, Polygon) and not custom_street_union.is_empty:
                all_streets = [custom_street_union]

            parks = list(all_green_areas)
            _custom_mode = True
        else:
            _custom_mode = False
    else:
        _custom_mode = False

    if _custom_mode:
        return _build_response(assigned, all_streets, parks, green_union, macro_area, macrolote_polys, vial_union, max_viviendas)

    # Identify connected macrolote groups by buffer-merging adjacent polygons.
    # Non-adjacent macrolotes get subdivided independently with proportional
    # allocation, preventing the gap elimination from inflating lots.
    macro_union_poly = unary_union(macrolote_polys)
    if isinstance(macro_union_poly, MultiPolygon):
        # Try buffer-merge to bridge thin gaps between truly adjacent macrolotes
        merged = unary_union([g.buffer(5) for g in macro_union_poly.geoms]).buffer(-5)
        if isinstance(merged, MultiPolygon):
            groups = [g for g in merged.geoms if g.area > 500]
        else:
            groups = [merged]
    else:
        groups = [macro_union_poly]

    # Sort groups largest-first for allocation priority
    groups.sort(key=lambda g: g.area, reverse=True)
    total_group_area = sum(g.area for g in groups)

    assigned = []

    if len(groups) == 1:
        # Single connected group — use full allocations directly
        group_angle = minimum_rotated_rectangle_angle(groups[0])
        part_lots, part_streets = plan_first_subdivide(
            groups[0], allocations, group_angle, green_for_streets_union,
            vial_union=vial_union, street_width=12.0
        )
        for lot in part_lots:
            lot["_group_idx"] = 0
        assigned.extend(part_lots)
        all_streets.extend(part_streets)
    else:
        # Multiple disconnected groups — lot-level bin packing.
        # Build individual lot demands globally, then assign each lot to
        # the best-fit group based on the lot's target area vs group capacity.

        # Step 1: Build lot demands from global allocation
        lot_demands = []
        for alloc in allocations:
            pid = alloc["product_id"]
            pct = alloc["percentage"]
            product_target = total_group_area * pct / 100.0
            max_area = _max_lot_area(pid)
            min_area = _min_lot_area(pid)
            if product_target <= 0:
                continue
            if product_target <= max_area:
                n_lots = 1
            else:
                n_lots = math.ceil(product_target / max_area)
            lot_area = product_target / n_lots
            # If lot_area < min_area, reduce n_lots so each lot is big enough
            if lot_area < min_area and n_lots > 1:
                n_lots = max(1, int(product_target / min_area))
                lot_area = product_target / n_lots
            for _ in range(n_lots):
                lot_demands.append({
                    "product_id": pid,
                    "target_area": lot_area,
                    "min_area": min_area,
                })

        # Sort demands largest-first (FFD bin packing)
        lot_demands.sort(key=lambda d: d["target_area"], reverse=True)

        group_assignments = {i: [] for i in range(len(groups))}
        group_remaining = {i: groups[i].area for i in range(len(groups))}

        # Assign each lot demand to a group:
        # First-fit decreasing: for each lot (largest first), place it in the
        # group with the MOST remaining area that can fit the lot's target area.
        # This fills the largest group first, keeping smaller groups for
        # smaller products.
        for demand in lot_demands:
            ta = demand["target_area"]
            ma = demand["min_area"]
            # First fit: largest remaining area that can fit this lot's target
            best_gi = None
            best_remaining = -1
            for gi in range(len(groups)):
                rem = group_remaining[gi]
                if rem >= ta:  # can fit the full target area
                    if rem > best_remaining:
                        best_remaining = rem
                        best_gi = gi
            if best_gi is None:
                # Relax: any group that can fit at least the lot's min area
                best_remaining = -1
                for gi in range(len(groups)):
                    rem = group_remaining[gi]
                    if rem >= ma:
                        if rem > best_remaining:
                            best_remaining = rem
                            best_gi = gi
            if best_gi is None:
                # Last resort: group with most remaining area
                best_gi = max(range(len(groups)), key=lambda gi: group_remaining[gi])
            group_assignments[best_gi].append(demand)
            group_remaining[best_gi] -= ta

        for gi in range(len(groups)):
            demands = group_assignments[gi]
            pids = [d["product_id"] for d in demands]
            total_demand = sum(d["target_area"] for d in demands)

        # Run plan_first_subdivide on each group with its assigned products
        for gi, group_poly in enumerate(groups):
            demands = group_assignments[gi]
            if not demands:
                continue

            # Convert demands to percentage-based allocations relative to group area
            product_areas = {}
            for d in demands:
                pid = d["product_id"]
                product_areas[pid] = product_areas.get(pid, 0) + d["target_area"]

            # Normalize percentages to sum to ~100% of group area
            # (bin-packing may over-allocate a group)
            total_demand_area = sum(product_areas.values())
            group_allocs = []
            for pid, area in product_areas.items():
                if total_demand_area > 0:
                    pct = (area / total_demand_area) * 100.0
                else:
                    pct = 0
                group_allocs.append({"product_id": pid, "percentage": pct})

            group_angle = minimum_rotated_rectangle_angle(group_poly)
            part_lots, part_streets = plan_first_subdivide(
                group_poly, group_allocs, group_angle, green_for_streets_union,
                vial_union=vial_union, street_width=12.0
            )
            for lot in part_lots:
                lot["_group_idx"] = gi
            assigned.extend(part_lots)
            all_streets.extend(part_streets)

    if not assigned:
        raise ValueError("Subdivision produced no lots")

    # Build exclusion zone (streets + greens) for clipping
    street_union = unary_union(all_streets) if all_streets else Polygon()
    green_union = Polygon()
    for poly in macrolote_polys:
        greens = get_intersecting_greens(poly, av_gdf)
        if greens:
            green_union = unary_union([green_union] + greens) if not green_union.is_empty else unary_union(greens)
    exclusion_zone = unary_union([street_union, green_union]) if not green_union.is_empty else street_union

    # ── No-overlap enforcement ──
    # After merging, lots can overlap (buffer/unbuffer expands into neighbors).
    # Process lots largest-first: each lot claims its territory, smaller lots
    # get clipped to avoid overlap. Also clip all lots to macrolote perimeter.
    macro_union = unary_union(macrolote_polys)

    def _extract_polygon(geom):
        """Extract the largest Polygon from any geometry type."""
        if isinstance(geom, Polygon):
            return geom
        if hasattr(geom, 'geoms'):
            polys = [g for g in geom.geoms if isinstance(g, Polygon) and g.area > 10]
            if polys:
                return max(polys, key=lambda g: g.area)
        return Polygon()

    assigned.sort(key=lambda a: a["area_m2"], reverse=True)
    for i in range(len(assigned)):
        # Clip to macrolote perimeter
        clipped = _extract_polygon(assigned[i]["polygon"].intersection(macro_union))
        if not clipped.is_empty:
            assigned[i]["polygon"] = clipped
            assigned[i]["area_m2"] = clipped.area
            assigned[i]["min_side_m"] = min_side_length(clipped)

        # Clip against all previously processed (larger) lots
        for j in range(i):
            if assigned[j]["polygon"].is_empty:
                continue
            overlap = assigned[i]["polygon"].intersection(assigned[j]["polygon"])
            if not overlap.is_empty and overlap.area > 1:
                trimmed = _extract_polygon(assigned[i]["polygon"].difference(assigned[j]["polygon"]))
                if not trimmed.is_empty and trimmed.area > 100:
                    assigned[i]["polygon"] = trimmed
                    assigned[i]["area_m2"] = trimmed.area
                    assigned[i]["min_side_m"] = min_side_length(trimmed)

    # ── Subtract green areas from lots ──
    # Since we cut the grid on the full macro union (including green areas),
    # we now need to subtract green areas from each lot.
    if not green_union.is_empty:
        for a in assigned:
            subtracted = a["polygon"].difference(green_union)
            if not subtracted.is_empty:
                lot_poly = _extract_polygon(subtracted)
                if not lot_poly.is_empty and lot_poly.area > 100:
                    a["polygon"] = lot_poly
                    a["area_m2"] = lot_poly.area
                    a["min_side_m"] = min_side_length(lot_poly)

    # Recalculate units after overlap removal and green subtraction
    for a in assigned:
        prod = PRODUCTS[a["product_id"]]
        if prod["efficiency"] > 0:
            units = int((a["area_m2"] / 10000) * prod["efficiency"])
            if prod["max_units"] > 0 and units > prod["max_units"]:
                units = prod["max_units"]
            a["units"] = units

    # Remove lots that became too small after green subtraction
    assigned = [a for a in assigned if a["area_m2"] > 500]

    # Apply chamfers AFTER no-overlap enforcement
    # Use smaller chamfer (2m) to avoid shrinking lots below constraints
    for a in assigned:
        prod = PRODUCTS[a["product_id"]]
        chamfered = apply_chamfer(a["polygon"], 2.0)
        if not chamfered.is_empty:
            new_side = min_side_length(chamfered)
            # Check if chamfer would violate min_side constraint
            required_side = prod["min_side_m"]
            if prod["efficiency"] == 0 and chamfered.area < 3000:
                required_side = 30  # relaxed for small comercio/equip
            # Also check units won't drop below minimum after chamfer
            units_ok = True
            if prod["efficiency"] > 0 and prod["min_units"] > 0:
                new_units = int((chamfered.area / 10000) * prod["efficiency"])
                if new_units < prod["min_units"]:
                    units_ok = False
            if new_side >= required_side and units_ok:
                a["polygon"] = chamfered
                a["area_m2"] = chamfered.area
                a["min_side_m"] = new_side
            # else: keep original (unchamfered) polygon
        # Recalculate units with current area
        if prod["efficiency"] > 0:
            units = int((a["area_m2"] / 10000) * prod["efficiency"])
            if prod["max_units"] > 0 and units > prod["max_units"]:
                units = prod["max_units"]
            a["units"] = units

    # Frontage validation: lots without street frontage get merged into
    # their nearest neighbor that HAS frontage. No lot becomes a park.
    frontage_sources = all_streets + ([vial_union] if not vial_union.is_empty else [])
    validated = []
    frontage_rejects = []
    for a in assigned:
        front = calculate_frontage(a["polygon"], frontage_sources)
        if front < 1.0:
            frontage_rejects.append(a)
        else:
            validated.append(a)

    # Merge frontage rejects into nearest validated lot
    for reject in frontage_rejects:
        best_idx = -1
        best_dist = float("inf")
        for i, v in enumerate(validated):
            d = reject["polygon"].distance(v["polygon"])
            if d < best_dist:
                best_dist = d
                best_idx = i
        if best_idx >= 0:
            target = validated[best_idx]
            combined = unary_union([target["polygon"], reject["polygon"]])
            if isinstance(combined, MultiPolygon):
                combined = max(combined.geoms, key=lambda g: g.area)
            target["polygon"] = combined
            target["area_m2"] = combined.area
            target["min_side_m"] = min_side_length(combined)
            # Recalculate units
            prod = PRODUCTS[target["product_id"]]
            if prod["efficiency"] > 0:
                units = int((combined.area / 10000) * prod["efficiency"])
                if prod["max_units"] > 0 and units > prod["max_units"]:
                    units = prod["max_units"]
                target["units"] = units
    assigned = validated

    # ── Gap elimination: absorb uncovered areas into nearest SAME-GROUP lot ──
    # Work per-group to prevent lots from absorbing area from other macrolotes.
    street_union_final = unary_union(all_streets) if all_streets else Polygon()
    for gi, group_poly in enumerate(groups):
        group_lots_idx = [i for i, a in enumerate(assigned) if a.get("_group_idx") == gi]
        if not group_lots_idx:
            continue
        group_lot_union = unary_union([assigned[i]["polygon"] for i in group_lots_idx])
        covered_parts = [group_lot_union, street_union_final]
        if not green_union.is_empty:
            covered_parts.append(green_union)
        covered = unary_union(covered_parts)
        gap_geom = group_poly.difference(covered)

        if gap_geom.is_empty:
            continue
        gap_frags = list(gap_geom.geoms) if isinstance(gap_geom, MultiPolygon) else [gap_geom]
        for frag in gap_frags:
            if frag.is_empty or frag.area < 1:
                continue
            # Find nearest same-group lot to absorb
            best_idx = None
            best_dist = float("inf")
            for i in group_lots_idx:
                d = frag.distance(assigned[i]["polygon"])
                if d < best_dist:
                    best_dist = d
                    best_idx = i
            if best_idx is not None and best_dist < 50:
                target = assigned[best_idx]
                combined = unary_union([target["polygon"], frag])
                if isinstance(combined, MultiPolygon):
                    combined = max(combined.geoms, key=lambda g: g.area)
                # Check: don't inflate beyond product max
                prod = PRODUCTS[target["product_id"]]
                if prod["efficiency"] > 0 and prod["max_units"] > 0:
                    max_prod_area = prod["max_units"] / prod["efficiency"] * 10000
                    if combined.area > max_prod_area * 1.3:
                        continue  # skip — would inflate lot too much
                target["polygon"] = combined
                target["area_m2"] = combined.area
                target["min_side_m"] = min_side_length(combined)

    # ── Lot shape regularization ──
    # After gap elimination and merges, lots can have jagged/concave edges
    # from buffer/unbuffer operations and fragment absorption. Simplify
    # each polygon to remove noise while preserving the overall shape.
    # Also remove extremely acute concave notches that create strange shapes.
    for a in assigned:
        poly = a["polygon"]
        if poly.is_empty:
            continue
        prod = PRODUCTS[a["product_id"]]

        # Step 1: Simplify to remove coordinate noise (2m tolerance)
        simplified = poly.simplify(2.0, preserve_topology=True)
        if simplified.is_empty or simplified.area < poly.area * 0.85:
            continue  # simplification too aggressive, keep original

        # Step 2: If lot has very bad concavity (convex hull area >> lot area),
        # try to use convex hull clipped to macro boundary. This removes
        # the "notch" shapes caused by gap fragment absorption.
        convex = simplified.convex_hull
        concavity_ratio = simplified.area / convex.area if convex.area > 0 else 1.0
        if concavity_ratio < 0.75:
            # Very concave — try convex hull clipped to macro + exclusion
            clipped_convex = convex.intersection(macro_union)
            if not exclusion_zone.is_empty:
                clipped_convex = clipped_convex.difference(exclusion_zone)
            if isinstance(clipped_convex, MultiPolygon):
                clipped_convex = max(clipped_convex.geoms, key=lambda g: g.area)
            if (not clipped_convex.is_empty
                    and clipped_convex.area >= simplified.area * 0.9
                    and clipped_convex.area <= poly.area * 1.1  # Don't expand beyond original
                    and not is_triangular(clipped_convex)):
                simplified = clipped_convex

        # Step 3: Validate constraints still hold after regularization
        new_side = min_side_length(simplified)
        units_ok = True
        if prod["efficiency"] > 0 and prod["min_units"] > 0:
            new_units = int((simplified.area / 10000) * prod["efficiency"])
            if new_units < prod["min_units"]:
                units_ok = False
        required_side = prod["min_side_m"]
        if prod["efficiency"] == 0 and simplified.area < 3000:
            required_side = 30
        # Apply regularization only if constraints still pass
        if new_side >= required_side * 0.7 and units_ok:
            a["polygon"] = simplified
            a["area_m2"] = simplified.area
            a["min_side_m"] = new_side

    # ── Post-regularization shape validation ──
    # After all post-processing (chamfer, gap elimination, regularization),
    # some lots may have become triangular, strip-shaped, or have acute angles.
    # These violations happened AFTER product assignment due to geometry
    # operations. Fix by merging violating lots into their nearest neighbor.
    #
    # IMPORTANT: Use STRICTER thresholds than normal because:
    # 1. UTM→WGS84 projection distorts fill ratios by ~3-5%
    # 2. Display clipping against green areas can change shapes
    # A lot that barely passes in UTM may fail in WGS84 on the map.
    def _is_shape_violation(poly):
        """Check for truly degenerate shapes in post-validation.

        IMPORTANT: Geometry is in WGS84 (lat/lon) where aspect ratios and
        angles are distorted at latitude -33°. Only flag extreme cases that
        are clearly wrong regardless of projection.
        """
        if poly.is_empty:
            return False
        if not isinstance(poly, Polygon):
            if hasattr(poly, 'geoms'):
                polys = [g for g in poly.geoms if isinstance(g, Polygon) and g.area > 10]
                if polys:
                    poly = max(polys, key=lambda g: g.area)
                else:
                    return True
            else:
                return True
        # Only flag TRUE triangles (simplify to 3 vertices at very coarse tolerance)
        simplified = poly.simplify(15.0, preserve_topology=True)
        if hasattr(simplified, 'exterior'):
            coords = list(simplified.exterior.coords)
            if len(coords) <= 4:
                return True
        # Very low fill ratio — unmistakable triangle/wedge even in WGS84
        try:
            mrr = poly.minimum_rotated_rectangle
            if mrr.area > 0:
                fill = poly.area / mrr.area
                if fill < 0.45:
                    return True
        except Exception:
            pass
        return False

    # Count product area for protection decision
    _product_area_map = {}
    _product_target_map = {}
    for alloc in allocations:
        pid = alloc["product_id"]
        _product_target_map[pid] = sum(p.area for p in macrolote_polys) * alloc["percentage"] / 100.0
        _product_area_map[pid] = sum(a["area_m2"] for a in assigned if a["product_id"] == pid)

    for _round in range(len(assigned) * 2):
        violation_idx = None
        for i, a in enumerate(assigned):
            poly = a["polygon"]
            if poly.is_empty:
                continue
            if _is_shape_violation(poly):
                # PROTECT under-allocated RESIDENTIAL products: if absorbing
                # this lot would leave the product with 0 lots or < 30% of
                # target, SKIP. A slightly irregular lot is better than
                # losing the product.
                # EXCEPTION: special products (comercio/equipamiento) are NOT
                # protected — a strip-shaped commercial lot is worse than
                # no commercial lot (the area gets absorbed into residential).
                pid = a["product_id"]
                prod = PRODUCTS[pid]
                if prod["efficiency"] > 0:  # residential only
                    same_product_lots = [j for j, b in enumerate(assigned)
                                         if b["product_id"] == pid and not b["polygon"].is_empty and j != i]
                    target = _product_target_map.get(pid, 0)
                    remaining_area = sum(assigned[j]["area_m2"] for j in same_product_lots)
                    if target > 0 and remaining_area / target < 0.50:
                        continue  # protect this lot — product would be starved
                violation_idx = i
                break
        if violation_idx is None:
            break

        # Merge violating lot into nearest non-violating neighbor
        # PREFER neighbors where the merge won't exceed product constraints.
        v = assigned[violation_idx]
        best_ni = -1
        best_dist = float("inf")
        for ni, a2 in enumerate(assigned):
            if ni == violation_idx or a2["polygon"].is_empty:
                continue
            # Don't merge into another violating lot
            if (is_triangular(a2["polygon"]) or aspect_ratio(a2["polygon"]) > 3.5
                    or has_acute_angle(a2["polygon"], 35.0)):
                continue
            d = v["polygon"].distance(a2["polygon"])
            if d < best_dist:
                best_dist = d
                best_ni = ni
        if best_ni >= 0 and best_dist <= 80.0:
            target_a = assigned[best_ni]
            combined = unary_union([target_a["polygon"], v["polygon"]])
            if isinstance(combined, MultiPolygon):
                combined = max(combined.geoms, key=lambda g: g.area)
            # Check if merged result would ALSO violate.
            # If so, try using convex hull clipped to macro boundary
            # to regularize the merged shape.
            if _is_shape_violation(combined):
                hull = combined.convex_hull.intersection(macro_union)
                if not exclusion_zone.is_empty:
                    hull = hull.difference(exclusion_zone)
                if isinstance(hull, MultiPolygon):
                    hull = max(hull.geoms, key=lambda g: g.area)
                if (not hull.is_empty and hull.area >= combined.area * 0.85
                        and not _is_shape_violation(hull)):
                    combined = hull
            target_a["polygon"] = combined
            target_a["area_m2"] = combined.area
            target_a["min_side_m"] = min_side_length(combined)
            prod = PRODUCTS[target_a["product_id"]]
            if prod["efficiency"] > 0:
                units = int((combined.area / 10000) * prod["efficiency"])
                if prod["max_units"] > 0 and units > prod["max_units"]:
                    units = prod["max_units"]
                target_a["units"] = units
            # Mark violating lot as absorbed
            v["polygon"] = Polygon()
            v["area_m2"] = 0
        else:
            break  # can't fix — stop

    # Remove absorbed lots
    # Clean up: ensure all polygons are valid Polygon objects
    cleaned = []
    for a in assigned:
        poly = a["polygon"]
        if poly is None or poly.is_empty:
            continue
        if not isinstance(poly, Polygon):
            if hasattr(poly, 'geoms'):
                polys = [g for g in poly.geoms if isinstance(g, Polygon) and g.area > 50]
                if polys:
                    poly = max(polys, key=lambda g: g.area)
                    a["polygon"] = poly
                    a["area_m2"] = poly.area
                else:
                    continue
            else:
                continue
        if a["area_m2"] > 50:
            cleaned.append(a)
    assigned = cleaned

    # No internal parks — all space is assigned to products
    parks = []

    return _build_response(assigned, all_streets, parks, green_union, macro_area, macrolote_polys, vial_union, max_viviendas)


def _build_response(assigned, all_streets, parks, green_union, macro_area, macrolote_polys, vial_union, max_viviendas=None):
    """Build the final API response from subdivision results."""
    # Final safety: remove any invalid polygons
    assigned = [a for a in assigned
                if a.get("polygon") is not None
                and isinstance(a["polygon"], Polygon)
                and not a["polygon"].is_empty
                and a.get("area_m2", 0) > 50]

    # Calculate metrics
    total_street_area = sum(s.area for s in all_streets)
    total_park_area = sum(p.area for p in parks)
    total_lot_area = sum(a["area_m2"] for a in assigned)
    total_units = sum(a["units"] for a in assigned)

    # Apply district-level max housing cap: scale down units proportionally
    if max_viviendas is not None and max_viviendas > 0 and total_units > max_viviendas:
        scale = max_viviendas / total_units
        for a in assigned:
            a["units"] = max(1, round(a["units"] * scale)) if a["units"] > 0 else 0
        total_units = sum(a["units"] for a in assigned)
        while total_units > max_viviendas:
            max_lot = max((a for a in assigned if a["units"] > 1), key=lambda a: a["units"], default=None)
            if max_lot is None:
                break
            max_lot["units"] -= 1
            total_units -= 1

    # Infrastructure costs (UF)
    STREET_COST_UF_M2 = 4.5
    GREEN_COST_UF_M2 = 1.5
    LAND_COST_UF_M2 = 0.19
    street_cost_uf = total_street_area * STREET_COST_UF_M2
    green_cost_uf = total_park_area * GREEN_COST_UF_M2
    land_cost_uf = macro_area * LAND_COST_UF_M2

    units_by_product = {}
    value_by_product = {}
    total_value_uf = 0
    for a in assigned:
        pid = a["product_id"]
        units_by_product[pid] = units_by_product.get(pid, 0) + a["units"]
        lot_value = calc_lot_value(pid, a["area_m2"], a["units"])
        value_by_product[pid] = value_by_product.get(pid, 0) + lot_value
        total_value_uf += lot_value

    # Convert to WGS84
    from pyproj import Transformer
    transformer = Transformer.from_crs("EPSG:32719", "EPSG:4326", always_xy=True)

    def to_wgs84(geom):
        from shapely.ops import transform
        return transform(transformer.transform, geom)

    # Display polygons: clip against green areas only (streets render on top)
    for a in assigned:
        if not green_union.is_empty:
            display_poly = a["polygon"].difference(green_union)
            if not display_poly.is_empty:
                if isinstance(display_poly, MultiPolygon):
                    display_poly = max(display_poly.geoms, key=lambda g: g.area)
                a["display_polygon"] = display_poly
            else:
                a["display_polygon"] = a["polygon"]
        else:
            a["display_polygon"] = a["polygon"]

    response = {
        "streets": [
            {
                "geometry": polygon_to_geojson(to_wgs84(s)),
                "area_m2": round(s.area, 1),
            }
            for s in all_streets
        ],
        "lots": [
            {
                "geometry": polygon_to_geojson(to_wgs84(a["display_polygon"])),
                "product": a["product_id"],
                "area_m2": round(a["area_m2"], 1),
                "units": a["units"],
                "frontage_m": round(calculate_frontage(a["polygon"], all_streets + ([vial_union] if not vial_union.is_empty else [])), 1),
                "min_side_m": round(a.get("min_side_m", 0), 1),
                "aspect_ratio": round(aspect_ratio(a["polygon"]), 2),
                "is_triangular_utm": is_triangular(a["polygon"]),
                "fill_ratio_utm": round(
                    a["polygon"].area / a["polygon"].minimum_rotated_rectangle.area
                    if a["polygon"].minimum_rotated_rectangle.area > 0 else 0, 3),
            }
            for a in assigned
        ],
        "parks": [
            {
                "geometry": polygon_to_geojson(to_wgs84(p)),
                "area_m2": round(p.area, 1),
            }
            for p in parks
        ],
        "metrics": {
            "total_lots": len(assigned),
            "total_units": total_units,
            "units_by_product": units_by_product,
            "street_area_m2": round(total_street_area, 1),
            "park_area_m2": round(total_park_area, 1),
            "efficiency_pct": round(total_lot_area / macro_area * 100, 1) if macro_area > 0 else 0,
            "density_per_ha": round(total_units / (macro_area / 10000), 1) if macro_area > 0 else 0,
            "total_value_uf": round(total_value_uf, 0),
            "value_by_product": {k: round(v, 0) for k, v in value_by_product.items()},
            "street_cost_uf": round(street_cost_uf, 0),
            "green_cost_uf": round(green_cost_uf, 0),
            "land_cost_uf": round(land_cost_uf, 0),
            "total_cost_uf": round(street_cost_uf + green_cost_uf + land_cost_uf, 0),
            "net_value_uf": round(total_value_uf - street_cost_uf - green_cost_uf - land_cost_uf, 0),
            "macro_area_m2": round(macro_area, 1),
        },
    }

    return response
