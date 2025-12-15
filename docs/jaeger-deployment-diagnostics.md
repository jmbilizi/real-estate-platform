# Jaeger Deployment Diagnostics

When Jaeger deployment fails with timeout, gather these diagnostics to identify the root cause:

## Quick Diagnostic Commands

```bash
# 1. Pod status
kubectl get pod jaeger-0 -o wide

# 2. Pod description (shows events, state, conditions)
kubectl describe pod jaeger-0

# 3. Current container logs
kubectl logs jaeger-0 --tail=100

# 4. Previous crashed container logs
kubectl logs jaeger-0 --previous --tail=100

# 5. Init container logs (permission fixes)
kubectl logs jaeger-0 -c fix-permissions

# 6. Pod events
kubectl get events --field-selector involvedObject.name=jaeger-0 --sort-by='.lastTimestamp'

# 7. PVC status
kubectl get pvc | grep jaeger
kubectl describe pvc jaeger-data-jaeger-0
```

## Common Failure Patterns

### 1. BadgerDB Version Incompatibility

**Symptoms**: `manifest has unsupported version: 4 (we support 8)`
**Cause**: Upgrading from older Jaeger with incompatible BadgerDB format
**Solution**:

```bash
kubectl delete pod jaeger-0
kubectl delete pvc jaeger-data-jaeger-0
# StatefulSet recreates both automatically
```

### 2. Permission Denied

**Symptoms**: `open /badger/key: permission denied`
**Cause**: Volume ownership mismatch, initContainer failed
**Check**: `kubectl logs jaeger-0 -c fix-permissions`
**Expected**: Should show `chown -R 10001:10001 /badger`

### 3. Image Pull Errors

**Symptoms**: `ImagePullBackOff`, `ErrImagePull`
**Check**: `kubectl get statefulset jaeger -o jsonpath='{.spec.template.spec.containers[0].image}'`
**Expected**: `jaegertracing/all-in-one:1.76.0` (not `opentelemetry-all-in-one`)

### 4. Readiness Probe Timeout

**Symptoms**: Pod running but not ready after 45s+ 60s wait
**Check**: `kubectl logs jaeger-0 | grep -E 'ready|started|listening|serving'`
**Analysis**: If app starts slowly, may need to increase readiness initialDelaySeconds

### 5. Resource Constraints

**Symptoms**: Pod stuck in Pending state
**Check**: `kubectl describe pod jaeger-0 | grep -A5 Events`
**Look for**: `Insufficient memory`, `Insufficient cpu`

## GitHub Actions Workflow Diagnostics

When deployment fails in CI/CD, the workflow automatically captures all above diagnostics in the "Wait for workload rollout" step output.

Review the failed workflow run logs for:

- 🔍 Pod status
- 🔍 Pod description
- 🔍 Current/previous container logs
- 🔍 Init container logs
- 🔍 Pod events
- 🔍 PVC status

## Resolution Decision Tree

```
Timeout occurred
├─> Check pod status
    ├─> Pending
    │   └─> Check events → Resource constraints or scheduling issues
    ├─> CrashLoopBackOff
    │   └─> Check logs → BadgerDB version or permission errors
    ├─> Running but not Ready
    │   └─> Check readiness probe → May need more time or app not starting
    └─> ImagePullBackOff
        └─> Check image name → Wrong repository or tag
```
