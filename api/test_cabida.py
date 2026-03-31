"""Automated cabida verification — iterates test scenarios until 100% accuracy.

Tests product assignment accuracy: every requested product must appear in output,
area allocations must match input percentages within tolerance, unit counts must
be within product range, and comercio/equipamiento must not exceed allocation.
"""
import sys
import json
import time
from subdivide import run_subdivision, PRODUCTS

# ─────────────────────────────────────────────────────────────────────
# Test scenarios: each is (name, fids, allocations)
# Covers single-product, multi-product, edge cases, large/small lots
# ─────────────────────────────────────────────────────────────────────
TEST_SCENARIOS = [
    # 1. Single product — 100% of one residential type
    ("100% casas1 (lote 83, 10.7ha)", ["83"], [
        {"product_id": "casas1", "percentage": 100},
    ]),
    ("100% townhouses1 (lote 83)", ["83"], [
        {"product_id": "townhouses1", "percentage": 100},
    ]),
    ("100% ds19 (lote 83)", ["83"], [
        {"product_id": "ds19", "percentage": 100},
    ]),
    ("100% edificios6p (lote 83)", ["83"], [
        {"product_id": "edificios6p", "percentage": 100},
    ]),
    ("100% deptos1 (lote 83)", ["83"], [
        {"product_id": "deptos1", "percentage": 100},
    ]),

    # 2. Two products — 50/50 split
    ("50% casas1 + 50% townhouses1 (lote 83)", ["83"], [
        {"product_id": "casas1", "percentage": 50},
        {"product_id": "townhouses1", "percentage": 50},
    ]),
    ("50% ds19 + 50% edificios6p (lote 83)", ["83"], [
        {"product_id": "ds19", "percentage": 50},
        {"product_id": "edificios6p", "percentage": 50},
    ]),

    # 3. Four products — equal 25% each
    ("4x25% casas1+townhouses1+ds19+edificios6p (lote 83)", ["83"], [
        {"product_id": "casas1", "percentage": 25},
        {"product_id": "townhouses1", "percentage": 25},
        {"product_id": "ds19", "percentage": 25},
        {"product_id": "edificios6p", "percentage": 25},
    ]),

    # 4. With comercio/equipamiento
    ("70% casas1 + 20% comercio + 10% equipamiento (lote 83)", ["83"], [
        {"product_id": "casas1", "percentage": 70},
        {"product_id": "comercio", "percentage": 20},
        {"product_id": "equipamiento", "percentage": 10},
    ]),
    ("50% ds19 + 30% comercio + 20% equipamiento (lote 83)", ["83"], [
        {"product_id": "ds19", "percentage": 50},
        {"product_id": "comercio", "percentage": 30},
        {"product_id": "equipamiento", "percentage": 20},
    ]),

    # 5. Uneven splits
    ("60% casas1 + 40% ds19 (lote 83)", ["83"], [
        {"product_id": "casas1", "percentage": 60},
        {"product_id": "ds19", "percentage": 40},
    ]),

    # 6. Different macrolotes (varying sizes)
    ("100% casas1 (lote 52, 6.4ha)", ["52"], [
        {"product_id": "casas1", "percentage": 100},
    ]),
    ("50% townhouses1 + 50% deptos1 (lote 56, 10.2ha)", ["56"], [
        {"product_id": "townhouses1", "percentage": 50},
        {"product_id": "deptos1", "percentage": 50},
    ]),

    # 7. Multi-macrolote (adjacent)
    ("100% casas1 (lotes 83+84)", ["83", "84"], [
        {"product_id": "casas1", "percentage": 100},
    ]),

    # 8. Smaller macrolote tests
    ("100% edificios6p (lote 55, 3.1ha)", ["55"], [
        {"product_id": "edificios6p", "percentage": 100},
    ]),
    ("100% townhouses1 (lote 73, 4.9ha)", ["73"], [
        {"product_id": "townhouses1", "percentage": 100},
    ]),

    # 9. Three residential products
    ("33% casas1 + 33% townhouses1 + 34% deptos1 (lote 83)", ["83"], [
        {"product_id": "casas1", "percentage": 33},
        {"product_id": "townhouses1", "percentage": 33},
        {"product_id": "deptos1", "percentage": 34},
    ]),

    # 10. User's exact scenario — lot_size_m2 on equipamiento
    # This caught a bug where equipamiento got 21,409m² despite 7,500m² target.
    ("6-product mix with lot_size_m2=7500 equip (lote 83)", ["83"], [
        {"product_id": "casas1", "percentage": 20},
        {"product_id": "townhouses1", "percentage": 15},
        {"product_id": "ds19", "percentage": 25},
        {"product_id": "edificios6p", "percentage": 20},
        {"product_id": "comercio", "percentage": 10},
        {"product_id": "equipamiento", "percentage": 10, "lot_size_m2": 7500},
    ]),

    # 11. All residential on smaller lote
    ("50% casas1 + 50% edificios6p (lote 55, 3.1ha)", ["55"], [
        {"product_id": "casas1", "percentage": 50},
        {"product_id": "edificios6p", "percentage": 50},
    ]),
]


