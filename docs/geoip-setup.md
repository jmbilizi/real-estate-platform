# MaxMind GeoIP2 Integration Guide

## 📍 Overview

The API Gateway includes **optional MaxMind GeoIP2** integration for enriching OpenTelemetry traces with geographic location data based on client IP addresses.

**⚠️ GeoIP is OPTIONAL for local development** - the API Gateway works perfectly without it. You'll just see fewer tags in traces.

**What You Get With GeoIP Enabled:**

- Country code & name (e.g., `US`, `United States`)
- City name (e.g., `San Francisco`)
- Region/state (e.g., `California`, `CA`)
- Coordinates (latitude/longitude)
- Timezone (e.g., `America/Los_Angeles`)
- Continent (e.g., `North America`, `NA`)

---

## 🚀 Quick Start (Local Development)

### **Option 1: One-Command Setup** (Recommended)

```bash
# 1. Get free license key: https://www.maxmind.com/en/geolite2/signup
# 2. Set environment variable
$env:MAXMIND_LICENSE_KEY="your_key_here"  # PowerShell
# OR
export MAXMIND_LICENSE_KEY=your_key_here  # Unix/macOS

# 3. Download database (one command, automatic extraction)
npm run geoip:download

# Done! Start developing
npm run skaffold
```

**This script automatically:**

- ✅ Downloads GeoLite2-City.mmdb (54MB)
- ✅ Extracts and places in `apps/api-gateway/` directory
- ✅ Updates `.env` with MAXMIND_LICENSE_KEY (if not already present)
- ✅ Checks if already downloaded (asks before re-downloading)

### **Option 2: Skip GeoIP** (Fastest for most development)

Just start developing - no setup needed! Geographic tags won't appear in traces, but everything else works.

```bash
npm run infra:local:cluster:setup
npm run skaffold
```

**When to enable GeoIP locally:**

- Testing IP-based features
- Debugging geographic routing logic
- Validating privacy compliance (IP hashing)

**For most development:** Skip it! Test GeoIP features in deployed environments where it's pre-configured.

---

## 🏭 Production Deployment (Automatic)

**The Docker build automatically downloads the GeoIP database** during image builds in CI/CD. You just need to add the license key once.

### One-Time Setup: Add License Key to GitHub

**Step 1: Get Free License Key**

1. Sign up: https://www.maxmind.com/en/geolite2/signup (free)
2. Generate key: https://www.maxmind.com/en/accounts/current/license-key
3. Copy the license key (shown only once)

**Step 2: Add as GitHub Secret**

```bash
# Create namespace if not exists
kubectl create namespace default

# Create ConfigMap from database file
kubectl create configmap geoip-database \
  --from-file=GeoLite2-City.mmdb=apps/api-gateway/geoip/GeoLite2-City.mmdb \
  -n default

# Verify
kubectl describe configmap geoip-database -n default
```

**Update API Gateway Deployment:**

Edit [infra/k8s/base/deployments/api-gateway.deployment.yaml](../../infra/k8s/base/deployments/api-gateway.deployment.yaml):

```yaml
spec:
  template:
    spec:
      containers:
        - name: api-gateway
          # ... existing config ...
          env:
            # ... existing env vars ...

            # GeoIP Configuration
            - name: GEOIP_ENABLED
              value: "true" # Enable in all envs (dev/test/prod)
              # Note: Database path auto-detected:
              #   Container: /opt/geoip/GeoLite2-City.mmdb
              #   Local dev: apps/api-gateway/GeoLite2-City.mmdb

          volumeMounts:
            # ... existing mounts ...

            # Mount GeoIP database
            - name: geoip-database
              mountPath: /opt/geoip
              readOnly: true

      volumes:
        # ... existing volumes ...

        # GeoIP database volume
        - name: geoip-database
          configMap:
            name: geoip-database
```

**Environment-specific overrides** (optional):

For **production** only (smaller database):

```yaml
# infra/k8s/hetzner/prod/patches/deployments/api-gateway.deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  template:
    spec:
      containers:
        - name: api-gateway
          env:
            - name: GEOIP_ENABLED
              value: "true" # Can disable per environment
```

---

## � CI/CD Setup (GitHub Actions)

**The workflow is already configured** to automatically download the GeoIP database during Docker builds. You just need to add the MaxMind license key as a GitHub Secret.

### **Step 1: Get MaxMind License Key**

