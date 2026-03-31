"""FastAPI backend for BatucoTerra cabida generation."""
import logging
import traceback
import gc

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from models import SubdivisionRequest, SubdivisionResponse
from subdivide import run_subdivision

# ── Logging ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("batucoterra")

# ── App ────────────────────────────────────────────────────────
app = FastAPI(title="BatucoTerra Cabida API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handler ──────────────────────────────────
# Catches ANY unhandled exception so the server stays alive
@app.middleware("http")
async def catch_all_errors(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        logger.error(f"Unhandled error on {request.url.path}: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal server error: {str(e)}"},
        )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/subdivide")
def subdivide(req: SubdivisionRequest):
    logger.info(f"Subdivision request: {len(req.macrolote_fids)} macrolotes, "
                f"{len(req.product_allocations)} products")
    try:
        allocations = [
            {
                "product_id": a.product_id,
                "percentage": a.percentage,
                "lot_size_m2": a.lot_size_m2,
            }
            for a in req.product_allocations
        ]
        result = run_subdivision(req.macrolote_fids, allocations, max_viviendas=req.max_viviendas)
        logger.info(f"Subdivision complete: {result.get('metrics', {}).get('total_lots', '?')} lots")

        # Free memory after heavy computation
        gc.collect()

        return result
    except ValueError as e:
        logger.warning(f"Validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Subdivision failed: {e}")
        logger.error(traceback.format_exc())
        # Force garbage collection on error too
        gc.collect()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
