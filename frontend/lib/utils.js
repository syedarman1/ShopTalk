// Tiny className combiner (keeps us off extra deps like clsx/tailwind-merge).
export function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}
