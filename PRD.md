---

# Product Requirements Document (PRD)

**Real Estate Rental Platform — Integrated Listings, Messaging, Media, and Social Ecosystem**

---

## 1. Purpose and Vision

Build a scalable, modular platform combining verified real estate listings, dynamic landlord and
renter communication, and interactive community social media—all unified by centralized media
management and a consistent property hierarchy. The platform targets landlords managing multiple
communities and properties of varying composition and engages renters through rich, real-time
communication and community features.

---

## 2. Architectural Overview

### 2.1 Infrastructure Stack

```
Internet (HTTPS)
   ↓
Ingress Controller (Nginx)
   ├─ TLS Termination (Let's Encrypt via cert-manager)
   ├─ L7 Routing (api.yoursite.com/*)
   ├─ WebSocket Upgrade (for real-time messaging)
   └─ DDoS Protection & Rate Limiting
      ↓
Ocelot API Gateway (ClusterIP Service)
   ├─ JWT Authentication & Authorization
   ├─ Service-Level Rate Limiting
   ├─ Request Routing & Load Balancing
   ├─ Swagger Aggregation (MMLib.SwaggerForOcelot)
   └─ OpenTelemetry Tracing Integration
      ↓
Microservices (ClusterIP - Internal Only):
   ├─ account-service:3000     (User management, authentication)
   ├─ messaging-service:3001   (Real-time chat, WebSocket)
   ├─ listings-service:3002    (Property hierarchy, search)
   └─ social-service:3003      (Community posts, events)
      ↓
Data Layer (StatefulSets):
   ├─ PostgreSQL 18 + PostGIS (Multi-tenant databases)
   ├─ Redis/Valkey 9.0 (Pub/Sub, caching, rate limiting)
   └─ ElasticSearch (Search indexing)

Monitoring (External - Secured):
   └─ Jaeger UI (jaeger.{env}.domain.com)
      ├─ TLS via cert-manager (Let's Encrypt ACME)
      ├─ BCrypt Basic Authentication (htpasswd)
      ├─ Security Headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
      └─ Session Affinity for consistent UI experience
```

### 2.2 Service Responsibilities

| Service              | Technology & Role                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingress Controller   | Nginx Ingress Controller for HTTPS termination, external routing, WebSocket support, and certificate management via cert-manager                                              |
| API Gateway          | Ocelot (.NET 9.0) for internal service routing, JWT auth, rate limiting, and Swagger aggregation                                                                              |
| Account Service      | Node.js + Express + PostgreSQL for managing user profiles, roles, and authentication                                                                                          |
| Listings Service     | Node.js + Express + PostgreSQL to handle Communities → Properties → Units → Listings hierarchy                                                                                |
| Messaging Service    | Node.js + Express + WebSocket + PostgreSQL + Redis for real-time multi-user chat with persistent storage                                                                      |
| Social Media Service | Node.js + Express + PostgreSQL + ElasticSearch for community posts, comments, events with scoped visibility                                                                   |
| Media Storage        | AWS S3 with presigned URLs for all media files (listings, messages, posts, profile images)                                                                                    |
| Observability        | Jaeger 1.76.0 all-in-one with BadgerDB persistence, externally accessible via Ingress with BCrypt auth, TLS termination, and security headers for production-grade monitoring |
| Shared Libraries     | TypeScript across frontend/backend using Nx for shared models and utilities                                                                                                   |

---

## 3. Domain & Property Model

- **Community:** Higher-level entity grouping multiple properties managed together.
- **Property:** Physical building or standalone home related to one community.
- **Unit:** Subdivision of a property (e.g., apartment unit); optional for single-family homes.
- **Listing:** Rental or sale offer linked to a `property_id` and optionally to a `unit_id`.

Supports flexible composition: townhomes or single-family homes (property only), or multi-unit
buildings.

---

## 4. Messaging System Design

### 4.1 Data Model

All keys as UUIDs for scale.

