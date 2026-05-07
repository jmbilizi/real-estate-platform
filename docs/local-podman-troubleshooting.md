# Local Kubernetes (Kind + Podman): Image Pull & Access Troubleshooting

This repo's local Kubernetes setup uses **Kind with the Podman provider** (see
`pnpm run infra:local:cluster:setup`).

## Common Failure Modes

- **ImagePullBackOff** for public images (PostGIS/Valkey/Jaeger/etc.)
  - Usually a TLS/CA issue inside the Podman VM or Kind nodes.
- **Local images not found** (your app image)
  - The image was built but not pushed to the local registry.

## Quick Fix Checklist

### 1) Re-sync certs and repair the cluster

Run the cluster bootstrapper again; it installs CA material and configures containerd registry
trust:

```sh
pnpm run infra:local:cluster:setup
```

Then re-apply base resources:

```sh
node tools/infra/run-skaffold.js run --port-forward --tail
```

Deploy `api-gateway` via Skaffold:

```sh
node tools/infra/dev-skaffold.js -- --cache-artifacts=false
```

### 2) Force a fresh Skaffold rebuild (for local app images)

If your service image isn’t showing up in-cluster:

```sh
node tools/infra/dev-skaffold.js -- --cache-artifacts=false
```

This repo’s custom Skaffold builder **pushes images to the persistent local registry** at
`localhost:5001`.

### 3) Manual image push to local registry (rare)

If you need to manually preload a public image for local use, push it into the local registry:

```sh
podman pull docker.io/postgis/postgis:18-3.6
pnpm run infra:local:registry:ensure
podman tag docker.io/postgis/postgis:18-3.6 localhost:5001/postgis/postgis:18-3.6
podman push localhost:5001/postgis/postgis:18-3.6
```

Then reference `localhost:5001/postgis/postgis:18-3.6` in your manifests (or re-run the cluster
setup to restore normal pull behavior).

## Diagnostics

```sh
kubectl get pods -A
kubectl describe pod <pod> -n <ns>
kubectl get events -A --sort-by=.lastTimestamp
```

## Port Forwarding (Manual)

**Postgres:**

To access Postgres from your host (e.g., Azure Data Studio):

1. Forward the port:
   ```sh
   kubectl port-forward service/postgres-serv 5432:5432
   ```
2. In your client, use:
   - **Server name:** localhost
   - **Port:** 5432
   - **Username:** postgres_sa
   - **Password:** (from secret)
   - **Database:** appdb

**Redis:**

To access Redis from your host:

1. Forward the port:
   ```sh
   kubectl port-forward service/redis-svc 6379:6379
   ```
2. Connect using redis-cli:
   ```sh
   redis-cli -h localhost -p 6379 --user admin --pass "StrongBase64Password"
   ```

**Jaeger:**

To access Jaeger UI from your host:

1. Forward the port:
   ```sh
   kubectl port-forward service/jaeger-svc 16686:16686
   ```
2. Open in browser:
   ```
   http://localhost:16686
   ```
3. Available endpoints:
   - **UI:** `http://localhost:16686` (web interface for viewing traces)
   - **OTLP gRPC:** Port 4317 (for service instrumentation)
   - **OTLP HTTP:** Port 4318 (for service instrumentation)

## Notes

- Port-forwarding is not persistent; must be re-run if terminal closes.
- For local development, only port-forwarding is supported (NodePort is not enabled).

---

_Last updated: 2026-02-07_
