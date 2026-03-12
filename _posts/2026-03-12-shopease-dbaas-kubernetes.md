---
layout: post
title: "Designing a Database-as-a-Service Layer for Kubernetes Microservices"
date: 2026-03-12
tags: [Platform Engineering, Database, Kubernetes, Polyglot Persistence, Oracle, PostgreSQL, MSSQL, MySQL, Security, DevOps]
read_time: 14
description: "A deep dive into the DBaaS provisioning layer built for ShopEase — deploying Oracle DB 23c, PostgreSQL 17, MS SQL Server 2022, and MySQL 8 InnoDBCluster on Kubernetes with automated schema lifecycle, least-privilege security, and namespace isolation."
---

# Designing a Database-as-a-Service Layer for Kubernetes Microservices

Most microservices architecture posts focus on the services. The database layer gets a footnote: "and each service has its own database." That footnote contains a substantial amount of engineering work that is rarely shown in detail.

This post covers the **Database-as-a-Service (DBaaS) provisioning layer** I built for the ShopEase platform — a production-grade Kubernetes deployment of four different relational database engines, each matched to the bounded context that owns it, with automated schema lifecycle management and security provisioning baked in from day one.

> **Repository**: [DB-K8S-Deploy](https://github.com/kunlecreates/shop-ease-enterprise-app) &nbsp;|&nbsp; **Platform**: [ShopEase on Kubernetes](/projects/shopease/)

---

## Why a Dedicated Database Layer?

The database-per-service pattern is straightforward to state: *each microservice owns its data exclusively and no other service may access that database directly*. Implementing it in Kubernetes — with production-grade security, repeatable provisioning, and a clear schema lifecycle — is where the engineering work happens.

The DBaaS layer in ShopEase addresses four production concerns:

1. **Provisioning consistency** — every database deploys using its canonical, operator-driven or Helm-managed method, not ad-hoc scripts
2. **Schema lifecycle** — `deploy → schema-load → seed → rollback` is a predictable, single-command operation for every engine
3. **Security-by-default** — no committed credentials, dedicated least-privilege application users, ClusterIP-only exposure
4. **Namespace isolation** — one Kubernetes namespace per engine, enforcing the service boundary at the infrastructure level

---

## Architecture: Four Engines, Four Bounded Contexts

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                    ShopEase Enterprise Microservices                     │
 ├────────────────────────┬──────────────────────┬──────────────────────────┤
 │      user-service      │   product-service    │      order-service       │
 │  auth · RBAC · tokens  │  catalogue · SKUs ·  │  carts · orders ·        │
 │  refresh · login audit │  inventory · search  │  payments                │
 └───────────┬────────────┴──────────┬───────────┴────────────┬─────────────┘
             │                       │                        │
             ▼                       ▼                        ▼
 ┌───────────────────┐   ┌───────────────────┐   ┌────────────────────────┐
 │  Oracle DB 23c    │   │   PostgreSQL 17   │   │   SQL Server 2022      │
 │  Free Edition     │   │   Bitnami Helm    │   │   StatefulSet          │
 │  oracle-system    │   │   postgres-system │   │   mssql-system         │
 │  Port: 1521       │   │   Port: 5432      │   │   Port: 1433           │
 └───────────────────┘   └──────────┬────────┘   └────────────────────────┘
                               (or alternate)
                          ┌─────────▼─────────┐
                          │    MySQL 8.4      │
                          │   InnoDBCluster   │
                          │   mysql-system    │
                          │  Port: 6446 (RW)  │
                          └───────────────────┘
```

The key architectural constraint: **cross-service data references use opaque string keys** (`user_ref`, `product_ref`) — never database-level foreign keys. Services communicate via APIs. Each database enforces consistency strictly within its own bounded context.

---

## Engine Selection: Why Not Just PostgreSQL Everywhere?

Using one engine for everything is operationally simpler. It is also a best-fit compromise for every domain. The ShopEase engine selection follows one rule: **choose the database that is the best fit for the bounded context it serves**.

### Oracle Database 23c Free → user-service

The user service manages identity: registration, login, JWT lifecycle, email verification tokens, password reset tokens, and login audit history.

**Why Oracle?**
- The `IS JSON` constraint on the `domain_events` column (transactional outbox) is native to Oracle 23c and enforces JSON validity at the database level — no application-layer validation needed
- Oracle's `MERGE` statement provides the cleanest idempotent upsert pattern for seeding baseline roles (`customer`, `admin`)
- The `login_audit` table provides security incident investigation capability that integrates naturally with Oracle's existing enterprise audit infrastructure
- For a domain with complex token lifecycle requirements (hash storage, expiry tracking, revocation timestamps), Oracle's mature PL/SQL ecosystem offers reliable procedural options

The schema uses a `USER_SVC` schema qualifier in `FREEPDB1`, deployed via the Oracle Database Operator's `SingleInstanceDatabase` Custom Resource — the canonical Kubernetes-native way to run Oracle.

### PostgreSQL 17 → product-service

The product service manages the catalogue: SKUs, categories, inventory levels, and stock movement audit.

**Why PostgreSQL?**
- Native `TSVECTOR` full-text search with a `BEFORE INSERT OR UPDATE` trigger maintaining a `search_vector` column automatically. Full-text search is first-class, not bolted on via `LIKE` queries
- `JSONB` for the `attributes` column (per-product flexible metadata: size, colour, unit) — queryable JSON without `VARCHAR` hacks, with GIN index support
- `ON CONFLICT DO UPDATE` for idempotent seed loading — 10 grocery products with inventory can be seeded repeatedly without duplicate errors
- The NestJS/TypeScript stack has the deepest ORM ecosystem for PostgreSQL (TypeORM, Prisma)

Deployed via the Bitnami PostgreSQL Helm chart with optional HA mode (`postgresql-ha` with Pgpool-II and Repmgr) controlled by a single `HA=true` environment variable.

### MS SQL Server 2022 → order-service

The order service manages the shopping and fulfilment lifecycle: carts, orders, payment records, and shipping addresses.

**Why SQL Server?**
- The `order_svc` schema qualifier enforces the service boundary at the database level — `GRANT EXECUTE ON SCHEMA::order_svc TO order_service_role` limits the app user to exactly its own schema, nothing else
- SQL Server's `NCHAR(3)` for the `currency` column and `BIGINT` for `price_cents` fit the financial transaction requirement cleanly
- Spring Boot's `spring-boot-starter-data-jpa` + the MSSQL JDBC driver is a well-tested combination; Testcontainers provides a `mcr.microsoft.com/mssql/server` container for integration tests against the real engine
- SQL Server 2022's Developer Edition is fully-featured with no production restrictions — appropriate for a production-pattern reference implementation

Deployed as a Kubernetes `StatefulSet` (not via an operator) — intentionally, to demonstrate the manifest-level Kubernetes primitives alongside the operator-managed deployments.

### MySQL 8.4 InnoDBCluster → product-service (alternative)

MySQL is provided as an alternative to PostgreSQL for the product service, demonstrating the same bounded context on a different engine.

**Why MySQL as an alternative?**
- Demonstrates that the database-per-service pattern is engine-agnostic — the same domain can be served by different persistence technologies
- MySQL's `FULLTEXT` index on `name` and `description` gives full-text search parity with PostgreSQL's `TSVECTOR` approach, using engine-native indexing
- The `InnoDBCluster` via MySQL Operator gives cluster topology (StatefulSet + Router) managed by a Kubernetes Custom Resource
- `REQUIRE SSL` on the app user enforces encrypted client connections at the database level — a security control that is explicit and verifiable

---

## The Schema Lifecycle: deploy → schema-load → seed → rollback

Every engine follows the same four-phase lifecycle, implemented as a set of shell scripts per engine:

```
Phase 1: deploy-{engine}.sh
         └── Provisions the database instance (namespace, secrets, PVC, workload)

Phase 2: load-{engine}-schemas.sh
         ├── schema.sql    — Creates all tables, indexes, constraints
         ├── security.sql  — Creates least-privilege app user, grants CRUD-only
         └── Verifies the schema applied cleanly (row counts, table existence)

Phase 3: seed-{engine}.sh (where applicable)
         └── 01-seed.sql  — Idempotent baseline data (roles, product catalogue)

Phase 4: cleanup-{engine}.sh
         └── Removes namespace, PVCs, and secrets (controlled by feature flags)
```

### Rollback Design

Each schema directory includes a `02-rollback.sql` that reverses the `01-seed.sql` changes cleanly. This is not just a `DROP TABLE` — it accounts for foreign key ordering, partial applies, and idempotency.

---

## Security: The Full Model

Security is designed in — not added after provisioning. The model rests on four principles:

### 1. No Committed Credentials

Every credential is injected at runtime. Scripts read admin passwords interactively (`read -s`) or fetch them directly from the Kubernetes `Secret` object:

```bash
# Fetch the SA password from the cluster secret — no typing, no files
SA_PASSWORD=$(kubectl -n mssql-system get secret mssql-secret \
  -o jsonpath='{.data.SA_PASSWORD}' | base64 --decode)
```

### 2. In-Memory Password Substitution

Security SQL scripts contain a `REPLACE_WITH_STRONG_PASSWORD_HERE` placeholder. At provisioning time, it is substituted via a `sed` pipeline — the password is never written to disk, never appears in `ps aux` output, and is `unset` immediately after use:

```bash
read -s -p "Enter app user password: " APP_PWD; echo
sed "s/REPLACE_WITH_STRONG_PASSWORD_HERE/${APP_PWD}/g" security.sql \
  | sqlcmd -C -S 127.0.0.1 -U sa -P "${SA_PASSWORD}"
unset APP_PWD
```

This pattern eliminates three common credential leak vectors simultaneously: committed files, shell history, and process list arguments.

### 3. Least-Privilege Runtime Identities

Each service connects to its database as a dedicated, CRUD-only user. The runtime identity has no DDL rights — it cannot `CREATE`, `ALTER`, or `DROP` anything.

| Service | DB User | Permissions |
|---------|---------|-------------|
| `order-service` | `order_app` | `SELECT, INSERT, UPDATE, DELETE ON SCHEMA::order_svc` only |
| `product-service` (PG) | `product_app` | CRUD on all tables in `product_svc` schema |
| `product-service` (MySQL) | `product_app@%` | CRUD on `product_svc.*` + `REQUIRE SSL` |
| `user-service` (Oracle) | `USER_SVC_APP` | Object-level CRUD on `USER_SVC` tables + `CREATE SESSION` only |

Schema migrations run as a separate, time-bound migration account that is revoked after the migration completes.

### 4. ClusterIP-Only Exposure

No database port is reachable outside the cluster by default. The `SERVICE_TYPE` defaults to `ClusterIP`. Workstation access for development uses `kubectl port-forward` — a temporary, user-authenticated tunnel that closes when the session ends.

---

## Provisioning: Operator vs. StatefulSet vs. Helm

Each engine uses its **canonical Kubernetes deployment pattern**:

| Engine | Deployment Method | Why |
|--------|-------------------|-----|
| Oracle DB 23c | Oracle Database Operator + `SingleInstanceDatabase` CR | The Oracle-supported method; manages the complex CDB/PDB lifecycle via a Custom Resource |
| PostgreSQL 17 | Bitnami Helm chart | Mature, well-tested chart with built-in backup, metrics, and optional HA (Pgpool-II + Repmgr) |
| SQL Server 2022 | Kubernetes `StatefulSet` | Demonstrates raw Kubernetes primitives; no operator for MSSQL is tier-zero stable |
| MySQL 8.4 | MySQL Operator (`InnoDBCluster` CR) | Oracle's official operator manages cluster topology, failover, and routing |

The intentional mix of deployment methods is a design choice — a platform engineer should be comfortable with operators, Helm charts, and raw manifests, not just one abstraction layer.

---

## Namespace Isolation in Practice

Each engine lives in its own Kubernetes namespace:

```
oracle-system    → Oracle DB 23c (user-service database)
postgres-system  → PostgreSQL 17 (product-service database)
mssql-system     → SQL Server 2022 (order-service database)
mysql-system     → MySQL 8.4 (alternative product-service database)
```

This is not just organisational tidiness. Combined with the zero-trust `NetworkPolicy` design of the ShopEase platform, namespace isolation means:

- The `user-service` pod's NetworkPolicy permits egress to `oracle-system` only
- It cannot reach `mssql-system` or `postgres-system` — the route is blocked at the kernel level, not just the application level
- An attacker who compromises the product service cannot route to the users Oracle database even with valid SQL credentials, because the network path does not exist

The database namespace isolation and the application NetworkPolicy complement each other to create defence-in-depth at the data layer.

---

## Schema Design Highlights

### Monetary Values: Integer Cents Everywhere

All monetary columns use `BIGINT` for integer cents — never `DECIMAL` or `FLOAT`. Floating-point arithmetic on currency produces rounding errors that compound across transactions. `12345 cents` is unambiguous; `123.45` is not.

```sql
-- PostgreSQL: product-service
price_cents  BIGINT NOT NULL CHECK (price_cents >= 0)

-- SQL Server: order-service  
unit_price_cents  BIGINT NOT NULL,
total_cents       BIGINT NOT NULL,
currency          NCHAR(3) NOT NULL DEFAULT 'GBP'
```

### Immutable Audit Tables

Three tables across the schema are designed to be **append-only** by convention and by grant:

- `stock_movements` (product-service): every inventory change — delta, reason, context JSON
- `login_audit` (user-service): every authentication attempt — IP, user agent, outcome
- `order_items` (order-service): confirmed line items on a placed order

The application user is `INSERT`-only on these tables — `UPDATE` and `DELETE` are not granted. The audit trail cannot be retroactively altered.

### Address Snapshotting

The shipping address on `orders` is snapshotted at checkout time — five explicit columns (`shipping_name`, `shipping_line1`, `shipping_line2`, `shipping_city`, `shipping_postcode`) are written at order creation.

A customer updating their profile address never alters historical orders. This is the kind of design requirement that surfaces in production support incidents when it is missing.

### Token Hash Storage

Every token stored in the Oracle schema is stored as a **hash-only value** — the raw secret is never persisted:

- `refresh_tokens.token_hash` — bcrypt hash of the JWT refresh token
- `email_verification_tokens.token_hash` — bcrypt hash of the verification link token
- `password_reset_tokens.token_hash` — bcrypt hash of the reset link token

If the database is compromised, stolen token hashes cannot be reversed to valid tokens. Reset links expire even if the hash is exfiltrated.

---

## Configuration Reference

All deploy scripts accept environment variable overrides for key provisioning parameters:

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_CLASS` | cluster default | StorageClass for PVC provisioning |
| `PVC_SIZE` / `STORAGE_SIZE` | `8Gi` (`50Gi` for Oracle) | PVC capacity |
| `SERVICE_TYPE` | `ClusterIP` | `ClusterIP` / `NodePort` / `LoadBalancer` |
| `HA` | `false` | PostgreSQL: enables `postgresql-ha` with Pgpool-II + Repmgr |
| `MSSQL_PID` | `Developer` | SQL Server edition |
| `MYSQL_VERSION` | `8.4.0` | MySQL server version |
| `CHART_VERSION` | latest | Pin a Helm chart version for reproducibility |

---

## What I Would Do Differently in a Multi-Tenant Production Environment

**Vault dynamic credentials.** The current model uses long-lived Kubernetes Secrets for database passwords. In a production multi-tenant environment, HashiCorp Vault with the database secrets engine would provide short-lived, auto-rotating credentials — the app user password would be valid for 1 hour and auto-renewed, never stored anywhere permanently.

**Operator-managed schema migrations.** Schema migrations currently run as one-shot jobs initiated by the `load-*-schemas.sh` scripts. For a team environment, a GitOps-driven migration operator (Flyway Operator or Liquibase in a Kubernetes Job, triggered by CI) would make each migration an auditable, version-controlled event.

**Cross-engine backup coordination.** Each engine has independent backup tooling. A production platform would benefit from a unified backup orchestration layer with consistent RPO/RTO guarantees across all four engines.

---

## Summary

The DBaaS layer for ShopEase delivers what the database-per-service pattern actually requires in production:

| Concern | Solution |
|---------|----------|
| Engine selection | Best-fit per bounded context — Oracle (identity), PostgreSQL (catalogue/search), SQL Server (transactions), MySQL (alternative) |
| Provisioning | Canonical per engine — Oracle Operator, Bitnami Helm, StatefulSet, MySQL Operator |
| Schema lifecycle | `deploy → schema-load → seed → rollback` per engine, single-command |
| Credentials | Never committed; injected at runtime; in-memory substitution only |
| Runtime identity | Dedicated least-privilege user per service; no DDL rights |
| Isolation | One namespace per engine; ClusterIP-only; reinforced by NetworkPolicies |
| Audit | Immutable append-only tables for auth events, inventory changes, order line items |
| Data integrity | Integer cents, address snapshots, hash-only token storage |

The full provisioning scripts and SQL schemas are part of the [ShopEase repository](https://github.com/kunlecreates/shop-ease-enterprise-app). For a walkthrough of any specific engine or deployment pattern, [get in touch](mailto:info.cideveloper@gmail.com).

---

*Next in this series: [Building a Production-Grade Microservices Platform on Kubernetes](/2026/03/11/shopease-platform-engineering/) — the full architectural deep dive across all six engineering pillars.*
