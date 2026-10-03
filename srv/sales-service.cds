using sales from '../db/schema';

@path: '/odata/v4/sales'
service SalesService {

  @readonly entity Materials as projection on sales.Materials;
  @readonly entity Orders    as projection on sales.Orders;

  // Aggregated view, queryable with OData like any entity.
  @readonly entity MonthlyRevenue as
    select from sales.Orders {
      key substring(orderDate, 0, 7) as month  : String(7),
      key region                     as region : String(2),
          sum(netPrice)              as revenue : Decimal(15, 2),
          count(*)                   as orders  : Integer
    }
    group by substring(orderDate, 0, 7), region;

  type KPIs {
    revenue        : Decimal(15, 2);
    orders         : Integer;
    units          : Integer;
    avgOrderValue  : Decimal(15, 2);
    revenueLast30d : Decimal(15, 2);
    growthPct      : Decimal(7, 1);   // last 30 days vs the 30 days before
  }

  type WeeklyPoint {
    weekStart : Date;
    revenue   : Decimal(15, 2);
  }

  type Anomaly {
    weekStart : Date;
    revenue   : Decimal(15, 2);
    expected  : Decimal(15, 2);
    score     : Decimal(7, 2);
    direction : String(5);
  }

  type ForecastPoint {
    weekStart : Date;
    revenue   : Decimal(15, 2);
    lower     : Decimal(15, 2);
    upper     : Decimal(15, 2);
  }

  type Insights {
    anomalies : many Anomaly;
    forecast  : many ForecastPoint;
    summary   : String(300);
  }

  function kpis(region : String, material : String)     returns KPIs;
  function weekly(region : String, material : String)   returns many WeeklyPoint;
  function insights(region : String, material : String) returns Insights;
}
