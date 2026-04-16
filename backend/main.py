from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from models import get_db, init_db
from scraper import fetch_price
from checker import check_item, check_all_items
from scheduler import start_scheduler, stop_scheduler, reschedule


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    conn = get_db()
    settings = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings").fetchall()}
    conn.close()
    start_scheduler(hours=int(settings.get("check_interval_hours", "24")))
    yield
    stop_scheduler()


app = FastAPI(title="Price Tracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ────────────────────────────────────────────────────────────

class AddItemRequest(BaseModel):
    url: str
    name: Optional[str] = None


class UpdateSettingsRequest(BaseModel):
    check_interval_hours: Optional[int] = None
    alert_on_increase: Optional[bool] = None
    alert_on_decrease: Optional[bool] = None
    price_change_threshold: Optional[float] = None


# ── Items ──────────────────────────────────────────────────────────────────────

@app.get("/items")
def list_items():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM items WHERE is_active=1 ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/items", status_code=201)
def add_item(req: AddItemRequest):
    result = fetch_price(req.url)
    now = datetime.now(timezone.utc).isoformat()
    name = req.name or result.get("name") or req.url[:60]
    price = result.get("price")

    conn = get_db()
    cur = conn.execute(
        """INSERT INTO items (url, name, site, current_price, last_price, last_checked, created_at)
           VALUES (?,?,?,?,?,?,?)""",
        (req.url, name, result.get("site"), price, price, now if price else None, now),
    )
    item_id = cur.lastrowid
    if price:
        conn.execute(
            "INSERT INTO price_history (item_id, price, checked_at) VALUES (?,?,?)",
            (item_id, price, now),
        )
    conn.commit()
    item = dict(conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())
    conn.close()
    return item


@app.delete("/items/{item_id}")
def remove_item(item_id: int):
    conn = get_db()
    conn.execute("UPDATE items SET is_active=0 WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return {"success": True}


@app.post("/items/{item_id}/check")
def force_check(item_id: int):
    conn = get_db()
    exists = conn.execute("SELECT id FROM items WHERE id=? AND is_active=1", (item_id,)).fetchone()
    conn.close()
    if not exists:
        raise HTTPException(status_code=404, detail="Item not found")
    return check_item(item_id)


@app.get("/items/{item_id}/history")
def item_history(item_id: int):
    conn = get_db()
    rows = conn.execute(
        "SELECT price, checked_at FROM price_history WHERE item_id=? ORDER BY checked_at DESC LIMIT 60",
        (item_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Settings ───────────────────────────────────────────────────────────────────

def _get_all_settings() -> dict:
    conn = get_db()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


@app.get("/settings")
def get_settings():
    return _get_all_settings()


@app.put("/settings")
def update_settings(req: UpdateSettingsRequest):
    updates: dict[str, str] = {}
    if req.check_interval_hours is not None:
        updates["check_interval_hours"] = str(req.check_interval_hours)
    if req.alert_on_increase is not None:
        updates["alert_on_increase"] = "1" if req.alert_on_increase else "0"
    if req.alert_on_decrease is not None:
        updates["alert_on_decrease"] = "1" if req.alert_on_decrease else "0"
    if req.price_change_threshold is not None:
        updates["price_change_threshold"] = str(req.price_change_threshold)

    conn = get_db()
    for k, v in updates.items():
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)", (k, v))
    conn.commit()
    conn.close()

    if req.check_interval_hours is not None:
        reschedule(req.check_interval_hours)

    return _get_all_settings()


# ── Bulk check ─────────────────────────────────────────────────────────────────

@app.post("/check-all")
def trigger_check_all():
    return check_all_items()
