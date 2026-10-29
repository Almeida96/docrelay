# Database operations

## Connection pool exhaustion

The API pool allows 20 connections per instance and waits at most 250 ms.
When pool wait time exceeds 100 ms, inspect long-running transactions and
idle-in-transaction sessions before increasing the pool size.
The database has a service-wide budget of 200 application connections.
Account for canary instances and workers before changing any pool limit.

## Slow queries

Capture query fingerprints and execution plans for queries above 100 ms.
Do not log raw query parameters; they may contain personal information.
Check missing indexes, row estimates, and lock waits before adding replicas.
Use a read replica for reporting queries that tolerate up to 30 seconds of lag.

## Backup restoration

Full backups run daily at 02:00 UTC. Transaction logs are archived every minute.
The recovery point objective is 5 minutes; the recovery time objective is 45
minutes. Restore to a separate instance and verify order counts and checksums
before switching application traffic.
Run a restore drill on the first Tuesday of each month.
Record the actual recovery point and elapsed time in the drill report.
