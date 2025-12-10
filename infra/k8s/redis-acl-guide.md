# Redis ACL Configuration Guide

## Overview

This deployment uses **ACL-based authentication** (Access Control Lists) for enterprise-grade security, audit trails, and compliance. Unlike simple password authentication, ACL provides:

- **User-based access control** - Each service gets its own username/password
- **Audit trails** - Know WHO accessed data, not just WHAT
- **Least privilege** - Services only get permissions they need
- **Key namespacing** - Prevent cross-service data access
- **Compliance ready** - Meets SOC2, HIPAA, PCI-DSS requirements

## ACL Users

### Admin User (`admin`)

- **Purpose**: Operations, monitoring, manual troubleshooting
- **Permissions**: Full access to all keys and commands
- **Key pattern**: `~*` (all keys)
- **Commands**: `+@all` (all command categories)
- **Use in**: Kubernetes probes, Redis CLI access, emergency ops

### Pub/Sub User (`pubsub_user`)

- **Purpose**: Pub/Sub messaging, WebSocket notifications, real-time events
- **Used by**: messaging-service, notification-service, websocket-gateway
- **Permissions**: Messaging and pub/sub keys only
- **Key patterns**: `~messaging:*`, `~pubsub:*`
- **Commands**:
  - `+@pubsub` (PUBLISH, SUBSCRIBE, PSUBSCRIBE, etc.)
  - `+@string +@hash +@list +@set +@sortedset` (data structures)
  - `+expire +ttl +del` (key management)
- **Example keys**: `messaging:user:123:inbox`, `pubsub:notifications`

### Cache User (`cache_user`)

- **Purpose**: Session storage, API response caching, computed results
- **Used by**: property-service, account-service, any app needing caching
- **Permissions**: Cache and session keys only
- **Key patterns**: `~cache:*`, `~session:*`
- **Commands**:
  - `+@string +@hash` (cache data structures)
  - `+get +set +del +expire +ttl +exists` (cache operations)
- **Example keys**: `cache:api:users:list`, `session:abc123def`

### Rate Limit User (`ratelimit_user`)

- **Purpose**: API rate limiting counters, abuse prevention
- **Used by**: api-gateway, any service implementing throttling
- **Permissions**: Counter operations on rate limit keys
- **Key pattern**: `~ratelimit:*`
- **Commands**: `+incr +decr +expire +ttl +get +set +del`
- **Example keys**: `ratelimit:ip:192.168.1.1`, `ratelimit:user:456`

### Monitor User (`monitor`)

- **Purpose**: Prometheus, Grafana, monitoring tools
- **Permissions**: Read-only access, metrics, diagnostics
- **Key pattern**: `~*` (can read all keys)
- **Commands**: `+@read +ping +info +client +slowlog`
- **Restrictions**: Cannot write or modify data

## Application Connection Examples

### Node.js (ioredis)

```javascript
const Redis = require("ioredis");

// Pub/Sub User
const messagingClient = new Redis({
  host: "redis-svc.default.svc.cluster.local",
  port: 6379,
  username: "pubsub_user",
  password: process.env.REDIS_PUBSUB_PASSWORD,
  db: 0,
});

// Cache User
const cacheClient = new Redis({
  host: "redis-svc.default.svc.cluster.local",
  port: 6379,
  username: "cache_user",
  password: process.env.REDIS_CACHE_PASSWORD,
  db: 0,
});

// Rate Limiting
const rateLimitClient = new Redis({
  host: "redis-svc.default.svc.cluster.local",
  port: 6379,
  username: "ratelimit_user",
  password: process.env.REDIS_RATELIMIT_PASSWORD,
  db: 0,
});
```

### Python (redis-py)

```python
import os
import redis

# Pub/Sub User (for messaging-service)
pubsub_client = redis.Redis(
    host='redis-svc.default.svc.cluster.local',
    port=6379,
    username='pubsub_user',
    password=os.getenv('REDIS_PUBSUB_PASSWORD'),
    db=0,
    decode_responses=True
)

# Cache User (for property-service)
cache_client = redis.Redis(
    host='redis-svc.default.svc.cluster.local',
    port=6379,
    username='cache_user',
    password=os.getenv('REDIS_CACHE_PASSWORD'),
    db=0,
    decode_responses=True
)
```

