# Local Kubernetes Podman Development: Image Pull & Access Troubleshooting

## Known Issues

- Podman/Minikube local setup may fail to pull some images (e.g., PostGIS, Valkey, Alpine) due to TLS certificate verification failures.
- Even with correct registry config, images must be loaded manually using the Podman machine.
- This is a known limitation of Podman Desktop's Kubernetes cluster and does not affect cloud deployments.

## Manual Steps Required for Local Development with Podman

### 1. Manually Pull and Load Required Images

For local development with Podman, you must manually pull and load the following images if any pods are stuck in `ImagePullBackOff` or `ContainerCreating` status:

**A. Kindnetd (CNI):**

```sh
podman machine ssh 'podman pull docker.io/kindest/kindnetd:v20250512-df8de77b'
minikube image load docker.io/kindest/kindnetd:v20250512-df8de77b --profile=myapp-podman-local
```

**B. PostGIS/Postgres:**

```sh
podman machine ssh 'podman pull docker.io/postgis/postgis:18-3.6'
minikube image load docker.io/postgis/postgis:18-3.6 --profile=myapp-podman-local
```

**C. Alpine (Redis init container):**

```sh
podman machine ssh 'podman pull docker.io/library/alpine:3.19'
minikube image load docker.io/library/alpine:3.19 --profile=myapp-podman-local
```

**D. Valkey/Redis:**

```sh
podman machine ssh 'podman pull docker.io/valkey/valkey:9.0-alpine'
minikube image load docker.io/valkey/valkey:9.0-alpine --profile=myapp-podman-local
```

**E. Jaeger (OpenTelemetry All-in-One):**

```sh
podman machine ssh 'podman pull docker.io/jaegertracing/opentelemetry-all-in-one:latest'
minikube image load docker.io/jaegertracing/opentelemetry-all-in-one:latest --profile=myapp-podman-local
```

**Check loaded images:**

```sh
# List all loaded images in the profile
minikube image ls --profile=myapp-podman-local

# Check for specific images (Windows)
minikube image ls --profile=myapp-podman-local | findstr "postgis valkey jaeger"

# Check for specific images (Linux/macOS)
minikube image ls --profile=myapp-podman-local | grep -E "postgis|valkey|jaeger"
```

Check pod status after loading images:

```sh
kubectl get pods -A
```

### 2. Port Forwarding for Local Access

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

_Last updated: 2025-12-07_
