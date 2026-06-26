// demoData.mjs — sample store + scripted demo sequence. Pure data, no React.
// All data is FAKE (no real PII). event.detail matches ResultPanel's field shapes
// per event.type, so the demo renders exactly like the real tools.

export const DEMO_STORE = {
  key: "northwind",
  label: "Northwind Supply Co.",
  shopDomain: "northwind-supply.myshopify.com",
};

export const DEMO_STORES = [DEMO_STORE];

export const DEMO_SCRIPT = [
  {
    id: "sales-today",
    question: "How much did I sell today?",
    reply: "You've made 2,480.00 USD across 18 orders today — average order 137.78 USD. 📈",
    event: {
      type: "sales",
      tool: "get_sales",
      store: "northwind",
      message: "northwind — today: 18 orders, 2480.00 USD",
      detail: {
        store: "northwind",
        totalsByCurrency: { USD: 2480 },
        orderCount: 18,
        series: [180, 240, 90, 320, 150, 410, 260, 300, 330],
      },
    },
  },
  {
    id: "recent-orders",
    question: "Show my last 5 orders",
    reply: "Here are your 5 most recent orders — 2 are still unfulfilled.",
    event: {
      type: "orders",
      tool: "get_orders",
      store: "northwind",
      message: "northwind — 5 recent orders",
      detail: [
        { name: "#1042", customer: "Ada Lovelace", total: 168.0, currency: "USD", fulfillmentStatus: "UNFULFILLED" },
        { name: "#1041", customer: "Grace Hopper", total: 92.5, currency: "USD", fulfillmentStatus: "FULFILLED" },
        { name: "#1040", customer: "Alan Turing", total: 240.0, currency: "USD", fulfillmentStatus: "UNFULFILLED" },
        { name: "#1039", customer: "Katherine Johnson", total: 54.0, currency: "USD", fulfillmentStatus: "FULFILLED" },
        { name: "#1038", customer: "Edsger Dijkstra", total: 119.0, currency: "USD", fulfillmentStatus: "FULFILLED" },
      ],
    },
  },
  {
    id: "top-products",
    question: "What are my products?",
    reply: "Your catalog — the Trail Hoodie is your hero product and it's low on stock (7 left).",
    event: {
      type: "products",
      tool: "search_products",
      store: "northwind",
      message: "northwind — 5 products",
      detail: [
        { title: "Trail Hoodie", price: 68.0, currency: "USD", totalInventory: 7, status: "ACTIVE" },
        { title: "Everyday Tote", price: 42.0, currency: "USD", totalInventory: 130, status: "ACTIVE" },
        { title: "Wool Beanie", price: 28.0, currency: "USD", totalInventory: 64, status: "ACTIVE" },
        { title: "Canvas Sneakers", price: 95.0, currency: "USD", totalInventory: 23, status: "ACTIVE" },
        { title: "Linen Scarf", price: 34.0, currency: "USD", totalInventory: 0, status: "DRAFT" },
      ],
    },
  },
  {
    id: "repeat-customers",
    question: "Who are my repeat customers?",
    reply: "Your top repeat customers by spend 👇",
    event: {
      type: "customers",
      tool: "search_customers",
      store: "northwind",
      message: "northwind — 4 customers",
      detail: [
        { name: "Ada Lovelace", email: "ada@example.com", orders: 12, amountSpent: 1840.0, currency: "USD" },
        { name: "Grace Hopper", email: "grace@example.com", orders: 9, amountSpent: 1320.5, currency: "USD" },
        { name: "Alan Turing", email: "alan@example.com", orders: 7, amountSpent: 980.0, currency: "USD" },
        { name: "Katherine Johnson", email: "kj@example.com", orders: 5, amountSpent: 610.0, currency: "USD" },
      ],
    },
  },
];
