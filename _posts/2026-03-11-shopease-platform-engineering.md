---
layout: post
title: "Building a Production-Grade Microservices Platform on Kubernetes"
date: 2026-03-11
tags: [Platform Engineering, Microservices, Kubernetes, Distributed Systems, CI/CD, Observability, DDD, Contract Testing, Zero Trust]
read_time: 18
description: "An architectural deep dive into ShopEase — a production-grade, polyglot microservices eCommerce platform demonstrating domain-driven design, contract-driven APIs, production observability, and CI/CD governance on Kubernetes."
---

# Building a Production-Grade Microservices Platform on Kubernetes

There is a difference between building a microservices *demo* and building a microservices *platform*. A demo splits a monolith into a handful of HTTP services. A platform is designed around bounded contexts, enforces API contracts between teams, gates every deployment behind an automated test pyramid, instruments every request end-to-end, and treats the network as untrusted from day one.

This post is an architectural deep dive into **ShopEase** — a full-stack, cloud-native eCommerce platform I built to production standards. The platform consists of four backend microservices, a Next.js frontend, three independent database engines, a five-layer test pyramid with 330+ tests, automated CI/CD, and a full observability stack — all running on Kubernetes.

> **Live at**: [shop.kunlecreates.org](https://shop.kunlecreates.org) &nbsp;|&nbsp; **GitHub**: [kunlecreates/shop-ease-enterprise-app](https://github.com/kunlecreates/shop-ease-enterprise-app)

The goal of this post is not to walk through code line-by-line. It is to articulate the *architectural thinking* — the decisions that distinguish platform engineering from application development.

---

## Pillar 1: Domain-Driven Microservices

The first design decision was the hardest: **how to draw the service boundaries**.

Most beginners split services by technical function — "authentication service", "database service", "API service". That produces chatty, tightly coupled systems that are harder to operate than the monolith they replaced.

Domain-Driven Design (DDD) provides a better lens: split by **bounded context**, where each context owns a coherent piece of business behaviour and its own data model.

### The Five Bounded Contexts

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          ShopEase Platform                                    │
├──────────────┬──────────────┬───────────────┬──────────────┬──────────────────┤
│   frontend   │ user-service │product-service│ order-service│notification-svc  │
│              │              │               │              │                  │
│  Next.js 15  │ Identity &   │  Catalogue &  │  Carts &     │  Email delivery  │
│  App Router  │  Auth        │  Inventory    │  Fulfilment  │  (stateless)     │
│              │              │               │              │                  │
│  React 19    │  Oracle DB   │  PostgreSQL   │  MS SQL Svr  │  FastAPI         │
└──────────────┴──────────────┴───────────────┴──────────────┴──────────────────┘
```

**Why this split?**

- **user-service** owns *Identity*: registration, login, JWT issuance, email verification, password reset, RBAC, and the complete login audit trail. No other service handles authentication logic. The bounded context is enforced at the data layer — `user_ref` values in other services are opaque strings, not foreign keys.

- **product-service** owns the *Catalogue*: SKU definitions, pricing, categories, inventory levels, and stock movement audit. It is completely independent of orders or users. This allows the catalogue to scale independently during traffic spikes and be deployed without touching the checkout flow.

- **order-service** owns *Fulfilment*: shopping carts, order lifecycle, payment metadata, and shipping address snapshots. The key design rule here is that the shipping address is snapshotted at checkout time. A user updating their profile later never retroactively corrupts historical order data — a real-world requirement that most demos miss entirely.

- **notification-service** owns *Delivery*: it consumes order events and dispatches confirmation emails via Jinja2-templated SMTP. It is deliberately **stateless** — no database, no state machine, just a FastAPI service that renders a template and sends an email. Stateless services are trivially scalable and testable.

- **frontend** is not just a UI — it is a thin API proxy layer. Every backend call is routed through Next.js server-side API routes, which forward to the appropriate ClusterIP service. This means the browser never talks directly to backend services, and JWT tokens are stored in HttpOnly cookies, not `localStorage`.

### The Rule: No Cross-Service Foreign Keys

Cross-service data references use **opaque string keys** (`user_ref`, `product_ref`). There are no database-level foreign key constraints crossing service boundaries. Services communicate via APIs. This is what makes each service independently deployable.

---

## Pillar 2: Polyglot Service Architecture

Once bounded contexts were defined, the next question was: **which technology is right for each domain?**

Choosing the same technology for every service is operationally simpler, but it means accepting a worst-fit language for every problem. A platform engineer chooses the best tool for the bounded context.

| Service | Language & Framework | Why |
|---------|---------------------|-----|
| `user-service` | Java 21 + Spring Boot 3.3 | Stateful auth domain with complex lifecycle logic (verification tokens, password reset, login audit). Java's type system and Spring Security's maturity make RBAC and JWT/RS256 handling robust and well-tested. |
| `order-service` | Java 21 + Spring Boot 3.3 | Cart and order state machines benefit from Java's strong typing. Spring Data JPA + Testcontainers (MSSQL) gives production-identical integration testing. |
| `product-service` | Node.js 20 + NestJS 10 | The catalogue is primarily CRUD + full-text search. NestJS's decorator-driven module system matches the domain model cleanly. PostgreSQL's `TSVECTOR` full-text search integrates naturally with a TypeScript layer. |
| `notification-service` | Python 3.12 + FastAPI | A stateless email dispatcher. Python's Jinja2 ecosystem produces expressive email templates. FastAPI gives async handling with minimal boilerplate. For a fire-and-forward concern, Python is the right weight. |
| `frontend` | Next.js 15 + React 19 | App Router enables server-side rendering for SEO-critical product pages and server-side JWT verification before rendering protected routes. |

Each service is independently buildable, testable, and deployable. The CI pipelines are parallel — all five services build simultaneously on push.

---

## Pillar 3: Contract-Driven API Integration

In microservices systems, **the biggest category of integration bugs is contract drift**: Service A changes a response field name; Service B breaks silently. Traditional unit tests catch nothing because they mock the other service. Manual testing catches it eventually, but only after a deployment.

**Contract testing** closes this gap by making the expected API shape an explicit, versioned artefact — tested on every push.

### How the API Test Layer Works

```
api-tests/
├── contracts/         ← Schema validation tests (what shape does this service expose?)
│   ├── user-product.contract.test.ts     # product-service API matches user expectations
│   ├── order-product.contract.test.ts    # order-service expectations of product-service
│   └── ...
└── flows/             ← Multi-service business flow tests (do services work together?)
    ├── checkout.flow.test.ts             # login → browse → cart → checkout → confirmation
    ├── user-registration.flow.test.ts
    └── ...
```

**Contract tests** (`contracts/`) run against live deployed services. They validate:
- Required fields are present in every response
- Data types match the expected schema
- Error codes are consistent (e.g., `401` for expired JWT, `404` for missing resource)
- Pagination envelope format is stable

**Flow tests** (`flows/`) are end-to-end business workflow validators. They exercise real multi-service paths: a `checkout.flow.test.ts` call logs in as a real user, searches for a real product, adds it to a cart, checks out, and validates that an order record appears in the order service.

This layer runs in the CI pipeline **after deployment to the staging cluster** — it tests the real services, not mocks. A contract violation fails the pipeline before production promotion.

The practical result: when the product-service team changes a response envelope for performance reasons, the downstream contract tests fail immediately, not three deployments later.

---

## Pillar 4: Production CI/CD Strategy

The CI/CD pipeline is designed around two principles: **fail fast** and **deploy with confidence**.

### Pipeline Architecture

```
Developer Push (any service file)
         │
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                   GitHub Actions CI Pipeline                       │
│                                                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │  Unit Tests  │ → │ Integration  │ → │  Docker Build & Push   │  │
│  │  (fast, <1m) │   │  Tests       │   │  → GHCR                │  │
│  │              │   │  (real DB    │   │                        │  │
│  │  JUnit/Jest/ │   │  via         │   │  Reuses image across   │  │
│  │  pytest      │   │  Testcont.)  │   │  environments          │  │
│  └──────────────┘   └──────────────┘   └────────────────────────┘  │
│           │                  │                       │             │
│           │ FAIL             │ FAIL                  │ SUCCESS     │
│           ▼                  ▼                       ▼             │
│       Block PR           Block PR           Helm Deploy → K8s      │
└────────────────────────────────────────────────────────────────────┘
         │                                            │
         ▼ (post-deploy)                              ▼
┌─────────────────────────┐              ┌──────────────────────────┐
│  API Contract Tests     │              │  Coverage Authority      │
│  (live services)        │              │  (aggregate from all CIs)│
│  Blocks promotion       │              │  Updates badge           │
└─────────────────────────┘              └──────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Playwright E2E Tests   │
│  (browser, post-deploy) │
│  Does not block merge   │
└─────────────────────────┘
```

### Five Key Governance Decisions

1. **Integration tests block PRs** using real databases via Testcontainers. This eliminates the "works on my machine" class of failures. The Testcontainers pattern spins up a real PostgreSQL/MSSQL/Oracle container per test run, runs migrations against it, and tears it down — giving production-identical test fidelity in under five minutes.

2. **Parallel service pipelines**. All five services have independent CI pipelines that run concurrently on push. A change to `product-service` does not wait for `user-service` tests to pass. Total CI time: 3–5 minutes.

3. **Docker images are built once and reused**. The image built in CI is the exact image deployed to staging and promoted to production. There is no rebuild on deploy.

4. **Coverage Authority workflow** aggregates test coverage from all five service CI runs after they complete, computes a weighted aggregate, and auto-updates the coverage badge in the README. Coverage tracking is automated — it is not a manual step.

5. **Self-hosted ARC runner**. GitHub Actions Runner Controller (ARC) is deployed on the cluster. CI jobs run on the same infrastructure as production, eliminating environment-specific surprises.

<div class="coverage-callout">
  <div class="coverage-callout-icon">📊</div>
  <div>
    <strong>Spotlight: Coverage Authority — Platform-Level Quality Visibility</strong>
    <p>Most teams track test coverage per-service and call it done. Coverage Authority operates at the platform level. After all five independent service CI pipelines complete, a dedicated workflow collects each service's coverage report, computes a <em>weighted aggregate</em> across the entire platform, and automatically updates the README badge. A failing aggregate gate — where any service drops below its configured threshold — blocks the composite status from going green. This is quality governance engineered as infrastructure: a single authoritative view of platform-wide test health, updated on every push with zero manual steps.</p>
    <div class="coverage-callout-steps">
      <span class="coverage-step">1️⃣ All 5 service CIs run in parallel</span>
      <span class="coverage-step">2️⃣ Coverage reports uploaded as artifacts</span>
      <span class="coverage-step">3️⃣ Authority workflow triggered post-CI</span>
      <span class="coverage-step">4️⃣ Weighted aggregate computed across all services</span>
      <span class="coverage-step">5️⃣ README badge auto-updated on every push</span>
      <span class="coverage-step">6️⃣ Gate fails if any service is below threshold</span>
    </div>
  </div>
</div>

---

## Pillar 5: Observability-Native Services

Observability is not something you bolt on after a production incident. It is designed in from the beginning. The ShopEase platform uses **OpenTelemetry auto-instrumentation via the Kubernetes Operator pattern** — every service emits distributed traces, metrics, and logs with zero manual SDK instrumentation code.

### How OpenTelemetry Auto-Instrumentation Works

The OpenTelemetry Operator is deployed to the `opentelemetry-system` namespace. It watches for `Instrumentation` Custom Resources and automatically injects the appropriate OTel agent as an init container into every matching pod.

```yaml
# Java Instrumentation CR — applies to user-service and order-service
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: java-instrumentation
  namespace: shopease-system
spec:
  exporter:
    endpoint: http://otel-collector.opentelemetry-system:4317
  propagators: [tracecontext, baggage, b3]
  sampler:
    type: AlwaysOn
  java:
    image: ghcr.io/open-telemetry/opentelemetry-operator/autoinstrumentation-java:latest
    # Memory optimised to reduce 40-60% overhead vs default configuration
    env:
      - name: OTEL_INSTRUMENTATION_COMMON_EXPERIMENTAL_CONTROLLER_TELEMETRY_ENABLED
        value: "false"
```

When the `user-service` Pod is created, the Operator detects the `instrumentation.opentelemetry.io/inject-java: "true"` pod annotation and injects the Java agent init container. The application never changes. No SDK imports. No configuration code.

### The Full Signal Path

```
                        Auto-instrumented Pod
                     ┌──────────────────────────┐
                     │  Application Code        │
                     │  (unchanged)             │
                     │                          │
                     │  OTel Java Agent         │ ← injected by Operator
                     │  (init container)        │
                     └───────────┬──────────────┘
                                 │ OTLP/gRPC
                                 ▼
                     ┌──────────────────────────┐
                     │  OpenTelemetry Collector │
                     │  (gateway mode)          │
                     └──┬───────────┬───────────┘
                        │           │           │
                   Traces          Metrics     Logs
                        ▼           ▼           ▼
                    Jaeger    Prometheus     ECK
                    (trace    (metrics +   (Elasticsearch
                    UI)       Grafana)      + Kibana)
```

### What This Gives You

- **Distributed traces** in Jaeger: every inbound HTTP request to `user-service` generates a trace that propagates through `order-service` and `notification-service`. Root cause analysis of a latency spike requires correlating one trace ID, not grepping logs across five pods.

- **JVM metrics** in Prometheus: heap usage, GC pause durations, thread pool saturation, and DB connection pool utilisation are auto-collected. Grafana dashboards alert before OOM errors occur.

- **Structured logs** in Kibana: logs from all five services are centrally aggregated, indexed, and searchable. A distributed transaction ID can find every log line across every service in one query.

The overhead optimisation (40–60% reduction vs default) was achieved by disabling experimental features and tuning sampler configuration — production observability must not noticeably degrade the service it observes. 

---

## Pillar 6: Zero-Trust Service Networking

In a default Kubernetes cluster, every pod can talk to every other pod. This violates the principle of least privilege and creates a large blast radius if any single service is compromised.

ShopEase implements **zero-trust NetworkPolicies**: every service is isolated by default, with explicit ingress and egress rules for each permitted communication path.

### The Policy Model

```
Default posture: deny all ingress and egress for all pods
         │
         ▼ Explicit exceptions:
┌─────────────────────────────────────────────────────────────────┐
│                    Allowed Communication Paths                  │
│                                                                 │
│  NGINX Ingress → frontend           (port 3000)                 │
│  NGINX Ingress → user-service       (port 8080)                 │
│  NGINX Ingress → product-service    (port 3001)                 │
│  NGINX Ingress → order-service      (port 8081)                 │
│                                                                 │
│  frontend → user-service            (JWT validation proxy)      │
│  frontend → product-service         (catalogue proxy)           │
│  frontend → order-service           (cart/order proxy)          │
│                                                                 │
│  order-service → notification-svc   (order confirmation)        │
│  order-service → product-service    (inventory reservation)     │
│                                                                 │
│  All services → Oracle/PG/MSSQL     (own database only)         │
│  All services → OTEL Collector      (telemetry egress)          │
└─────────────────────────────────────────────────────────────────┘
```

### What Zero-Trust Prevents

If the `notification-service` were compromised — say, through a dependency vulnerability — it cannot lateral move to query the `users` Oracle database or place orders on behalf of users. Its NetworkPolicy limits egress to the SMTP endpoint and the OTel collector only. East-west movement is blocked at the kernel level.

This is a security control that operates independently of application-layer JWT validation. Even if a JWT were forged or stolen, a compromised pod still cannot route directly to a database it has no NetworkPolicy permission to reach.

---

## The System as a Whole

These six pillars are not independent concerns — they reinforce each other:

- DDD boundaries make contract tests meaningful (each service has a clear, testable API surface)
- Polyglot persistence is possible because each service owns its database (no shared schema to coordinate)
- Contract tests catch drift before deployment (CI governance)
- Zero-trust networking enforces the bounded context at the infrastructure level
- Auto-instrumentation gives full-stack visibility without requiring each service team to maintain SDK boilerplate

Platform engineering is the discipline of building systems that are **independently deployable, jointly observable, and collectively trustworthy**. Each technical decision in ShopEase exists to serve one of those three properties.

---

## Platform Metrics

| Dimension | Value |
|-----------|-------|
| **Services** | 4 backend + 1 frontend |
| **Test layers** | 5 (unit → frontend unit → integration → API contracts → E2E) |
| **Total tests** | 330+ across all layers |
| **Code coverage** | 85%+ aggregate (target: 90%) |
| **Integration test approach** | Testcontainers (real Oracle, PostgreSQL, MSSQL in CI) |
| **Deployment time** | ~5 minutes end-to-end (GitHub push → live on Kubernetes) |
| **Observability signals** | Traces (Jaeger), Metrics (Prometheus/Grafana), Logs (ECK) |
| **Database engines** | Oracle DB 23c, PostgreSQL 17, MS SQL Server 2022 |

---

## What I Would Do Differently

**Async event bus over synchronous order→notification calls.** The current `order-service` → `notification-service` path is synchronous HTTP. For production, this should be a message queue (Kafka or RabbitMQ) with at-least-once delivery guarantees. A slow SMTP server should not add latency to the checkout response.

**Saga pattern for distributed transactions.** The checkout flow spans order creation and inventory reservation. Currently, a failure between these steps requires manual reconciliation. A choreography-based saga with compensating transactions would make this self-healing.

**HashiCorp Vault for secret management.** Kubernetes Secrets are base64, not encrypted at rest by default. Vault with dynamic credentials would give short-lived, auto-rotated database passwords without any secret ever sitting in a manifest file.

---

## Resources

- [ShopEase GitHub Repository](https://github.com/kunlecreates/shop-ease-enterprise-app)
- [Live Platform](https://shop.kunlecreates.org)
- [DB-as-a-Service Kubernetes Deployments](/projects/shopease/)
- [Observability Stack Deep Dive](/projects/observability-stack/)
- [CI/CD Helm Deployment](/2025/06/18/ci-cd-helm-deployment/)

---

*Questions about any of the architectural decisions, or want to discuss platform engineering patterns? [Email me](mailto:info.cideveloper@gmail.com) or [connect on GitHub](https://github.com/kunlecreates).*
