# Ocelot Route Templates

This folder contains **reference templates** for downstream microservices. These are examples and
documentation - they are **NOT loaded** by the gateway.

## 📁 Folder Structure

```
Templates/
├── README.md                           # This file
├── _generic-route-template.json       # Base template with all options
└── Routes/
    ├── account-service-routes.json    # Account service example
    └── messaging-service-routes.json  # Messaging service example
```

## 🚀 Usage Pattern (Service Ownership Model)

### When Creating a New Service

1. **Copy template to your service repo:**

   ```bash
   cp Configuration/Templates/Routes/account-service-routes.json \
      apps/services/your-service/ocelot-route.json
   ```

2. **Customize for your service:**
   - Update `ServiceName`
   - Update `DownstreamHostAndPorts` (host, port)
   - Add your routes with proper paths
   - Add Swagger endpoints
   - Set `Active: true` when ready

3. **Deploy with your service:**
   - **Option A (Manual):** Copy `ocelot-route.json` → `Configuration/Routes/`
   - **Option B (CI/CD):** Automated deployment copies file
   - **Option C (Dynamic):** Service registers routes in Consul/etcd

### When Service is Ready

Move the route file from your service to the gateway:

```bash
# Manual deployment
cp apps/services/account-service/ocelot-route.json \
   apps/api-gateway/Configuration/Routes/account-service-routes.json

# Restart gateway or use file watcher for hot reload
```

## 📋 Template Options Explained

### Basic Route Structure

```json
{
  "ServiceName": "YourService",        // Used for Swagger grouping
  "Active": true,                       // false = ignored by JsonMerger
  "SwaggerEndPoints": [ ... ],          // Swagger docs integration
  "Routes": [
    {
      "UpstreamPathTemplate": "/gateway/yourservice/{id}",
      "UpstreamHttpMethod": ["GET", "POST"],
      "DownstreamPathTemplate": "/api/yourservice/{id}",
      "DownstreamScheme": "https",      // or "http"
      "DownstreamHostAndPorts": [
        { "Host": "localhost", "Port": 8080 }
      ]
    }
  ]
}
```

### Advanced Options (Optional)

```json
{
  "Routes": [
    {
      // ... basic config above ...

      // Authentication (requires gateway middleware setup)
      "AuthenticationOptions": {
        "AuthenticationProviderKey": "Bearer",
        "AllowedScopes": ["api.read", "api.write"]
      },

      // Rate Limiting
      "RateLimitOptions": {
        "ClientWhitelist": [],
        "EnableRateLimiting": true,
        "Period": "1s",
        "PeriodTimespan": 1,
        "Limit": 100
      },

      // Circuit Breaker / Quality of Service
      "QoSOptions": {
        "ExceptionsAllowedBeforeBreaking": 3,
        "DurationOfBreak": 10000, // milliseconds
        "TimeoutValue": 5000 // milliseconds
      },

      // Load Balancing (multiple downstream instances)
      "LoadBalancerOptions": {
        "Type": "RoundRobin" // or "LeastConnection", "NoLoadBalancer"
      },

      // Caching
      "FileCacheOptions": {
        "TtlSeconds": 30,
        "Region": "yourservice"
      }
    }
  ]
}
```

## 🔍 Testing Without Downstream Services

Set `Active: false` in your route file:

```json
{
  "ServiceName": "AccountService",
  "Active": false,                     // ← Gateway will ignore this
  "Routes": [ ... ]
}
```

The gateway will load successfully without the service running. When service is ready, set
`Active: true`.

## 🌐 Environment-Specific Configuration

Routes should use environment variables or configuration for downstream URLs:

```json
// Development (local)
"DownstreamHostAndPorts": [
  { "Host": "localhost", "Port": 7072 }
]

// Staging (Docker Compose)
"DownstreamHostAndPorts": [
  { "Host": "account-service", "Port": 80 }
]

// Production (Kubernetes)
"DownstreamHostAndPorts": [
  { "Host": "account-service.default.svc.cluster.local", "Port": 8080 }
]
```

**Future improvement:** Use environment-specific overlay files similar to Kustomize.

## 📊 Big Tech Pattern

This follows the **service ownership model** used by Netflix, Amazon, Uber:

1. ✅ **Services own their routes** (not the gateway team)
2. ✅ **Routes versioned with service code**
3. ✅ **Gateway is configuration consumer, not owner**
4. ✅ **Decentralized control, centralized enforcement**

### Evolution Path

- **Phase 1 (Now):** Manual file copying from service → gateway
- **Phase 2 (5+ services):** CI/CD automation
- **Phase 3 (20+ services):** Dynamic discovery (Consul/Eureka)
- **Phase 4 (50+ services):** Service Mesh (Istio/Linkerd)

## 🚨 Common Mistakes

1. ❌ **Don't put routes directly in `Configuration/Routes/`**  
   ✅ Keep them in service repos, copy during deployment

2. ❌ **Don't use `localhost` in production routes**  
   ✅ Use service names (Docker) or FQDNs (Kubernetes)

3. ❌ **Don't commit active routes to gateway repo**  
   ✅ Routes are deployment artifacts, not source code

4. ❌ **Don't enable all routes at once**  
   ✅ Start with `Active: false`, enable incrementally

## 📚 Additional Resources

- [Ocelot Documentation](https://ocelot.readthedocs.io/)
- [API Gateway Pattern](https://microservices.io/patterns/apigateway.html)
- [Service Discovery Patterns](https://microservices.io/patterns/client-side-discovery.html)

## 🤝 Contributing

When adding new templates:

1. Use descriptive service names
2. Document all custom options
3. Include Swagger configuration
4. Add comments for complex routing rules
5. Test with `Active: false` first
