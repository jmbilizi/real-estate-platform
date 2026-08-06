# syntax=docker/dockerfile:1
#
# PostgreSQL 18 + PostGIS 3.6 + pgvector — the platform's database image.
#
# Why a derived image rather than a public one: no trusted image publishes both PostGIS and
# pgvector, and property_db needs both — postgis for durable property geography
# (geography(Point,4326) with a GiST index) and pgvector for listing/property embeddings.
# The PGDG apt repository is already configured inside postgis/postgis:18-3.6
# (/etc/apt/sources.list.d, "trixie-pgdg main 18"), so this is a single package install from
# PostgreSQL's own repository and provenance stays official on both sides.
#
# The pgvector version is pinned deliberately, not left to apt: CVE-2026-3172 is a buffer overflow
# in pgvector's parallel HNSW index build affecting 0.6.0-0.8.1, which lets a database user read
# other relations or crash the server. Debian trixie's own archive ships the vulnerable 0.8.0, so an
# unpinned install could silently resolve to it.
#
# `CREATE EXTENSION vector` is deliberately NOT run here. It is per-database and requires SUPERUSER
# (vector.control carries no `trusted` flag, unlike pg_trgm), so it is provisioned at runtime by
# postgres_sa — see infra/k8s/base/configmaps/postgres.configmap.yaml.
FROM postgis/postgis:18-3.6

ARG PGVECTOR_VERSION=0.8.6-1.pgdg13+1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        "postgresql-18-pgvector=${PGVECTOR_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    # Fail the build rather than let a packaging change surface later as a missing extension.
    && test -f /usr/lib/postgresql/18/lib/vector.so
