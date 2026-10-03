sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, JSONModel, Filter, FilterOperator) {
  "use strict";

  const SERVICE = "/odata/v4/sales/";

  /** Calls an OData V4 function import and returns the parsed JSON. */
  async function callFunction(name, params) {
    const args = Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}='${encodeURIComponent(v)}'`)
      .join(",");
    const res = await fetch(`${SERVICE}${name}(${args})`);
    const body = await res.json();
    if (!res.ok) {
      throw new Error((body.error && body.error.message) || `${name} failed (${res.status})`);
    }
    return body;
  }

  return Controller.extend("sales.insights.controller.Main", {
    onInit: function () {
      this.getView().setModel(new JSONModel({
        kpis: {}, chart: [], insights: { anomalies: [], summary: "", type: "Information" }
      }), "view");
      this._refresh();
    },

    onFilterChange: function () {
      this._refresh();
    },

    _filters: function () {
      return {
        region: this.byId("regionSelect").getSelectedKey(),
        material: this.byId("materialSelect").getSelectedKey()
      };
    },

    _refresh: async function () {
      const model = this.getView().getModel("view");
      const f = this._filters();

      // Orders table uses the OData V4 model with server side filtering.
      const filters = [];
      if (f.region) { filters.push(new Filter("region", FilterOperator.EQ, f.region)); }
      if (f.material) { filters.push(new Filter("material_ID", FilterOperator.EQ, f.material)); }
      this.byId("ordersTable").getBinding("items").filter(filters);

      try {
        const [k, weekly] = await Promise.all([callFunction("kpis", f), callFunction("weekly", f)]);
        const growth = Number(k.growthPct);
        model.setProperty("/kpis", {
          revenueFmt: Math.round(Number(k.revenue)).toLocaleString("en-US"),
          orders: k.orders,
          avgOrderValue: Math.round(Number(k.avgOrderValue)),
          growthPct: growth,
          growthColor: growth >= 0 ? "Good" : "Error",
          growthIndicator: growth >= 0 ? "Up" : "Down"
        });
        model.setProperty("/chart", weekly.value.map(p => ({
          weekStart: p.weekStart, revenue: Number(p.revenue), forecast: null
        })));
        await this._loadInsights(f, weekly.value);
      } catch (e) {
        model.setProperty("/insights", { anomalies: [], summary: e.message, type: "Error" });
      }
    },

    _loadInsights: async function (f, weekly) {
      const model = this.getView().getModel("view");
      try {
        const ins = await callFunction("insights", f);
        const chart = weekly.slice(-26).map(p => ({ weekStart: p.weekStart, revenue: Number(p.revenue), forecast: null }));
        // connect the forecast line to the last actual point
        const last = chart[chart.length - 1];
        last.forecast = last.revenue;
        ins.forecast.forEach(p => chart.push({ weekStart: p.weekStart, revenue: null, forecast: Number(p.revenue) }));
        model.setProperty("/chart", chart);
        model.setProperty("/insights", {
          anomalies: ins.anomalies, summary: ins.summary, type: ins.anomalies.length ? "Warning" : "Success"
        });
      } catch (e) {
        model.setProperty("/insights", { anomalies: [], summary: e.message, type: "Error" });
      }
    }
  });
});