### .NET (StackExchange.Redis)

```csharp
using StackExchange.Redis;

// Pub/Sub User (for messaging-service)
var pubsubConfig = ConfigurationOptions.Parse("redis-svc.default.svc.cluster.local:6379");
pubsubConfig.User = "pubsub_user";
pubsubConfig.Password = Environment.GetEnvironmentVariable("REDIS_PUBSUB_PASSWORD");
var pubsubConnection = ConnectionMultiplexer.Connect(pubsubConfig);

// Cache User (for property-service, account-service)
var cacheConfig = ConfigurationOptions.Parse("redis-svc.default.svc.cluster.local:6379");
cacheConfig.User = "cache_user";
cacheConfig.Password = Environment.GetEnvironmentVariable("REDIS_CACHE_PASSWORD");
var cacheConnection = ConnectionMultiplexer.Connect(cacheConfig);
```

## Key Naming Conventions

### Pub/Sub User Keys

```
messaging:user:{userId}:inbox          # User inbox messages
messaging:user:{userId}:outbox         # Sent messages
messaging:conversation:{convId}        # Conversation metadata
messaging:unread:{userId}              # Unread counts
pubsub:notifications                   # Pub/Sub channel
pubsub:user:{userId}                   # User-specific channel
```

### Cache User Keys

```
cache:api:users:list                   # API response cache
cache:api:users:{id}                   # Single user cache
cache:search:{query}                   # Search results cache
session:{sessionId}                    # User sessions
session:user:{userId}                  # User session mapping
```

### Rate Limiting Keys

```
ratelimit:ip:{ipAddress}               # IP-based rate limit
ratelimit:user:{userId}                # User-based rate limit
ratelimit:api:{endpoint}               # Endpoint-based limit
ratelimit:global                       # Global rate limit
```

## Operations

### Check ACL Configuration

```bash
# Connect to Redis pod
kubectl exec -it redis-0 -- sh

# List all users
redis-cli --user admin --pass <password> ACL LIST

# Check user permissions
redis-cli --user admin --pass <password> ACL GETUSER pubsub_user
redis-cli --user admin --pass <password> ACL GETUSER cache_user

# Test authentication
redis-cli --user cache_user --pass <password> PING
```

### Monitor User Activity

```bash
# View active connections per user
redis-cli --user admin --pass <password> CLIENT LIST

# Check authentication failures (requires ACL log enabled)
redis-cli --user admin --pass <password> ACL LOG

# Monitor command execution
redis-cli --user monitor --pass <password> MONITOR
```

### Troubleshooting Permission Errors

**Error: `NOPERM this user has no permissions to access one of the keys`**

- User trying to access keys outside their pattern
- Check key naming convention matches user's `~pattern`
- Example: `cache_user` cannot access `messaging:*` keys

**Error: `NOPERM this user has no permissions to run the 'command' command`**

- User trying to run unauthorized command
- Check user's command permissions in `users.acl`
- Example: `cache_user` cannot run `PUBLISH` (pub/sub command)

### Adding New Users

1. Update `infra/k8s/base/configmaps/redis.configmap.yaml`:

```yaml
# Add new user definition
user newservice_user on >${REDIS_NEWSERVICE_PASSWORD} ~newservice:* +@read +@write
```

2. Add password to `infra/k8s/base/secrets/redis.secret.yaml`:

```yaml
stringData:
  REDIS_NEWSERVICE_PASSWORD: StrongBase64Password
```

3. Update GitHub Actions workflow (`.github/workflows/deploy-k8s-resources.yml`):

```bash
yq eval '.stringData.REDIS_NEWSERVICE_PASSWORD = "${{ secrets.REDIS_NEWSERVICE_PASSWORD }}"' - | \
```

4. Add to initContainer env vars in `redis.statefulset.yaml`:

```yaml
- name: REDIS_NEWSERVICE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: redis-secret
      key: REDIS_NEWSERVICE_PASSWORD
```

