// Tiny className combiner (keeps us off extra deps like clsx/tailwind-merge).
export function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";
