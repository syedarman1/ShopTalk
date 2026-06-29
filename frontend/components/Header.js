"use client";

export default function Header({ stores, demo }) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card/40 px-5 py-3">
      <div>
        <h1 className="text-base font-semibold tracking-tight">ShopTalk</h1>
        <p className="text-xs text-muted-foreground">
          Ask questions about your Shopify stores in plain English.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {demo && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
            Demo · sample data
          </span>
        )}
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5">
          <span className="inline-flex h-2 w-2 rounded-full bg-shopify-light" />
          <span className="text-xs text-muted-foreground">
            {stores.length} {stores.length === 1 ? "store" : "stores"}
          </span>
        </div>
      </div>
    </header>
  );
}
