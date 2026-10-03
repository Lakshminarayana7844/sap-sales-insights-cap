"""Generate reproducible seed data for the CAP service (db/data/*.csv).

Twelve months of sales orders with a mild upward trend, weekly seasonality and
two deliberate anomalies (a bulk order spike and a system-outage week) so the
anomaly detection has something real to find.
"""
import csv
import os
import random
from datetime import date, timedelta

MATERIALS = [
    ("M-100", "Hydraulic Pump HP-10", "Hydraulics", 120.00),
    ("M-200", "Control Unit CU-200", "Electronics", 480.00),
    ("M-300", "Sensor Kit SK-30", "Electronics", 79.00),
    ("M-400", "Drive Motor DM-400", "Drives", 1500.00),
    ("M-500", "Gasket Set GS-5", "Spare Parts", 12.50),
]
REGIONS = ["DE", "FR", "IN", "US", "NL"]
START = date(2025, 10, 1)
END = date(2026, 9, 30)
SPIKE_WEEK = date(2026, 3, 16)    # bulk order from one customer
OUTAGE_WEEK = date(2026, 6, 15)   # booking system outage, almost no orders


def generate(out_dir: str, seed: int = 7) -> None:
    rnd = random.Random(seed)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "sales-Materials.csv"), "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["ID", "name", "category", "unitPrice"])
        w.writerows(MATERIALS)
    prices = {m[0]: m[3] for m in MATERIALS}
    rows = []
    oid = 1
    day = START
    while day <= END:
        days_in = (day - START).days
        weekday = day.weekday()
        base = 4.0 * (1 + days_in / 365 * 0.35) * (0.25 if weekday >= 5 else 1.0)
        in_outage = OUTAGE_WEEK <= day < OUTAGE_WEEK + timedelta(days=7)
        n = (1 if weekday == 0 else 0) if in_outage else max(0, int(rnd.gauss(base, 1.5)))
        for _ in range(n):
            mat = rnd.choices([m[0] for m in MATERIALS], weights=[22, 14, 30, 6, 28])[0]
            qty = rnd.randint(1, 12)
            if SPIKE_WEEK <= day < SPIKE_WEEK + timedelta(days=7) and rnd.random() < 0.25:
                qty *= 14
            rows.append([oid, day.isoformat(), rnd.choice(REGIONS), mat, qty, round(prices[mat] * qty, 2)])
            oid += 1
        day += timedelta(days=1)
    with open(os.path.join(out_dir, "sales-Orders.csv"), "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["ID", "orderDate", "region", "material_ID", "quantity", "netPrice"])
        w.writerows(rows)
    print(f"{len(rows)} orders written to {out_dir}")


if __name__ == "__main__":
    generate(os.path.join(os.path.dirname(__file__), "data"))
