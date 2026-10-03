"""Anomaly detection and short-term forecast for a weekly revenue series.

Method (kept simple and explainable on purpose):
  * Baseline: centered rolling median of the series.
  * Anomalies: residual vs baseline, scored with a robust z-score (median absolute deviation).
    Weeks with |score| >= threshold are flagged as spike or drop.
  * Forecast: Holt's exponential smoothing with additive trend, fitted on the series with
    anomalous weeks replaced by their baseline, so a one-off spike does not distort the trend.
    The interval is +/- 1.96 residual standard deviations.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

MIN_POINTS = 12
THRESHOLD = 3.5


class InsightError(ValueError):
    pass


def analyze(series: list[dict], horizon: int = 4, threshold: float = THRESHOLD) -> dict:
    if len(series) < MIN_POINTS:
        raise InsightError(f"Need at least {MIN_POINTS} weekly points, got {len(series)}")
    if not 1 <= horizon <= 12:
        raise InsightError("horizon must be between 1 and 12")

    df = pd.DataFrame(series)
    df["weekStart"] = pd.to_datetime(df["weekStart"])
    y = df["revenue"].astype(float).to_numpy()

    baseline = pd.Series(y).rolling(window=7, center=True, min_periods=3).median().to_numpy()
    resid = y - baseline
    mad = np.median(np.abs(resid - np.median(resid)))
    scale = 1.4826 * mad if mad > 0 else (np.std(resid) or 1.0)
    scores = resid / scale

    anomalies = []
    for i, s in enumerate(scores):
        if abs(s) >= threshold:
            anomalies.append({
                "weekStart": df["weekStart"].iloc[i].date().isoformat(),
                "revenue": round(float(y[i]), 2),
                "expected": round(float(baseline[i]), 2),
                "score": round(float(s), 2),
                "direction": "spike" if s > 0 else "drop",
            })

    cleaned = y.copy()
    flagged = np.abs(scores) >= threshold
    cleaned[flagged] = baseline[flagged]
    model = ExponentialSmoothing(cleaned, trend="add", seasonal=None, initialization_method="estimated").fit()
    fitted_resid = cleaned - model.fittedvalues
    sigma = float(np.std(fitted_resid, ddof=1))
    pred = model.forecast(horizon)
    last = df["weekStart"].iloc[-1].date()
    forecast = []
    for k, value in enumerate(pred, start=1):
        v = max(float(value), 0.0)
        forecast.append({
            "weekStart": (last + timedelta(days=7 * k)).isoformat(),
            "revenue": round(v, 2),
            "lower": round(max(v - 1.96 * sigma, 0.0), 2),
            "upper": round(v + 1.96 * sigma, 2),
        })

    return {"anomalies": anomalies, "forecast": forecast, "summary": _summary(anomalies, forecast, y)}


def _summary(anomalies: list[dict], forecast: list[dict], y: np.ndarray) -> str:
    recent = float(np.mean(y[-4:]))
    nxt = float(np.mean([f["revenue"] for f in forecast]))
    change = (nxt - recent) / recent * 100 if recent else 0.0
    direction = "up" if change >= 0 else "down"
    text = f"Forecast for the next {len(forecast)} weeks averages {nxt:,.0f} per week, {abs(change):.0f}% {direction} vs the last 4 weeks."
    if anomalies:
        worst = max(anomalies, key=lambda a: abs(a["score"]))
        text += f" {len(anomalies)} unusual week(s) found; the largest is a {worst['direction']} in the week of {worst['weekStart']}."
    else:
        text += " No unusual weeks found."
    return text