1. Sign up (free): https://www.maxmind.com/en/geolite2/signup
2. Generate key: https://www.maxmind.com/en/accounts/current/license-key
3. Copy the license key (you won't see it again after leaving the page)

### **Step 2: Add GitHub Secret**

**Option A: Using GitHub Web UI**

1. Go to your repository: `https://github.com/YOUR_ORG/real-estate-platform`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `MAXMIND_LICENSE_KEY`
5. Value: Paste your license key
6. Click **Add secret**

**Option B: Using GitHub CLI**

```bash
# Install GitHub CLI if needed: https://cli.github.com/
gh secret set MAXMIND_LICENSE_KEY --body "your_license_key_here"
```

### **Step 3: Verify Setup**

**Test the workflow:**

```bash
# Trigger manual build
gh workflow run build-push-images.yml -f environment=dev -f projects=api-gateway

# Watch the build
gh run watch

# Check the build summary
gh run view --log
```

**Look for this in the build logs:**

```
Downloading GeoLite2-City database...
GeoLite2-City database installed successfully
```

**If the secret is missing**, you'll see:

```
WARNING: MAXMIND_LICENSE_KEY not provided - GeoIP features will be unavailable
```

### **What Happens During Build**

The `Dockerfile` automatically:

1. Checks if `MAXMIND_LICENSE_KEY` build-arg is provided
2. Downloads `GeoLite2-City.tar.gz` from MaxMind
3. Extracts `GeoLite2-City.mmdb` to `/opt/geoip/`
4. Removes temporary files and curl dependencies
5. **Gracefully degrades** if key not provided (GeoIP disabled, but build succeeds)

**Build-time security:** The license key is never stored in the image layers (only used during build).

---

## �📊 What You'll See in Jaeger

**After deploying, traces will include:**

```yaml
# Geographic tags (OpenTelemetry semantic conventions)
client.geo.country_code: "US"
client.geo.country_name: "United States"
client.geo.city: "San Francisco"
client.geo.region: "California"
client.geo.continent_code: "NA"
client.geo.latitude: 37.7749
client.geo.longitude: -122.4194
client.geo.timezone: "America/Los_Angeles"

# Always present (privacy-compliant)
client.address_hash: "a3f8c2e1b4d6..." # SHA256 hash
client.ip_type: "public" # Classification

# Development only (if OTEL_STORE_FULL_IP=true)
client.address: "203.0.113.42"

# Network info
network.peer.address: "172.16.0.1"
http.user_agent: "Mozilla/5.0..."
client.type: "mobile"
```

**Search in Jaeger UI:**

```
service.name=api-gateway AND client.geo.country_code=US
service.name=api-gateway AND client.geo.city=San Francisco
```

---

## 🔧 Configuration Reference

### **Environment Variables**

| Variable        | Default | Description                  |
| --------------- | ------- | ---------------------------- |
| `GEOIP_ENABLED` | `false` | Enable/disable GeoIP lookups |

**Database Path:** Automatically detected (no configuration needed)

- **Container/Kubernetes:** `/opt/geoip/GeoLite2-City.mmdb`
- **Local development:** `apps/api-gateway/GeoLite2-City.mmdb` (workspace root)
- **Fallback:** `GeoLite2-City.mmdb` (project directory)

### **Database Files**

| Database             | Size   | Coverage                           |
| -------------------- | ------ | ---------------------------------- |
| **GeoLite2-City** ✅ | ~70MB  | City-level precision (recommended) |
| GeoLite2-Country     | ~6MB   | Country-level only                 |
| GeoIP2-City (Paid)   | ~150MB | More accurate, includes ISP data   |

**Free tier limits:** Database updated monthly, download frequency limits apply.

---

## 🔒 Privacy & Compliance

### **GDPR Compliance**

✅ **IP addresses are hashed** using SHA256 (pseudonymization under GDPR Article 4)  
✅ **Full IPs only in dev** (production only stores hashed values)  
✅ **Do-Not-Track respected** (`DNT: 1` header skips GeoIP lookup)  
✅ **Short retention** (7 days dev, 30 days prod in Jaeger)

### **What's Stored**

**Always stored:**

- Hashed IP (`client.address_hash`)
- Geographic data (country, city, coordinates)
- IP type classification (public/private/loopback)

**Never stored in production:**

- Full IP address (unless `OTEL_STORE_FULL_IP=true`)
- Private/loopback IPs (GeoIP lookup skipped)

### **Legal Considerations**

- ⚠️ **Geographic data may be personal data** in some jurisdictions
- ⚠️ **Requires notice in privacy policy** ("We collect approximate location based on IP")
- ✅ **Legitimate interest** for fraud prevention, analytics, security
- ✅ **Consent via Do-Not-Track** header support

---

## 🧪 Testing

**1. Send test request with public IP:**

```bash
# Using curl (simulates external request)
curl -H "X-Forwarded-For: 8.8.8.8" http://localhost:8080/api/properties
```

**2. View trace in Jaeger:**

```
http://localhost:16686 → Search → api-gateway → View trace
```

**Expected tags:**

```
client.geo.country_code: US
client.geo.city: Mountain View
```

**3. Test Do-Not-Track:**

```bash
curl -H "DNT: 1" -H "X-Forwarded-For: 8.8.8.8" http://localhost:8080/api/properties
```

**Expected:**

```
privacy.dnt: "true"
# No client.geo.* tags (skipped)
```

---

## 📈 Use Cases

1. **Geographic analysis**: "90% of requests from US, 5% from EU"
2. **Fraud detection**: Flag requests from high-risk countries
3. **Performance monitoring**: "EU users experience 200ms higher latency" (routing optimization needed)
4. **Compliance**: Block GDPR-protected regions if not compliant
5. **Content delivery**: CDN selection based on user location
6. **Analytics**: Heatmaps showing user distribution

---

## ❓ Troubleshooting

### **GeoIP lookups not working**

**Check logs:**

```bash
# Local
kubectl logs -l app=api-gateway --tail=100 | grep -i geoip

# Expected output:
# GeoIP service initialized successfully with database: /opt/geoip/GeoLite2-City.mmdb (Build: 2024-01-15)
```

**Common issues:**

1. **Database not found:**

   ```
   GeoIP database not found. Checked paths:
   - /opt/geoip/GeoLite2-City.mmdb
   - apps/api-gateway/GeoLite2-City.mmdb
   - GeoLite2-City.mmdb
   ```

   **Fix:**
   - **Container/K8s:** Create ConfigMap and mount volume (or use Dockerfile auto-download)
   - **Local dev:** Run `npm run geoip:download`

2. **GeoIP disabled:**

   ```
   GeoIP lookups are DISABLED (GEOIP_ENABLED=false)
   ```

   **Fix:** Set `GEOIP_ENABLED=true` in deployment

3. **Private IP (expected):**
   - Private IPs (10.x, 192.168.x, 172.16-31.x) are skipped (no GeoIP data)
   - Use `X-Forwarded-For` with public IP for testing

### **Database file too large for ConfigMap**

**ConfigMaps limited to 1MB**, GeoLite2-City is ~70MB.

**Solution: Use PersistentVolume instead:**

```yaml
# Create PV/PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: geoip-storage
spec:
  accessModes: [ReadOnlyMany]
  resources:
    requests:
      storage: 100Mi

# Update volume in deployment
volumes:
  - name: geoip-database
    persistentVolumeClaim:
      claimName: geoip-storage
```

**Or use init container to download:**

```yaml
initContainers:
  - name: download-geoip
    image: curlimages/curl:latest
    command:
      - sh
      - -c
      - |
        curl -L "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${LICENSE_KEY}&suffix=tar.gz" \
          | tar -xz -C /opt/geoip --strip-components=1
    env:
      - name: LICENSE_KEY
        valueFrom:
          secretKeyRef:
            name: maxmind-license
            key: LICENSE_KEY
    volumeMounts:
      - name: geoip-database
        mountPath: /opt/geoip
```

---

## 📚 Additional Resources

- **MaxMind Documentation**: https://dev.maxmind.com/geoip/docs
- **GeoLite2 Free Database**: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data
- **OpenTelemetry Semantic Conventions**: https://opentelemetry.io/docs/specs/semconv/attributes-registry/client/
- **GDPR Article 4 (Personal Data)**: https://gdpr-info.eu/art-4-gdpr/

---

## 🔄 Database Updates

**GeoLite2 updates monthly** (first Tuesday of each month).

**Manual update:**

1. Download new database
2. Recreate ConfigMap: `kubectl delete configmap geoip-database && kubectl create configmap ...`
3. Rolling restart: `kubectl rollout restart deployment/api-gateway`

**Automated update** (recommended for production):

Use **init container** or **CronJob** to refresh database automatically:

```yaml
# CronJob to update database monthly
apiVersion: batch/v1
kind: CronJob
metadata:
  name: geoip-updater
spec:
  schedule: "0 0 2 * *" # 2nd day of each month
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: updater
              image: curlimages/curl:latest
              command: ["sh", "-c", "curl -L '...' | tar -xz ..."]
```

---

**Next Steps:**

1. Download GeoLite2-City database
2. Test locally with Skaffold
3. Deploy to Kubernetes with ConfigMap
4. Verify traces in Jaeger UI include `client.geo.*` tags
