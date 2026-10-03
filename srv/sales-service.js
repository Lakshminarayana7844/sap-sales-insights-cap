const cds = require('@sap/cds')

const INSIGHTS_URL = () => process.env.INSIGHTS_URL || 'http://localhost:5001'
const DAY = 86400000

/** Monday of the ISO week for a YYYY-MM-DD date (UTC based, no timezone drift). */
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const shift = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - shift * DAY).toISOString().slice(0, 10)
}

const round2 = n => Math.round(n * 100) / 100

module.exports = class SalesService extends cds.ApplicationService {
  async init() {
    
    // Read through the database service: aggregations must see all rows, not the
    // default 1000-row page limit that applies to service reads.
    const loadOrders = ({ region, material }) => {
      const where = {}
      if (region) where.region = region
      if (material) where.material_ID = material
      return SELECT.from('sales.Orders').columns('orderDate', 'quantity', 'netPrice').where(where)
    }

    this.on('kpis', async req => {
      const rows = await cds.db.run(loadOrders(req.data))
      if (!rows.length) return { revenue: 0, orders: 0, units: 0, avgOrderValue: 0, revenueLast30d: 0, growthPct: 0 }
      const revenue = rows.reduce((s, r) => s + Number(r.netPrice), 0)
      const units = rows.reduce((s, r) => s + r.quantity, 0)
      const latest = rows.map(r => r.orderDate).sort().pop()
      const end = new Date(latest + 'T00:00:00Z').getTime()
      const inWindow = (r, from, to) => {
        const t = new Date(r.orderDate + 'T00:00:00Z').getTime()
        return t > end - to * DAY && t <= end - from * DAY
      }
      const last30 = rows.filter(r => inWindow(r, 0, 30)).reduce((s, r) => s + Number(r.netPrice), 0)
      const prev30 = rows.filter(r => inWindow(r, 30, 60)).reduce((s, r) => s + Number(r.netPrice), 0)
      return {
        revenue: round2(revenue),
        orders: rows.length,
        units,
        avgOrderValue: round2(revenue / rows.length),
        revenueLast30d: round2(last30),
        growthPct: prev30 ? Math.round(((last30 - prev30) / prev30) * 1000) / 10 : 0
      }
    })

    const weeklySeries = async data => {
      const rows = await cds.db.run(loadOrders(data))
      const buckets = new Map()
      for (const r of rows) {
        const w = weekStart(r.orderDate)
        buckets.set(w, (buckets.get(w) || 0) + Number(r.netPrice))
      }
      if (!buckets.size) return []
      // Drop incomplete weeks at both ends of the data range: a half week would
      // look like a revenue drop and distort anomaly detection and the forecast.
      const dates = rows.map(r => r.orderDate).sort()
      const addDays = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10)
      for (const w of [...buckets.keys()]) {
        if (w < dates[0] || addDays(w, 6) > dates.at(-1)) buckets.delete(w)
      }
      if (!buckets.size) return []
      // fill empty weeks with 0 so the series has no gaps
      const keys = [...buckets.keys()].sort()
      const out = []
      for (let t = new Date(keys[0] + 'T00:00:00Z').getTime(); t <= new Date(keys.at(-1) + 'T00:00:00Z').getTime(); t += 7 * DAY) {
        const k = new Date(t).toISOString().slice(0, 10)
        out.push({ weekStart: k, revenue: round2(buckets.get(k) || 0) })
      }
      return out
    }

    this.on('weekly', req => weeklySeries(req.data))

    this.on('insights', async req => {
      const series = await weeklySeries(req.data)
      let res
      try {
        res = await fetch(`${INSIGHTS_URL()}/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ series, horizon: 4 })
        })
      } catch (e) {
        return req.error(503, `Insight service not reachable at ${INSIGHTS_URL()}: ${e.message}`)
      }
      const body = await res.json()
      if (!res.ok) return req.error(res.status === 422 ? 422 : 502, body.error || 'Insight service error')
      return body
    })

    return super.init()
  }
}
