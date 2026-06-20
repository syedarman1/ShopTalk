// Minimal shadcn/ui-style primitives (Card / Button / Badge) built on Tailwind.
// Kept in one file since the set is small.
import { cn } from "@/lib/utils";

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card/70 shadow-sm shadow-black/20",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-b border-border px-4 py-3",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }) {
  return (
    <h2
      className={cn(
        "text-sm font-semibold tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function Button({ className, variant = "default", size = "default", ...props }) {
  const variants = {
    default:
      "bg-primary text-primary-foreground hover:bg-primary/90",
    outline:
      "border border-border bg-transparent hover:bg-muted text-foreground",
    ghost: "bg-transparent hover:bg-muted text-foreground",
  };
  const sizes = {
    default: "h-9 px-4 text-sm",
    sm: "h-8 px-3 text-xs",
    icon: "h-9 w-9",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

export function Badge({ className, variant = "default", ...props }) {
  const variants = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/15 text-primary border border-primary/30",
    type: "bg-muted text-muted-foreground border border-border font-mono",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