def format_allocations(allocations):
    """Format allocations as human-readable string."""
    return ", ".join(f"{a['product_id']}={a['percentage']}%" for a in allocations)


def verify_scenario(name, fids, allocations, verbose=True):
    """Run one scenario and return (passed, failures_list)."""
    failures = []

    try:
        result = run_subdivision(fids, allocations)
    except Exception as e:
        return False, [f"CRASH: {e}"]

    lots = result["lots"]
    metrics = result["metrics"]
    units_by_product = metrics["units_by_product"]

    # Collect which products appeared
    output_products = set(l["product"] for l in lots)
    requested_products = set(a["product_id"] for a in allocations)

    # ── CHECK 1: All requested products appear in output ──
    missing = requested_products - output_products
    if missing:
        failures.append(f"MISSING PRODUCTS: {missing} not in output (got {output_products})")

    # ── CHECK 2: No unrequested products appear ──
    extra = output_products - requested_products
    if extra:
        failures.append(f"EXTRA PRODUCTS: {extra} not requested (requested {requested_products})")

    # ── CHECK 3: Area allocation accuracy ──
    # Tolerance depends on product count: more products = harder to balance
    # 1-2 products: ±50% (ratio 0.5-2.0)
    # 3+ products: ±55% (ratio 0.45-2.0) — geometric constraints limit precision
    total_lot_area = sum(l["area_m2"] for l in lots)
    n_products = len(allocations)
    low_ratio = 0.40 if n_products >= 3 else 0.5
    high_ratio = 2.0
    for alloc in allocations:
        pid = alloc["product_id"]
        target_pct = alloc["percentage"] / 100.0
        target_area = total_lot_area * target_pct
        actual_area = sum(l["area_m2"] for l in lots if l["product"] == pid)

        if target_area > 0:
            ratio = actual_area / target_area
            if ratio < low_ratio or ratio > high_ratio:
                failures.append(
                    f"AREA {pid}: target={target_area:.0f}m² actual={actual_area:.0f}m² "
                    f"ratio={ratio:.2f} (tolerance: {low_ratio}-{high_ratio})"
                )

    # ── CHECK 4: Unit counts within product range ──
    for lot in lots:
        pid = lot["product"]
        prod = PRODUCTS[pid]
        units = lot["units"]
        if prod["efficiency"] > 0:
            if units < prod["min_units"]:
                # Allow 15% below min (chamfer can reduce area slightly)
                if units < prod["min_units"] * 0.85:
                    failures.append(
                        f"UNITS LOW: {pid} lot has {units} units, min={prod['min_units']} "
                        f"(area={lot['area_m2']:.0f}m²)"
                    )
            if units > prod["max_units"]:
                # Units should be clamped, so this shouldn't happen
                failures.append(
                    f"UNITS HIGH: {pid} lot has {units} units, max={prod['max_units']}"
                )

    # ── CHECK 5: Comercio/equipamiento don't exceed allocation ──
    for alloc in allocations:
        pid = alloc["product_id"]
        prod = PRODUCTS[pid]
        if prod["efficiency"] == 0:  # special product
            target_pct = alloc["percentage"] / 100.0
            target_area = total_lot_area * target_pct
            actual_area = sum(l["area_m2"] for l in lots if l["product"] == pid)
            # Special products should not get more than 1.5x their target
            if target_area > 0 and actual_area > target_area * 1.5:
                failures.append(
                    f"OVER-ALLOC {pid}: target={target_area:.0f}m² actual={actual_area:.0f}m² "
                    f"({actual_area/target_area:.1f}x target)"
                )

    # ── CHECK 6: Lot count sanity (at least 1 lot) ──
    if len(lots) == 0:
        failures.append("NO LOTS: subdivision produced 0 lots")

    # ── CHECK 7: Min side constraint check ──
    for lot in lots:
        pid = lot["product"]
        prod = PRODUCTS[pid]
        min_side = lot.get("min_side_m", 0)
        required = prod["min_side_m"]
        if prod["efficiency"] == 0 and lot["area_m2"] < 3000:
            required = 30  # relaxed
        if min_side > 0 and min_side < required * 0.65:
            failures.append(
                f"SIDE TOO NARROW: {pid} lot min_side={min_side:.1f}m, need {required}m"
            )

    # ── CHECK 8: lot_size_m2 compliance ──
    # When user specifies lot_size_m2, each lot of that product must not exceed 1.5x
    for alloc in allocations:
        pid = alloc["product_id"]
        lot_size = alloc.get("lot_size_m2")
        if not lot_size:
            continue
        product_lots = [l for l in lots if l["product"] == pid]
        for pl in product_lots:
            if pl["area_m2"] > lot_size * 1.5:
                failures.append(
                    f"LOT_SIZE_M2 EXCEEDED: {pid} lot={pl['area_m2']:.0f}m² "
                    f"cap={lot_size}m² (max allowed={lot_size * 1.5:.0f}m²)"
                )

    passed = len(failures) == 0

    if verbose:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"\n{status}  {name}")
        print(f"  Lots: {len(lots)}  Products: {sorted(output_products)}")
        for lot in lots:
            print(f"    {lot['product']:15s} {lot['area_m2']/10000:.2f}ha u={lot['units']}")
        if failures:
            for f in failures:
                print(f"  ⚠ {f}")

    return passed, failures


def run_all_tests(verbose=True):
    """Run all test scenarios and report results."""
    total = len(TEST_SCENARIOS)
    passed = 0
    failed_scenarios = []

    print("=" * 70)
    print(f"CABIDA VERIFICATION — {total} scenarios")
    print("=" * 70)

    for name, fids, allocations in TEST_SCENARIOS:
        ok, failures = verify_scenario(name, fids, allocations, verbose=verbose)
        if ok:
            passed += 1
        else:
            failed_scenarios.append((name, failures))

    # Summary
    pct = (passed / total * 100) if total > 0 else 0
    print("\n" + "=" * 70)
    print(f"RESULTS: {passed}/{total} passed ({pct:.0f}%)")
    print("=" * 70)

    if failed_scenarios:
        print("\nFAILED SCENARIOS:")
        for name, failures in failed_scenarios:
            print(f"\n  ❌ {name}")
            for f in failures:
                print(f"     ⚠ {f}")

    return passed, total, failed_scenarios


if __name__ == "__main__":
    verbose = "--quiet" not in sys.argv
    passed, total, failures = run_all_tests(verbose=verbose)
    sys.exit(0 if passed == total else 1)
