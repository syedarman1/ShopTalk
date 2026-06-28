"use client";
import { ShoppingBag, Package, Users, Receipt, Store } from "lucide-react";
import RevenueChart from "./RevenueChart";
import { pctChange } from "../lib/revenueChart.mjs";
import { PanelHeader, StatStrip, StatusPill, SplitBar, SpendBar } from "./PanelUI";
import { summarizeOrders, summarizeProducts, summarizeCustomers, stockLevel } from "../lib/panelSummaries.mjs";
import { motion, AnimatePresence } from "framer-motion";

const fmtMoney = (byCurrency) =>
  Object.entries(byCurrency || {})
    .map(([cur, amt]) => `${Number(amt).toFixed(2)} ${cur}`)
    .join(" · ") || "—";

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Text Poke a question about your store to see results here.
    </div>
  );
}

function DeltaBadge({ pct }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${up ? "text-shopify-light" : "text-rose-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs yesterday
    </span>
  );
}

function Sales({ detail }) {
  // Single-store result has totalsByCurrency; rollup has combined + perStore.
  const rollup = detail.combined != null;
  const byCurrency = rollup ? detail.combined.byCurrency : detail.totalsByCurrency;
  const orderCount = rollup ? detail.combined.orderCount : detail.orderCount;
  const points = detail.series?.points;
  const hasChart = !rollup && Array.isArray(points) && points.length >= 2;

  const cur = Object.keys(byCurrency || {})[0] || "USD";
  const todayTotal = byCurrency?.[cur];
  const prevTotal = detail.comparison?.totalsByCurrency?.[cur];
  const pct = hasChart ? pctChange(todayTotal, prevTotal) : null;
  const aov = detail.averageByCurrency?.[cur] ?? (orderCount ? (todayTotal || 0) / orderCount : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShoppingBag className="h-4 w-4" /> Total sales · {rollup ? "all stores · " : ""}Today
        </div>
        <DeltaBadge pct={pct} />
      </div>

      <div className="text-4xl font-semibold tracking-tight">{fmtMoney(byCurrency)}</div>

      {hasChart && <RevenueChart points={points} currency={cur} />}

      <div className="grid grid-cols-2 gap-4 border-t border-border/50 pt-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Orders</div>
          <div className="text-xl font-semibold">{orderCount ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Avg order value</div>
          <div className="text-xl font-semibold">{aov != null ? `${aov.toFixed(2)} ${cur}` : "—"}</div>
        </div>
      </div>

      {rollup && (
        <ul className="mt-2 space-y-1 text-sm">
          {detail.perStore.map((s) => (
            <li key={s.store} className="flex justify-between border-t border-border/50 py-1">
              <span>{s.store}</span>
              <span className="font-mono">{fmtMoney(s.totalsByCurrency)} · {s.orderCount}{s.capped ? " (capped)" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const fulfillLabel = (s) =>
  ({ FULFILLED: "Fulfilled", UNFULFILLED: "Unfulfilled", PARTIALLY_FULFILLED: "Partial" }[s] || s || "—");

function Orders({ orders }) {
  const { count, valueByCurrency, unfulfilled } = summarizeOrders(orders);
  const badge = unfulfilled > 0
    ? <StatusPill tone="warn">{unfulfilled} unfulfilled</StatusPill>
    : <StatusPill tone="success">all fulfilled</StatusPill>;
  return (
    <div className="space-y-4">
      <PanelHeader icon={Receipt} title="Recent orders" badge={badge} />
      <StatStrip stats={[
        { label: "Orders", value: count },
        { label: "Value", value: fmtMoney(valueByCurrency) },
        { label: "Unfulfilled", value: unfulfilled },
      ]} />
      <SplitBar parts={[
        { value: count - unfulfilled, className: "bg-shopify" },
        { value: unfulfilled, className: "bg-amber-400" },
      ]} />
      <ul>
        {orders.map((o) => (
          <li key={o.name} className="flex items-center gap-3 border-t border-border/50 py-2 text-sm">
            <span className="w-14 font-mono text-muted-foreground">{o.name}</span>
            <span className="flex-1 truncate">{o.customer ?? "—"}</span>
            <span className="font-mono">{o.total != null ? `${o.total.toFixed(2)} ${o.currency}` : "—"}</span>
            <span className="w-24 text-right">
              <StatusPill tone={o.fulfillmentStatus === "FULFILLED" ? "success" : o.fulfillmentStatus ? "warn" : "muted"}>
                {fulfillLabel(o.fulfillmentStatus)}
              </StatusPill>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Products({ products }) {
  const { count, active, needRestock } = summarizeProducts(products);
  const badge = needRestock > 0
    ? <StatusPill tone="warn">{needRestock} need restock</StatusPill>
    : <StatusPill tone="success">stock healthy</StatusPill>;
  return (
    <div className="space-y-4">
      <PanelHeader icon={Package} title="Products" badge={badge} />
      <StatStrip stats={[
        { label: "Products", value: count },
        { label: "Active", value: active },
        { label: "Need restock", value: needRestock },
      ]} />
      <ul>
        {products.map((p, i) => {
          const lvl = stockLevel(p.totalInventory);
          const tone = lvl === "out" ? "danger" : lvl === "low" ? "warn" : "success";
          const text = lvl === "out" ? "Out of stock" : lvl === "low" ? `Low · ${p.totalInventory}` : `${p.totalInventory ?? "—"} in stock`;
          return (
            <li key={`${p.title}-${i}`} className="flex items-center gap-3 border-t border-border/50 py-2 text-sm">
              <span className="flex flex-1 items-center gap-2 truncate">
                <span className="truncate">{p.title}</span>
                {p.status !== "ACTIVE" && <StatusPill tone="muted">Draft</StatusPill>}
              </span>
              <span className="font-mono">{p.price != null ? `${p.price.toFixed(2)} ${p.currency}` : "—"}</span>
              <span className="w-28 text-right"><StatusPill tone={tone}>{text}</StatusPill></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Customers({ customers }) {
  const { count, spentByCurrency, avgOrders, maxSpent } = summarizeCustomers(customers);
  return (
    <div className="space-y-4">
      <PanelHeader icon={Users} title="Repeat customers" badge={<StatusPill tone="muted">{count} customers</StatusPill>} />
      <StatStrip stats={[
        { label: "Customers", value: count },
        { label: "Total spent", value: fmtMoney(spentByCurrency) },
        { label: "Avg orders", value: avgOrders },
      ]} />
      <ul className="space-y-2">
        {customers.map((c, i) => (
          <li key={`${c.email}-${i}`} className="space-y-1 border-t border-border/50 pt-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-5 text-center font-mono text-muted-foreground">{i + 1}</span>
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-muted-foreground">{c.orders ?? "—"} orders</span>
              <span className="font-mono">{c.amountSpent != null ? `${c.amountSpent.toFixed(2)} ${c.currency}` : "—"}</span>
            </div>
            <div className="pl-8"><SpendBar fraction={maxSpent ? (c.amountSpent || 0) / maxSpent : 0} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rows({ icon: Icon, title, headers, rows }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {title}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {headers.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function renderResult(latest) {
  if (!latest) return <Empty />;
  const d = latest.detail;

  if (latest.type === "sales") return <Sales detail={d} />;

  if (latest.type === "orders" || latest.type === "order") {
    const orders = latest.type === "order" ? (d ? [d] : []) : d || [];
    return <Orders orders={orders} />;
  }

  if (latest.type === "products") return <Products products={d || []} />;

  if (latest.type === "customers") return <Customers customers={d || []} />;

  if (latest.type === "stores") {
    return (
      <Rows
        icon={Store}
        title={latest.message}
        headers={["Key", "Label", "Domain"]}
        rows={(d || []).map((s) => (
          <tr key={s.key} className="border-t border-border/50">
            <td className="py-1 pr-3 font-mono">{s.key}</td>
            <td className="py-1 pr-3">{s.label}</td>
            <td className="py-1 pr-3 text-muted-foreground">{s.shopDomain}</td>
          </tr>
        ))}
      />
    );
  }

  return <Empty />;
}

export default function ResultPanel({ latest }) {
  const key = latest ? `${latest.tool}:${latest.message}` : "empty";
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className="h-full"
      >
        {renderResult(latest)}
      </motion.div>
    </AnimatePresence>
  );
}
