# Kubernetes Storage Configuration Guide

## Overview

This guide explains storage sizing decisions, cost implications, and PVC expansion strategies for StatefulSet workloads (PostgreSQL, Redis, Jaeger) across dev, test, and prod environments.

## Storage Architecture

### Current Configuration (as of January 2026)

| Environment | PostgreSQL | Redis | Jaeger | Notes                                                              |
| ----------- | ---------- | ----- | ------ | ------------------------------------------------------------------ |
| **Dev**     | 14Gi       | 2Gi   | 2Gi    | Right-sized for active development with moderate data growth       |
| **Test**    | 15Gi       | 3Gi   | 3Gi    | Increased capacity for integration testing and realistic data sets |
| **Prod**    | 20Gi       | 5Gi   | 5Gi    | Production-grade with headroom for traffic spikes and retention    |

### Storage Class: hcloud-volumes (Hetzner)

**Key Features:**

- Based on Hetzner Cloud Volumes (SSD-backed network storage)
- `allowVolumeExpansion: true` - Supports online PVC resizing
- ReclaimPolicy: `Retain` - PVCs persist after StatefulSet deletion
- Performance: 3 IOPS per GB (baseline), bursts to 60 IOPS per GB
- Durability: 3x replicated across availability zones

**Important:** The CSI driver is automatically installed during cluster provisioning via `hcloud-csi-driver` Helm chart.

## Cost Analysis (Hetzner Cloud Volumes)

### Pricing (EUR, as of January 2026)

- **€0.056 per GB/month** (approximately $0.061 USD)
- Billed per GB allocated (not used space)
- No minimum volume size
- No IOPS charges (included in base price)

### Monthly Cost Breakdown

#### Dev Environment

| Resource   | Size | Cost/Month (EUR) | Cost/Month (USD) |
| ---------- | ---- | ---------------- | ---------------- |
| PostgreSQL | 14Gi | €0.78            | $0.85            |
| Redis      | 2Gi  | €0.11            | $0.12            |
| Jaeger     | 2Gi  | €0.11            | $0.12            |
| **Total**  | 18Gi | **€1.01**        | **$1.10**        |

#### Test Environment

| Resource   | Size | Cost/Month (EUR) | Cost/Month (USD) |
| ---------- | ---- | ---------------- | ---------------- |
| PostgreSQL | 15Gi | €0.84            | $0.92            |
| Redis      | 3Gi  | €0.17            | $0.18            |
| Jaeger     | 3Gi  | €0.17            | $0.18            |
| **Total**  | 21Gi | **€1.18**        | **$1.28**        |

#### Prod Environment

| Resource   | Size | Cost/Month (EUR) | Cost/Month (USD) |
| ---------- | ---- | ---------------- | ---------------- |
| PostgreSQL | 20Gi | €1.12            | $1.22            |
| Redis      | 5Gi  | €0.28            | $0.30            |
| Jaeger     | 5Gi  | €0.28            | $0.30            |
| **Total**  | 30Gi | **€1.68**        | **$1.83**        |

### All Environments Combined

**Total Storage:** 69Gi  
**Total Monthly Cost:** €3.86 / $4.21

### Cost Comparison

Compared to other providers (for 69Gi total):

- **AWS EBS (gp3):** ~$0.08/GB/month = $5.52 (+31% more expensive)
- **GCP Persistent Disk (SSD):** ~$0.17/GB/month = $11.73 (+179% more expensive)
- **Azure Managed Disks (Premium SSD):** ~$0.12/GB/month = $8.28 (+97% more expensive)

**Hetzner provides exceptional value** for European deployments with comparable performance.

## Sizing Rationale

### PostgreSQL (Multi-Tenant Architecture)

**Current Databases:**

1. `account_service_db` - User profiles, authentication, roles
2. `messaging_service_db` - Chat messages, attachments, participants
3. `property_service_db` - Listings, properties, units, communities

**Dev (14Gi):**

- **Use Case:** Active development with sample datasets
- **Data Profile:**
  - ~1,000 test users
  - ~5,000 chat messages
  - ~500 property listings
  - ~2-3 months of development history
- **Growth Rate:** ~1-2 GB/month
- **Headroom:** 50% free space for development spikes
- **Rationale:** Previously 5Gi was too small; frequent manual cleanup required

**Test (15Gi):**

- **Use Case:** Integration testing with realistic data volumes
- **Data Profile:**
  - ~5,000 test users
  - ~20,000 chat messages (load testing)
  - ~2,000 property listings
  - ~6 months of test data retention
- **Growth Rate:** ~2-3 GB/month
- **Headroom:** 40% free space for load testing
- **Rationale:** Needs to accommodate full regression test suites

**Prod (20Gi):**

