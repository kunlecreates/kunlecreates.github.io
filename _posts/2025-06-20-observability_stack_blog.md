---
layout: post
title: "Designing a Production-Grade Observability Stack on Kubernetes" 
date: 2025-06-17
tags: [Kubernetes, Observability, OpenTelemetry, Prometheus, Grafana, Jaeger, ECK, DevOps]
read_time: 4
---

# Building a Production-Grade Observability Stack on Kubernetes

In modern DevOps practices, **observability isn't optional, it is foundational.** While monitoring tells you when something is wrong, observability tells you *why*. In this post, I share how I engineered and deployed a robust observability stack on Kubernetes, tailored for **real-world production workloads**, secured with **Zero Trust access**, and modularly automated using **Helm**.

This was part of a broader initiative to demonstrate end-to-end DevOps thinking: instrumentation, deployment automation, secure access, and performance tuning.

## Project Objective

To build a cloud-native observability system with **full coverage across logs, metrics, and traces** that can scale with microservice applications, support multi-tenant deployments, and reflect best practices in both **architecture and operations**.

## Why Observability Matters

With applications decomposed into dozens (or hundreds) of services, visibility becomes a critical engineering concern. My goal was to enable:

- **Proactive alerting** across infrastructure and app tiers
- **Traceability** of service-to-service calls for debugging latency
- **Log aggregation** for centralized auditing and compliance
- **Secure dashboard access** for internal and remote teams

## Architecture Overview

The observability stack includes:

- **OpenTelemetry Collector**: Aggregates traces from instrumented services of an application
- **Jaeger**: Trace storage and visualization
- **Prometheus**: Metric scraping and storage
- **Grafana**: Metric visualization and alerting
- **Elasticsearch & Kibana (ECK)**: Log aggregation and analysis
- **Cloudflare Zero Trust**: Secure access via OAuth
- **Ingress NGINX**: Exposes services externally with TLS via my Cloudflare tunnel setup



## Deployment Strategy

### 1. Namespace Isolation

Each component is deployed to its own namespace for modular management and resource isolation such as:

- `observability-system`
- `opentelemetry-system`
- `elastic-system`
- `prometheus-system`

### 2. Helm-Powered Installations

I used **Helm 3** and curated `values.yaml` files to drive declarative deployments. Key highlights:

- **OpenTelemetry Collector** installed with the OpenTelemetry Operator
- **Jaeger Operator** deployed with production strategy (`jaeger-all-in-one` avoided)
- **Prometheus Operator** manages both Prometheus and Alertmanager
- **Grafana** customized with dashboards
- **Elasticsearch + Kibana** bootstrapped using Elastic Cloud on Kubernetes (ECK)

> All Helm releases were stored in a version-controlled GitHub repo to allow reproducibility and team collaboration.

### 3. Security Layer

- Access to the Grafana, Kibana, and Jaeger dashboards was **locked behind Cloudflare Zero Trust**, authenticated via GitHub or Google OAuth — no public endpoints, no basic auth, no exposure. 
- Ingress NGINX handles TLS termination via Cloudflare tunnel.
- Secrets are managed via Kubernetes `Secret` objects (future: migrate to Vault)

## Stack Components Deep Dive

### OpenTelemetry Collector

Configured for multi-signal routing using `receivers` and `exporters`. Traces sent to Jaeger via gRPC, metrics pushed to Prometheus, and logs enriched and forwarded to ECK.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
exporters:
  jaeger:
    endpoint: jaeger-collector.observability.svc:14250
```

### Prometheus + Grafana

Prometheus scrapes metrics from services and kubelets. Grafana is pre-configured with:

- CPU/memory dashboards
- Service-specific metrics
- Jaeger trace embedding

### ECK (Elasticsearch & Kibana)

- Elasticsearch cluster: 1 node (dev), auto-scalable
- Logs ingested via Elastic's OpenTelemetry distribution (EDOT)
- Kibana dashboards for logs per service

## What This Demonstrates

This project wasn’t just about standing up a monitoring stack; it was about end-to-end observability engineering:

- Architectural thinking: how telemetry flows across a distributed system
- Security maturity: protecting dashboards and backend systems
- Deployment automation: reproducible, Helm-powered infrastructure
- Real-world constraints: tuning performance, cleanup strategies, etc.

It reflects my approach to DevOps: design with scale, security, and simplicity in mind.

## Resources & Tools

- Helm charts (customized, available upon request)
- [OpenTelemetry.io](https://opentelemetry.io/)
- [Grafana Labs](https://grafana.com/)
- [Jaeger](https://www.jaegertracing.io/)
- [ECK](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s)
- [EDOT](https://www.elastic.co/docs/solutions/observability/get-started/quickstart-unified-kubernetes-observability-with-elastic-distributions-of-opentelemetry-edot)

## Next Steps

This observability stack now powers my entire applications deployment stack, allowing trace visualization, dashboarding, and real-time logs for each application service. It provides full insight into microservice-based applications. With proactive alerting, distributed tracing, and structured logging, issues are caught earlier and resolved faster. For a live demo or Helm access, feel free to [contact me](mailto\:info.cideveloper@gmail.com).

---

Want to learn how this integrates with my Twitter-Clone microservice app? [Check out the walkthrough here](https://kunlecreates.org/projects/twitter-clone/).

