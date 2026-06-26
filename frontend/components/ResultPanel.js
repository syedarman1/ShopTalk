"use client";
import { ShoppingBag, Package, Users, Receipt, Store } from "lucide-react";
import Sparkline from "./Sparkline";
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

function Sales({ detail }) {
  // Single-store result has totalsByCurrency; rollup has combined + perStore.
  const rollup = detail.combined != null;
  const byCurrency = rollup ? detail.combined.byCurrency : detail.totalsByCurrency;
  const orderCount = rollup ? detail.combined.orderCount : detail.orderCount;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShoppingBag className="h-4 w-4" /> Sales {rollup ? "(all stores)" : `— ${detail.store}`}
      </div>
      <div className="text-3xl font-semibold">{fmtMoney(byCurrency)}</div>
      <div className="text-sm text-muted-foreground">{orderCount} orders</div>
      {detail.series && <Sparkline series={detail.series} />}
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
    return (
      <Rows
        icon={Receipt}
        title={latest.message}
        headers={["Order", "Customer", "Total", "Fulfillment"]}
        rows={orders.map((o) => (
          <tr key={o.name} className="border-t border-border/50">
            <td className="py-1 pr-3 font-mono">{o.name}</td>
            <td className="py-1 pr-3">{o.customer ?? "—"}</td>
            <td className="py-1 pr-3 font-mono">{o.total != null ? `${o.total.toFixed(2)} ${o.currency}` : "—"}</td>
            <td className="py-1 pr-3 text-muted-foreground">{o.fulfillmentStatus ?? "—"}</td>
          </tr>
        ))}
      />
    );
  }

  if (latest.type === "products") {
    return (
      <Rows
        icon={Package}
        title={latest.message}
        headers={["Product", "Price", "Inventory", "Status"]}
        rows={(d || []).map((p, i) => (
          <tr key={`${p.title}-${i}`} className="border-t border-border/50">
            <td className="py-1 pr-3">{p.title}</td>
            <td className="py-1 pr-3 font-mono">{p.price != null ? `${p.price.toFixed(2)} ${p.currency}` : "—"}</td>
            <td className="py-1 pr-3 font-mono">{p.totalInventory ?? "—"}</td>
            <td className="py-1 pr-3 text-muted-foreground">{p.status ?? "—"}</td>
          </tr>
        ))}
      />
    );
  }

  if (latest.type === "customers") {
    return (
      <Rows
        icon={Users}
        title={latest.message}
        headers={["Customer", "Email", "Orders", "Spent"]}
        rows={(d || []).map((c, i) => (
          <tr key={`${c.email}-${i}`} className="border-t border-border/50">
            <td className="py-1 pr-3">{c.name}</td>
            <td className="py-1 pr-3 text-muted-foreground">{c.email ?? "—"}</td>
            <td className="py-1 pr-3 font-mono">{c.orders ?? "—"}</td>
            <td className="py-1 pr-3 font-mono">{c.amountSpent != null ? `${c.amountSpent.toFixed(2)} ${c.currency}` : "—"}</td>
          </tr>
        ))}
      />
    );
  }

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