- **Use Case:** Production workload with 12-month retention
- **Data Profile:**
  - ~10,000 active users (initial launch)
  - ~100,000 chat messages/month
  - ~5,000 property listings
  - ~1 year of transactional history
- **Growth Rate:** ~3-5 GB/month (depends on user growth)
- **Headroom:** 60% free space for traffic spikes
- **Rationale:** Sized for 6-month growth without expansion

### Redis (Pub/Sub + Caching)

**Use Cases:**

1. **Pub/Sub:** Real-time messaging delivery (WebSocket channels)
2. **Caching:** Session data, API responses, rate limiting counters
3. **Queues:** Background job processing (future)

**Dev (2Gi):**

- **Max Memory:** 128MB (maxmemory policy: allkeys-lru)
- **Use Case:** Local testing, ~10 concurrent WebSocket connections
- **Data Profile:**
  - ~1,000 cache keys
  - ~50 active Pub/Sub channels
  - AOF persistence (append-only file) for durability
- **Rationale:** 2Gi provides 16x headroom for AOF logs and snapshots

**Test (3Gi):**

- **Max Memory:** 256MB
- **Use Case:** Load testing, ~100 concurrent connections
- **Data Profile:**
  - ~10,000 cache keys
  - ~200 active Pub/Sub channels
  - Full AOF rewrites during load tests
- **Rationale:** Increased capacity for aggressive load testing

**Prod (5Gi):**

- **Max Memory:** 512MB
- **Use Case:** Production traffic, ~1,000 concurrent connections
- **Data Profile:**
  - ~50,000 cache keys
  - ~500 active Pub/Sub channels
  - Daily AOF rewrites, RDB snapshots
- **Rationale:** 10x memory overhead for persistence files

**Why Storage >> Memory?** Redis persistence (AOF + RDB) requires disk space for:

- Append-only logs (can grow to 2-3x memory size before rewrite)
- RDB snapshots (copy-on-write requires 2x memory temporarily)
- Old AOF files during rewrites

### Jaeger (Distributed Tracing)

**Storage Backend:** BadgerDB (embedded key-value store)

**Dev (2Gi):**

- **Retention:** 7 days (sampling rate: 100% - all traces)
- **Use Case:** Development debugging with full trace history
- **Data Profile:**
  - ~1,000 traces/day (low dev traffic)
  - ~20 spans per trace (average)
  - ~140,000 spans total (7 days)
  - BadgerDB compression ratio: ~10:1
- **Rationale:** Full sampling + short retention = small storage footprint. 2Gi provides 10x headroom.

**Test (3Gi):**

- **Retention:** 14 days (sampling rate: 10% - one in ten traces)
- **Use Case:** Integration testing with extended retention
- **Data Profile:**
  - ~10,000 traces/day (load testing)
  - ~10% sampled = ~1,000 traces/day
  - ~30 spans per trace
  - ~420,000 spans total (14 days)
- **Rationale:** Longer retention for debugging intermittent issues. Sampling reduces storage needs.

**Prod (5Gi):**

- **Retention:** 30 days (sampling rate: 5% - one in twenty traces)
- **Use Case:** Production monitoring with 1-month retention
- **Data Profile:**
  - ~50,000 traces/day (production traffic)
  - ~5% sampled = ~2,500 traces/day
  - ~50 spans per trace (complex microservices)
  - ~3,750,000 spans total (30 days)
- **Rationale:** Aggressive sampling + BadgerDB efficiency keeps storage minimal. 5Gi handles growth headroom.

**Why Jaeger < Redis Storage?**

- BadgerDB has excellent compression (~10:1 ratio)
- Aggressive sampling (5-10% in test/prod)
- Short retention windows (7-30 days with auto-pruning)
- Redis needs 3-5x memory for AOF/RDB persistence files

## PVC Expansion Strategy

### How Kubernetes PVC Expansion Works

**Automatic Expansion Process (requires `allowVolumeExpansion: true`):**

1. **Update volumeClaimTemplates:** Change storage size in StatefulSet patch file
2. **Trigger immutable field error:** Kubernetes rejects in-place update
3. **Delete StatefulSet:** Workflow uses `kubectl delete statefulset/{name} --cascade=orphan`
   - StatefulSet is deleted
   - **Pods continue running** (orphaned but healthy)
   - **PVCs remain bound** (retain policy)
4. **Apply updated StatefulSet:** Workflow runs `kubectl apply -f manifests.yaml`
   - New StatefulSet created with updated storage size
   - **Kubernetes detects PVC size mismatch**
   - **CSI driver triggers volume expansion** (online resize)
   - New pods attach to expanded PVCs
5. **Wait for rollout:** `kubectl rollout status statefulset/{name}` waits for pods to become ready

**Key Points:**

