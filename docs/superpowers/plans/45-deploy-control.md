## Implementation Plan

- [x] Account for all Hetzner workloads in deploy-control and fail validation for unmanaged
      workloads.
- [x] Preserve the enabled workload set when one service opts out, including Jaeger and
      ingress-nginx.
- [x] Add automated coverage for the deployment-control/workload-accounting and partial-opt-out
      behavior.
- [x] Validate infrastructure and affected project checks, update this plan, push the branch, and
      open a PR targeting `dev`.
