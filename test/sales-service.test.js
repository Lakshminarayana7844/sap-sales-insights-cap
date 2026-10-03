const { test, before, after } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const cds = require('@sap/cds')

const { GET } = cds.test(__dirname + '/..')
const BASE = '/odata/v4/sales'

let stub, stubCalls = []

before(async () => {
  // Stand-in for the Python insight service, so the CAP tests need no Python.
  stub = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      stubCalls.push(JSON.parse(body))
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        anomalies: [{ weekStart: '2026-03-16', revenue: 9000, expected: 3000, score: 8.1, direction: 'spike' }],
        forecast: [{ weekStart: '2026-10-05', revenue: 3100, lower: 2500, upper: 3700 }],
        summary: 'stub'
      }))
    })
  })
  await new Promise(r => stub.listen(0, r))
  process.env.INSIGHTS_URL = `http://localhost:${stub.address().port}`
})

after(() => stub.close())

test('serves OData $metadata', async () => {
  const { data } = await GET(`${BASE}/$metadata`)
  assert.ok(String(data).includes('EntityType Name="Orders"'))
})

test('orders support $filter, $top and $count', async () => {
  const { data } = await GET(`${BASE}/Orders?$filter=region eq 'DE'&$top=5&$count=true&$orderby=orderDate desc`)
  assert.equal(data.value.length, 5)
  assert.ok(data['@odata.count'] > 5)
  assert.ok(data.value.every(o => o.region === 'DE'))
})

test('MonthlyRevenue aggregates per month and region', async () => {
  const { data } = await GET(`${BASE}/MonthlyRevenue?$filter=region eq 'NL'&$orderby=month`)
  assert.ok(data.value.length >= 12)
  assert.match(data.value[0].month, /^\d{4}-\d{2}$/)
})

test('kpis respects region and material filters', async () => {
  const all = (await GET(`${BASE}/kpis()`)).data
  const de = (await GET(`${BASE}/kpis(region='DE')`)).data
  const deM4 = (await GET(`${BASE}/kpis(region='DE',material='M-400')`)).data
  assert.ok(all.orders > de.orders && de.orders > deM4.orders)
  assert.ok(all.revenue > de.revenue)
  assert.ok(Math.abs(all.avgOrderValue - all.revenue / all.orders) < 0.01)
})

test('weekly returns a gap-free Monday based series', async () => {
  const { data } = await GET(`${BASE}/weekly()`)
  assert.ok(data.value.length >= 50)
  data.value.forEach((p, i) => {
    assert.equal(new Date(p.weekStart + 'T00:00:00Z').getUTCDay(), 1)
    if (i) assert.equal((new Date(p.weekStart) - new Date(data.value[i - 1].weekStart)) / 864e5, 7)
  })
})

test('weekly excludes incomplete first and last weeks', async () => {
  const { data } = await GET(`${BASE}/weekly()`)
  assert.equal(data.value[0].weekStart, '2025-10-06')      // data starts Wed 2025-10-01
  assert.equal(data.value.at(-1).weekStart, '2026-09-21')  // data ends Wed 2026-09-30
})

test('kpis count every order (no default 1000 row page limit)', async () => {
  const { data } = await GET(`${BASE}/kpis()`)
  const all = await GET(`${BASE}/Orders?$count=true&$top=0`)
  assert.equal(data.orders, all.data['@odata.count'])
  assert.ok(data.orders > 1000)
})

test('insights forwards the weekly series to the insight service', async () => {
  const { data } = await GET(`${BASE}/insights(region='DE')`)
  assert.equal(data.anomalies[0].direction, 'spike')
  assert.equal(data.forecast.length, 1)
  assert.equal(stubCalls.at(-1).horizon, 4)
  assert.ok(stubCalls.at(-1).series.length >= 50)
})
