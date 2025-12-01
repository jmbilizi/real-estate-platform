# Local Kubernetes Podman Development: Image Pull & Access Troubleshooting

## Known Issues

- Podman/Minikube local setup may fail to pull some images (e.g., PostGIS, kindnetd) due to registry or manifest issues.
- Even with correct registry config, some images must be loaded manually.

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
podman machine ssh 'podman pull docker.io/postgis/postgis:15-3.4'
minikube image load docker.io/postgis/postgis:15-3.4 --profile=myapp-podman-local
```

Check pod status after loading images:

```sh
kubectl get pods -A
```

### 2. Port Forwarding for Local Access

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

## Notes

- Port-forwarding is not persistent; must be re-run if terminal closes.
- For local development, only port-forwarding is supported (NodePort is not enabled).

---

_Last updated: 2025-12-01_