5. Apply changes:

```bash
kubectl apply -k infra/k8s/hetzner/dev
```

## Security Best Practices

1. **Never use admin user in applications** - Only for ops/monitoring
2. **Use minimum required permissions** - Don't give full access
3. **Rotate passwords regularly** - Update secrets quarterly
4. **Monitor ACL logs** - Watch for permission errors (potential attacks)
5. **Use key namespaces** - Prefix all keys with service name
6. **Disable default user** - Forces explicit authentication (already done)
7. **Use TLS in production** - Encrypt traffic (add to roadmap)

## ACL File Format Limitations

**IMPORTANT**: Redis ACL files loaded via `aclfile` directive have strict formatting requirements:

### ❌ Not Allowed

- **Comments** - Lines starting with `#` will cause "should start with user keyword" errors
- **Blank lines** - Empty lines between user definitions will fail validation
- **Inline comments** - Comments after user definitions (e.g., `user admin ... # comment`) will fail

### ✅ Allowed

- **user keyword** - Every line MUST start with `user` (except for completely empty file)
- **Compact format** - All user definitions consecutively without separators

### Example (Current Implementation)

```
user admin on >password ~* +@all
user pubsub_user on >password ~messaging:* ~pubsub:* +@pubsub +@string
user cache_user on >password ~cache:* ~session:* +@string +@hash +get +set
user ratelimit_user on >password ~ratelimit:* +incr +decr +expire
user monitor on >password ~* +@read +ping +info
user default off nopass ~* -@all
```

### Why This Matters

- ConfigMap template (`infra/k8s/base/configmaps/redis.configmap.yaml`) contains NO comments
- Documentation lives in this guide, not in the ACL file itself
- Init container uses `sed` for password substitution (avoids TLS issues with `apk add gettext`)

### Runtime ACL Modifications

While ACL files don't support comments, you CAN use Redis commands for runtime changes:

```bash
# Add comment-like alias using ACL SETUSER
redis-cli ACL SETUSER newuser on >password ~cache:* +@string

# View with descriptions in your monitoring tools
redis-cli ACL LIST
```

These runtime changes are NOT persisted to the ACL file unless you run `ACL SAVE`.

## GitHub Secrets Required

All environments (dev/test/prod) need these secrets configured:

- `REDIS_ADMIN_PASSWORD` - Admin user password
- `REDIS_PUBSUB_PASSWORD` - Pub/Sub User password
- `REDIS_CACHE_PASSWORD` - Cache User password
- `REDIS_RATELIMIT_PASSWORD` - Rate Limit User password
- `REDIS_MONITOR_PASSWORD` - Monitoring user password

**Setting secrets**:

```bash
# Via GitHub CLI
gh secret set REDIS_ADMIN_PASSWORD --env dev
gh secret set REDIS_PUBSUB_PASSWORD --env dev
gh secret set REDIS_CACHE_PASSWORD --env dev
gh secret set REDIS_RATELIMIT_PASSWORD --env dev
gh secret set REDIS_MONITOR_PASSWORD --env dev

# Repeat for test and prod environments
```

## Migration from Password-Only Mode

If migrating from simple `requirepass` authentication:

1. **Applications need updates** - Add `username` parameter to connections
2. **Environment variables change**:
   - Old: `REDIS_PASSWORD`
   - New: `REDIS_<SERVICE>_PASSWORD` (service-specific)
3. **Connection strings change**:
   - Old: `redis://:password@host:6379`
   - New: `redis://username:password@host:6379`

## Compliance Benefits

- **SOC2**: User-based access control, audit trails, least privilege
- **HIPAA**: Encryption at rest (AOF/RDB), access logging, role separation
- **PCI-DSS**: Strong authentication, activity monitoring, restricted access
- **GDPR**: Data access logging, user activity tracking, retention policies

## References

- [Redis ACL Documentation](https://redis.io/docs/management/security/acl/)
- [Valkey ACL Guide](https://valkey.io/topics/acl/)
- [Redis Security Best Practices](https://redis.io/docs/management/security/)
