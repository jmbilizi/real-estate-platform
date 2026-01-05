# Nginx Ingress Implementation Summary

## ✅ What Was Implemented

### 1. **Centralized K8s Structure**

All Kubernetes manifests now live in `infra/k8s/` - infrastructure together in one place.

### 2. **Architecture Pattern**

**Current Setup:** Infrastructure ingress only (Jaeger monitoring)

**Planned Pattern:** API Gateway as centralized entry point

- External requests → Nginx Ingress → API Gateway (Ocelot) → Microservices
- Responsibilities: JWT auth, rate limiting, request routing, circuit breaking
- Benefits: Single point of control, unified API versioning, centralized security

### 3. **Nginx Ingress Controller** (Infrastructure)

- Remote reference in `base/kustomization.yaml` → Official Kubernetes manifest (v1.11.1)
- Provider-agnostic, works everywhere (Podman, Hetzner, AWS, Azure)
- Automatically deployed with infrastructure

### 3. **Jaeger Ingress** (External Access to Monitoring)

- Base: `infra/k8s/base/ingresses/jaeger.ingress.yaml` (HTTP routing to jaeger-svc)
- Dev: `infra/k8s/hetzner/dev/patches/ingresses/jaeger.ingress.yaml` (jaeger.dev.localhost)
- Test: `infra/k8s/hetzner/test/patches/ingresses/jaeger.ingress.yaml` (HTTPS + staging cert)
- Prod: `infra/k8s/hetzner/prod/patches/ingresses/jaeger.ingress.yaml` (HTTPS + production cert + basic auth)

### 4. **Hetzner K3s Configuration**

Disabled built-in Traefik in all 3 environments (dev/test/prod):

```yaml
k3s_server_args:
  - "--disable=traefik"
```

---

## 📁 File Structure

```
infra/k8s/base/
├── nginx-ingress/
│   └── README.md                                # Documentation
├── ingresses/
│   └── jaeger.ingress.yaml                      # Base routing rules for Jaeger
├── services/
│   ├── postgres.service.yaml
│   ├── redis.service.yaml
│   └── jaeger.service.yaml
├── statefulsets/
│   ├── postgres.statefulset.yaml
│   ├── redis.statefulset.yaml
│   └── jaeger.statefulset.yaml
└── kustomization.yaml

infra/k8s/hetzner/{dev,test,prod}/
├── patches/
│   ├── statefulsets/
│   │   └── ... (resource/storage overrides)
│   └── ingresses/
│       └── jaeger.ingress.yaml                  # Environment-specific domains
├── cluster/
│   └── cluster-config.yaml                      # K3s configuration (Traefik disabled)
└── kustomization.yaml
```

---

## 🔄 Request Flow

```
External User
   ↓
https://jaeger.yoursite.com (or jaeger.dev.localhost in dev)
   ↓
Nginx Ingress Controller (deployed via kustomization.yaml)
   ↓
jaeger-svc:16686 (ClusterIP Service)
   ↓
jaeger StatefulSet (Jaeger all-in-one)
   └─ Distributed tracing UI
```

---

## 🎯 Next Steps

### **Immediate (Deploy & Test):**

1. **Deploy to Local Podman**:

   ```bash
   kubectl apply -k infra/k8s/podman/local
   # Wait for Nginx Ingress to be ready (~1-2 minutes)
   kubectl wait --namespace ingress-nginx \
     --for=condition=ready pod \
     --selector=app.kubernetes.io/component=controller \
     --timeout=120s
   ```

2. **Test Locally**:

   ```bash
   # Get Ingress external IP (for Podman, usually localhost)
   kubectl get svc -n ingress-nginx ingress-nginx-controller

   # Test Jaeger UI
   curl http://jaeger.dev.localhost/
   # or
   curl http://localhost/ -H "Host: jaeger.dev.localhost"
   ```

### **Certificate Management (Test/Prod):**

3. **Install cert-manager** (if not already installed):

   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
   ```

4. **Create ClusterIssuer** for Let's Encrypt (staging + production)
   - Already configured in environment patches
   - Certificates are automatically issued when Ingress resources are created

---

## ✅ Verification Checklist

- [x] Nginx Ingress Controller configured (remote reference)
- [x] Jaeger Ingress rules created (base + 3 environments)
- [x] Base kustomization.yaml updated
- [x] Environment patches created (dev/test/prod)
- [x] Hetzner cluster configs updated (Traefik disabled)
- [x] Kustomize build tested successfully

**Kustomize Build Test Result**: ✅ SUCCESS

- Nginx Ingress Controller: Included
- Jaeger StatefulSet: Included
- Jaeger Service: Included
- Jaeger Ingress: Included (with environment-specific domains)

---

## 📊 Resource Summary

**Infrastructure (Deployed Everywhere):**

- Nginx Ingress Controller (1 namespace, ~10 resources)
- PostgreSQL StatefulSet
- Redis StatefulSet
- Jaeger StatefulSet

**Ingress Rules:**

- Jaeger Ingress (1 rule, environment-specific domains with optional TLS + basic auth)

**Total Resources**: ~15 (Nginx) + 1 (Jaeger Ingress) = 16 resources

---

## 🚀 Deployment Command

```bash
# Local (Podman)
kubectl apply -k infra/k8s/podman/local

# Hetzner Dev (via GitHub Actions)
gh workflow run deploy-k8s-resources.yml -f environment=dev

# Or push to dev branch (auto-deploys if auto_deploy: true)
git push origin dev
```

---

## 📝 Configuration Notes

**Domain Configuration**:

- Dev: `jaeger.dev.localhost` (local testing) or use `<IP>.nip.io`
- Test: `jaeger.test.yoursite.com` (update in patch)
- Prod: `jaeger.yoursite.com` (update in patch)

**Basic Authentication** (Production Only):

- Configured via `JAEGER_BASIC_AUTH` GitHub Secret
- Format: htpasswd string (e.g., `admin:$apr1$xyz...`)
- Generate: `htpasswd -nb username password`

**OpenTelemetry Integration**:

- Jaeger endpoint: `http://jaeger-svc:4318`
- Sampling: 100% in dev (override in prod to 1-5%)
- OTLP gRPC: Port 4317
- OTLP HTTP: Port 4318

---

## 🔧 Troubleshooting

**Issue**: Nginx Ingress not creating LoadBalancer
→ **Solution**: Podman/KIND doesn't support LoadBalancer. Use NodePort or kubectl port-forward

**Issue**: Ingress returns 503 Service Unavailable
→ **Solution**: Verify jaeger-svc endpoints exist: `kubectl get endpoints jaeger-svc`

**Issue**: Certificate not issued (Test/Prod)
→ **Solution**:

1. Check cert-manager is installed: `kubectl get pods -n cert-manager`
2. Check certificate status: `kubectl get certificate`
3. Check challenge status: `kubectl get challenge`
4. Verify DNS is pointing to the correct IP

**Issue**: Basic auth not working (Prod)
→ **Solution**:

1. Verify `JAEGER_BASIC_AUTH` secret is set in GitHub
2. Check if secret was substituted in deployment workflow
3. Test with: `curl -u username:password https://jaeger.yoursite.com`

---

## 📖 Related Documentation

- [PRD.md](../../PRD.md) - Architecture overview
- [copilot-instructions.md](../../.github/copilot-instructions.md) - Kubernetes section
- [infra/k8s/readme.md](readme.md) - Infrastructure documentation
- [infra/k8s/operations.md](operations.md) - Daily operations

---

**Status**: ✅ Ready for deployment
**TLS Certificates**: ✅ Auto-managed by cert-manager
**Basic Auth**: ✅ Configured for production