- ✅ Zero downtime if pods are orphaned (continue serving traffic)
- ✅ PVC expansion happens automatically via CSI driver
- ✅ Data is never deleted (retain policy)
- ⚠️ **Cannot shrink PVCs** (Kubernetes limitation - expansion only)
- ⚠️ **Must delete StatefulSet** (volumeClaimTemplates is immutable)

### Previous Misunderstanding

**What we thought:**

> "volumeClaimTemplates are immutable - you can't change storage sizes"

**Reality:**

> "volumeClaimTemplates field is immutable **on existing StatefulSets**, but PVCs can be expanded by deleting and recreating the StatefulSet with updated storage size. The CSI driver handles the actual volume expansion."

### Best Practices

1. **Always increase in meaningful increments:**
   - Avoid frequent small changes (e.g., 10Gi → 11Gi)
   - Prefer 20-50% increases (e.g., 10Gi → 15Gi or 20Gi)
   - Reduces deployment churn and expansion operations

2. **Monitor actual usage before expanding:**

   ```bash
   kubectl exec -it postgres-0 -- df -h /var/lib/postgresql/data
   kubectl exec -it redis-0 -- df -h /data
   kubectl exec -it jaeger-0 -- df -h /badger
   ```

3. **Plan for 6-month growth in production:**
   - Dev: 3-month growth (faster iteration)
   - Test: 6-month growth (stability)
   - Prod: 12-month growth (minimize disruptions)

4. **Test expansions in dev first:**
   - Validate CSI driver behavior
   - Confirm zero-downtime workflow
   - Verify PVC binds correctly after expansion

5. **Document expansion decisions:**
   - Update this guide with new sizes
   - Add git commit message with rationale
   - Include cost impact in PR description

## Troubleshooting

### PVC Stuck in "Resizing" State

**Symptoms:**

```bash
kubectl get pvc postgres-data-postgres-0
# Status: FileSystemResizePending or Resizing
```

**Cause:** Filesystem resize requires pod restart to complete

**Solution:**

```bash
# Delete pod (StatefulSet will recreate it)
kubectl delete pod postgres-0

# Verify PVC bound after pod restart
kubectl get pvc postgres-data-postgres-0
# Status: Bound
```

### StatefulSet Won't Apply (Immutable Field Error)

**Symptoms:**

```
Error: StatefulSet.apps "postgres" is invalid:
spec: Forbidden: updates to statefulset spec for fields other than
'replicas', 'template', 'updateStrategy' are forbidden
```

**Cause:** Changed volumeClaimTemplates on existing StatefulSet

**Solution:** Workflow automatically handles this via error-driven pattern:

1. Detects "immutable field" error in stderr
2. Deletes StatefulSet with `--cascade=orphan`
3. Retries `kubectl apply` with updated manifest

**Manual recovery (if workflow fails):**

```bash
# Delete StatefulSet, keep pods running
kubectl delete statefulset postgres --cascade=orphan

# Apply updated manifest
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply -f -

# Verify new StatefulSet created
kubectl get statefulset postgres
```

### PVC Size Mismatch After Expansion

**Symptoms:**

```bash
kubectl get pvc postgres-data-postgres-0
# Capacity: 14Gi (old size)
# Storage: 20Gi (new requested size)
```

**Cause:** CSI driver expansion in progress

**Wait for completion:**

```bash
# Check events
kubectl describe pvc postgres-data-postgres-0

# Wait for FileSystemResize event
# Event: Successfully expanded volume (may take 2-5 minutes)
```

**Force pod restart if stuck:**

```bash
kubectl delete pod postgres-0
```

## Future Improvements

1. **Automated Monitoring:**
   - Prometheus alerts at 70% usage (warning)
   - Prometheus alerts at 85% usage (critical)
   - Grafana dashboards for storage trends

2. **Auto-Scaling Storage:**
   - Kubernetes operator to monitor PVC usage
   - Automatic expansion when thresholds reached
   - Requires custom controller or third-party tool

3. **Cost Optimization:**
   - Archive old data to S3 (cheaper object storage)
   - Implement data lifecycle policies
   - Compress historical traces in Jaeger

4. **Multi-Region Strategy:**
   - Cross-region PVC replication
   - Disaster recovery with snapshot backups
   - Geo-distributed storage for global deployments

## References

- [Kubernetes Storage Classes](https://kubernetes.io/docs/concepts/storage/storage-classes/)
- [PVC Expansion Documentation](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#expanding-persistent-volumes-claims)
- [Hetzner CSI Driver](https://github.com/hetznercloud/csi-driver)
- [StatefulSet Best Practices](https://kubernetes.io/docs/tutorials/stateful-application/basic-stateful-set/)
- [Hetzner Cloud Volumes Pricing](https://www.hetzner.com/cloud/volumes)

---

**Last Updated:** January 7, 2026  
**Maintained By:** DevOps Team  
**Review Cycle:** Quarterly (check cost optimization opportunities)