| Table                           | Key Columns & Purpose                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `messaging.chats`               | `id`, `name`, `is_group_chat`, `profile_image_url`, `created_by`, timestamps                                    |
| `messaging.chat_participants`   | `chat_id`, `user_id`, `role`, `joined_at`                                                                       |
| `messaging.messages`            | `id`, `chat_id`, `sender_id`, `reply_to`, `message_type ENUM`, `text`, `created_at`, `updated_at`, `is_deleted` |
| `messaging.message_recipients`  | `message_id`, `receiver_id`, `status ENUM (DELIVERED, READ)`, `read_at`, `deleted`                              |
| `messaging.message_attachments` | `id`, `message_id`, `media_id` (S3 reference), `file_name`, `mime_type`, `size`, `created_at`                   |

### 4.2 Business Rules and Validation

- On message creation, validate `message_type` with payload content:
  - `'TEXT'`: non-empty `text`, no attachments.
  - `'MEDIA'`: attachments present, `text` empty/null.
  - `'TEXT_AND_MEDIA'`: both present.
  - `'SYSTEM'`: textual system info; NO attachments.
- Prevent empty messages (neither text nor attachments).
- System messages stored in `text` field with `message_type = 'SYSTEM'`.

### 4.3 Functional Specs

- Real-time message delivery via WebSockets with Redis Pub/Sub for scalability.
- Read and delivery receipts stored per recipient accurately.
- Soft delete support on both sender and receiver sides.
- Multiple attachments per message handled asynchronously, stored in S3 referenced by
  `message_attachments`.

---

## 5. Social Media and Community Features

- Community-scaled posts, comments, and events with scopes: Community, Property, Unit.
- Media attachments via centralized S3 with metadata linking.
- Role-based access controlling visibility and posting rights (landlord, assistant, renter).
- Real-time update streams via Pub/Sub to frontend clients.

---

## 6. Media Storage Strategy

- Unified media store on AWS S3 with versioning and lifecycle policies.
- All media uploads done via presigned URLs.
- Metadata stored in platform-wide `media_files` table linking to chats, listings, posts, user
  profiles.
- Enforced security with IAM roles, encryption, and transient access links.

---

## 7. API and Integration Contracts

- Account service manages users, roles, and JWT tokens.
- Listings service provides CRUD for communities, properties, units, listings with hierarchical
  queries.
- Messaging service exposes REST and WebSocket endpoints for chat lifecycle, message CRUD, and
  delivery management.
- Social media service handles posts, comments, events REST APIs with filtering by scope.
- Media upload service generates presigned URLs and links metadata.

---

## 8. Non-Functional Requirements

| Category        | Requirement                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Latency         | Sub-2 seconds response for listings and feeds. Sub-1 second for chat messages.                                             |
| Scalability     | Horizontally scalable microservices using Kubernetes/Docker.                                                               |
| Reliability     | 99.9% uptime with redundant message delivery confirmation.                                                                 |
| Security        | TLS everywhere, encrypted storage, strong RBAC enforcement.                                                                |
| Observability   | Distributed tracing with <1% performance overhead, 95th percentile latency tracking, automatic service dependency mapping. |
| Maintainability | Nx monorepo with CI/CD automation and shared TypeScript codebases.                                                         |

---

## 9. Metrics and Success Criteria

- ≥99.9% message delivery success.
- 60% 30-day user retention.
- Average read receipt accuracy 100%.
- Post engagement with >30% of active users.
- Seamless listing-to-lease conversion tracking.

---

## 10. AI Agent Deliverables for Implementation

- Autogenerate database schema migration scripts with new UUID keys, enums, indices, and
  constraints.
- Scaffold backend REST and WebSocket APIs for Messaging, Listings, Social feeds with exact
  parameter and response shape.
- Setup presigned URL generation for media upload and link attachments consistently.
- Build shared TypeScript models with validation logic reflecting messaging content rules.
- Automate Nx build and integration testing pipelines, focusing on dependencies and side effects.
- Provide documentation on hierarchical data usage for Community → Property → Unit → Listing →
  Messaging scoping.
- Configure OpenTelemetry auto-instrumentation for all services with zero-code-change integration.
- Deploy Jaeger as optional observability sidecar (services function independently if unavailable).

---

This comprehensive PRD integrates all previously discussed architectural, database, and functional
improvements into a clear roadmap for AI‑augmented development and deployment.

If you want, detailed implementation stories or a code generation prompt can be created next as
fine-grained increments.
