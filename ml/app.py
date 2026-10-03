from flask import Flask, jsonify, request

from insights import InsightError, analyze

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.post("/analyze")
def analyze_route():
    payload = request.get_json(silent=True) or {}
    series = payload.get("series")
    if not isinstance(series, list):
        return jsonify(error="'series' must be a list of {weekStart, revenue}"), 400
    try:
        return jsonify(analyze(series, int(payload.get("horizon", 4))))
    except (InsightError, KeyError, TypeError) as e:
        return jsonify(error=str(e)), 422


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
