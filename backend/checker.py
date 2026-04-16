"""Core price check logic shared by API endpoints and the scheduler."""
from datetime import datetime, timezone

from models import get_db
from scraper import fetch_price
from email_service import send_price_alert


def _get_settings() -> dict:
    conn = get_db()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}


def check_item(item_id: int) -> dict:
    conn = get_db()
    row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    if not row:
        return {"success": False, "error": "Item not found"}

    item = dict(row)
    result = fetch_price(item["url"])
    new_price = result.get("price")

    if not new_price:
        return {"success": False, "price": None, "error": result.get("error", "Could not extract price")}

    now = datetime.now(timezone.utc).isoformat()
    old_price = item["current_price"]

    conn = get_db()
    conn.execute(
        "UPDATE items SET current_price=?, last_price=?, last_checked=? WHERE id=?",
        (new_price, old_price, now, item_id),
    )
    conn.execute(
        "INSERT INTO price_history (item_id, price, checked_at) VALUES (?,?,?)",
        (item_id, new_price, now),
    )
    conn.commit()
    conn.close()

    if old_price and old_price != new_price:
        settings = _get_settings()
        threshold = float(settings.get("price_change_threshold", "0"))
        change_pct = abs(new_price - old_price) / old_price * 100

        if change_pct >= threshold:
            if new_price < old_price and settings.get("alert_on_decrease") == "1":
                send_price_alert(item["name"], item["url"], old_price, new_price, "decrease")
            elif new_price > old_price and settings.get("alert_on_increase") == "1":
                send_price_alert(item["name"], item["url"], old_price, new_price, "increase")

    return {"success": True, "price": new_price, "old_price": old_price}


def check_all_items() -> list[dict]:
    conn = get_db()
    items = conn.execute("SELECT id FROM items WHERE is_active=1").fetchall()
    conn.close()

    results = []
    for row in items:
        r = check_item(row["id"])
        results.append({"id": row["id"], **r})
    return results
