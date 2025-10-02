export const codeSamplesOverview = {
  eyebrow: "Production code deep dive",
  title: "Curated samples from the Overhub commerce platform",
  description:
    "Three production-hardened slices of the Overhub ecosystem that show how I design payment flows, orchestrate complex state, and ship resilient interfaces.",
  stats: [
    { label: "Total lines of code", value: "4,580+" },
    { label: "Implementation files", value: "16" },
    { label: "Primary stacks", value: "Node.js, React, Vue 3" }
  ],
  themes: [
    {
      heading: "Platform depth",
      copy: "Multi-tenant payment workflows, queue-backed jobs, and authorization layers engineered for scale."
    },
    {
      heading: "Frontend resilience",
      copy: "Robust UI patterns for payment operations and embeddable commerce experiences."
    },
    {
      heading: "Architecture discipline",
      copy: "Emphasis on design patterns, test coverage, and documentation to support long-term maintainability."
    }
  ]
};

export const codeSamplesData = [
  {
    id: "overhub-api",
    title: "Overhub Payment Gateway API",
    summary:
      "FeathersJS backend that orchestrates multi-gateway payment processing, order lifecycles, and refund workflows across tenants.",
    stack: ["Node.js", "FeathersJS", "PostgreSQL", "Objection", "Bull", "XState", "CASL"],
    metrics: [
      { label: "Lines", value: "3,500+" },
      { label: "Files", value: "13 services" },
      { label: "Tests", value: "4 suites" },
      { label: "Complexity", value: "Very high" }
    ],
    context: {
      focus: "Payments orchestration for a multi-tenant SaaS",
      responsibilities: [
        "Designed gateway abstraction layer with Strategy + Factory patterns",
        "Implemented refund and capture workflows with XState state machines",
        "Hardened authorization using CASL with SQL query generation"
      ]
    },
    highlights: [
      {
        title: "Orders middleware pipeline",
        description:
          "964-line hook chain that validates, enriches, and routes orders through payment, risk, and fulfillment stages."
      },
      {
        title: "Processor rules engine",
        description:
          "Aggregation-powered decision engine selecting the best payment gateway per transaction characteristics."
      },
      {
        title: "Queue-backed operations",
        description:
          "Custom Bull queue extension with job deduplication and retry semantics for charge captures and refunds."
      }
    ],
    docId: "overhub-api"
  },
  {
    id: "admin",
    title: "Overhub Admin Payment Console",
    summary:
      "React interface that gives operations teams real-time visibility into transactions and a guided payment capture flow.",
    stack: ["React", "React Bootstrap", "Axios"],
    metrics: [
      { label: "Lines", value: "180" },
      { label: "Files", value: "1 component" },
      { label: "Focus", value: "Form UX" }
    ],
    context: {
      focus: "Multi-gateway human-in-the-loop captures",
      responsibilities: [
        "Built controlled form patterns that surface gateway-specific fields dynamically",
        "Implemented optimistic UI with gateway fallback strategies",
        "Centralized validation and error messaging for operations staff"
      ]
    },
    highlights: [
      {
        title: "Dynamic gateway switching",
        description:
          "Operators toggle between Stripe, PayPal, and NMI, with contextual help and validation for each."
      },
      {
        title: "State lifting",
        description:
          "Top-level component manages capture attempts while child inputs handle granular validation."
      },
      {
        title: "Operational safeguards",
        description:
          "Pre-flight checks prevent duplicate captures and mismatched currencies before hitting the API."
      }
    ],
    docId: "admin"
  },
  {
    id: "portable-cart",
    title: "Overhub Portable Cart",
    summary:
      "Embeddable Vue 3 cart that synchronizes with the Overhub API, including filtering, persistence, and performance optimizations.",
    stack: ["Vue 3", "Pinia", "Axios", "Parcel"],
    metrics: [
      { label: "Lines", value: "900+" },
      { label: "Files", value: "2 modules" },
      { label: "Complexity", value: "High" }
    ],
    context: {
      focus: "Drop-in commerce experience for partner storefronts",
      responsibilities: [
        "Architected Pinia store that handles filtering, memoization, and persistence",
        "Authored singleton API controller coordinating cart state and backend sync",
        "Optimized derived views with cache-aware selectors and computed properties"
      ]
    },
    highlights: [
      {
        title: "Filter grammar",
        description:
          "Customer-friendly filter syntax compiled into API queries with operator precedence and memoization."
      },
      {
        title: "Event bus",
        description:
          "Observer-style events notify host apps about cart changes, inventory levels, and checkout states."
      },
      {
        title: "Persistence layer",
        description:
          "Resilient LocalStorage sync that guards against version drift and partial cache corruption."
      }
    ],
    docId: "portable-cart"
  }
];
