from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

_scheduler = BackgroundScheduler()


def _run():
    from checker import check_all_items
    print("[scheduler] Running scheduled price check…")
    results = check_all_items()
    print(f"[scheduler] Checked {len(results)} item(s)")


def start_scheduler(hours: int = 24):
    _scheduler.add_job(_run, trigger=IntervalTrigger(hours=hours), id="price_check", replace_existing=True)
    _scheduler.start()
    print(f"[scheduler] Started — checking every {hours}h")


def stop_scheduler():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)


def reschedule(hours: int):
    _scheduler.reschedule_job("price_check", trigger=IntervalTrigger(hours=hours))
    print(f"[scheduler] Rescheduled to every {hours}h")
