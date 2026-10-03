import os
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import app  # noqa: E402
from insights import InsightError, analyze  # noqa: E402


def make_series(n=40, spike_at=None, drop_at=None):
    start = date(2026, 1, 5)
    out = []
    for i in range(n):
        v = 1000 + 10 * i + (30 if i % 2 else -30)
        if i == spike_at:
            v *= 4
        if i == drop_at:
            v *= 0.05
        out.append({"weekStart": (start + timedelta(days=7 * i)).isoformat(), "revenue": float(v)})
    return out


def test_flags_spike_and_drop():
    res = analyze(make_series(spike_at=15, drop_at=28))
    kinds = {a["direction"] for a in res["anomalies"]}
    assert kinds == {"spike", "drop"}
    assert len(res["anomalies"]) == 2


def test_clean_series_has_no_anomalies():
    assert analyze(make_series())["anomalies"] == []


def test_forecast_follows_trend_and_is_not_distorted_by_spike():
    clean = analyze(make_series())["forecast"]
    spiky = analyze(make_series(spike_at=15))["forecast"]
    assert len(clean) == 4
    assert clean[0]["lower"] <= clean[0]["revenue"] <= clean[0]["upper"]
    assert clean[0]["revenue"] > 1300
    assert abs(spiky[0]["revenue"] - clean[0]["revenue"]) < 80


def test_too_short_series_rejected():
    with pytest.raises(InsightError):
        analyze(make_series(5))


def test_http_endpoint():
    c = app.test_client()
    ok = c.post("/analyze", json={"series": make_series(), "horizon": 2})
    assert ok.status_code == 200 and len(ok.get_json()["forecast"]) == 2
    assert c.post("/analyze", json={"series": make_series(3)}).status_code == 422
    assert c.post("/analyze", json={}).status_code == 400
