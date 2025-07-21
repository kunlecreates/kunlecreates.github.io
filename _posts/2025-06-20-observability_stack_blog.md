---
layout: post
title: "Designing a Production-Grade Observability Stack on Kubernetes" 
date: 2025-06-17  
tags: [Kubernetes, Observability, OpenTelemetry, Prometheus, Grafana, Jaeger, ECK, DevOps]
---

Modern cloud-native applications demand deep visibility across every layer; the 3-prong pillar of application signals notably called "Telemetry" which are logs, metrics, and traces, ensure reliability, security, and performance. In this post, I walk through how I designed and deployed a production-grade observability stack on Kubernetes that brings full-stack visibility to a distributed microservice ecosystem.

## Why Observability Matters

As systems scale and become more distributed, debugging issues with just logs or metrics becomes insufficient. Observability brings the said three pillars — **metrics**, **logs**, and **traces** — into a single pane of glass, giving developers and DevOps engineers the ability to:

- Pinpoint the root cause of latency or failures
- Understand service-to-service interactions
- Monitor and alert on critical business events

## Architecture Overview

The observability stack includes:

- **OpenTelemetry Collector**: Aggregates traces from instrumented services of an application
- **Jaeger**: Trace storage and visualization
- **Prometheus**: Metric scraping and storage
- **Grafana**: Metric visualization and alerting
- **Elasticsearch & Kibana (ECK)**: Log aggregation and exploration
- **Cloudflare Zero Trust**: Secures access to dashboards and deployed backend application services
- **Ingress NGINX**: Exposes services externally with TLS via my Cloudflare tunnel setup



## Deployment Strategy

### 1. Namespace Isolation

Each component is deployed to its own namespace for modular management and resource isolation such as:

- `observability-system`
- `opentelemetry-system`
- `elastic-system`
- `prometheus-system`

### 2. Helm-Powered Installations

Helm charts and custom `values.yaml` files drive the automation:

- **OpenTelemetry Collector** installed with the OpenTelemetry Operator
- **Jaeger Operator** deployed with production strategy (`jaeger-all-in-one` avoided)
- **Prometheus Operator** manages both Prometheus and Alertmanager
- **Grafana** customized with dashboards
- **Elasticsearch + Kibana** bootstrapped using Elastic Cloud on Kubernetes (ECK)

### 3. Security and Routing

- **Ingress NGINX** handles routing and TLS termination
- **Cloudflare Zero Trust** integrates with GitHub or Google OAuth
- Secrets are managed via Kubernetes `Secret` objects (future: migrate to Vault)

## 🔍 Stack Components Deep Dive

### OpenTelemetry Collector

Custom receiver pipelines deployed using the Elastic Distribution of Opentelemetry (EDOT) forward traces to Jaeger via gRPC, metrics to Prometheus/Grafana, and logs to the Elastic stack (ECK):

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
- Elastic Distribution of Opentelemetry (EDOT) implemented to aggregate Opentelemetry Collector logs before delivery to the ECK Elasticsearch cluster
- Kibana dashboards for logs per service

## Lessons Learned

- **CRDs & Cleanup**: Stuck CRDs can block redeployments. Ensuring the use of cleanup scripts handle these seamlessly.
- **Securing Dashboards**: Cloudflare Zero Trust is crucial for securing Grafana, Kibana, Jaeger.
- **Instrumentation**: Automate instrumentation of application services using OpenTelemetry SDKs per language.
- **Performance**: Resource limits must be set per collector; Jaeger's memory config is sensitive. The Jaeger instance deployed was version 2, which is now easily deployed using the Opentelemetry Collector.

## Resources & Tools

- Helm charts (customized, available upon request)
- Architecture diagrams ([private repo](https://github.com/kunlecreates))
- [OpenTelemetry.io](https://opentelemetry.io/), [Grafana Labs](https://grafana.com/), [Jaeger](https://www.jaegertracing.io/), [ECK](https://www.elastic.co/docs/deploy-manage/deploy/cloud-on-k8s)
- [EDOT](https://www.elastic.co/docs/solutions/observability/get-started/quickstart-unified-kubernetes-observability-with-elastic-distributions-of-opentelemetry-edot)

## Conclusion

This observability stack provides full insight into microservice-based applications. With proactive alerting, distributed tracing, and structured logging, issues are caught earlier and resolved faster. For a live demo or Helm access, feel free to [contact me](mailto\:info.cideveloper@gmail.com).

---

Want to learn how this integrates with my Twitter-Clone microservice app? [Check out the walkthrough here](https://kunlecreates.org/projects/twitter-clone/).

