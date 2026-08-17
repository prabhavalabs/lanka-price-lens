# Backend architecture

The operational database and public releases are deliberately separate.

1. The foundry reads a source manifest and enforces its rights status.
2. Discovery records candidate publications without assuming one exists.
3. Fetch stores immutable bytes and retrieval metadata when permitted.
4. PDF extraction preserves page and coordinate evidence.
5. Mapping and validation either accept a record or quarantine it with a
   stable reason.
6. The owner API exposes operational state but does not mutate ingestion data.

Canonical mapping, validation, immutable public releases, and the consumer
trend API are the next milestone. Their stages are recorded as `skipped` until
implemented, so the dashboard does not imply that staging rows are published.

SQLite is sufficient for the single-owner workflow. Add PostgreSQL only when
concurrent reviewers or user-generated writes become a real requirement.
