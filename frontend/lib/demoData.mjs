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
        period: "today",
        totalsByCurrency: { USD: 2480 },
        orderCount: 18,
        averageByCurrency: { USD: 137.78 },
        comparison: { label: "yesterday", totalsByCurrency: { USD: 2100 } },
        series: {
          points: [
            { label: "8a", value: 40, prev: 30 },
            { label: "9a", value: 80, prev: 70 },
            { label: "10a", value: 120, prev: 110 },
            { label: "11a", value: 150, prev: 130 },
            { label: "12p", value: 210, prev: 170 },
            { label: "1p", value: 180, prev: 160 },
            { label: "2p", value: 160, prev: 150 },
            { label: "3p", value: 230, prev: 190 },
            { label: "4p", value: 250, prev: 210 },
            { label: "5p", value: 300, prev: 250 },
            { label: "6p", value: 240, prev: 210 },
            { label: "7p", value: 200, prev: 180 },
            { label: "8p", value: 180, prev: 140 },
            { label: "9p", value: 140, prev: 100 },
          ],
        },
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
