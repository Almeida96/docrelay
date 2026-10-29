# Queue operations

The orders queue carries payment-confirmed events to fulfillment workers.
Monitor oldest-message age as well as queue length; a short queue can still stall.

## Backlog recovery

Page the on-call engineer if oldest-message age exceeds 120 seconds for five
minutes. Check downstream database latency before adding worker capacity.
Increase workers from 4 to at most 12, in steps of 2 every three minutes.
If database p95 latency rises above 50 ms, stop scaling and investigate queries.
Do not purge the queue to reduce the backlog metric.

## Dead-letter queue replay

Messages enter the dead-letter queue after five failed delivery attempts.
Identify the failure class and fix its cause before replaying messages.
Replay at 20 messages per second into the original orders queue.
Keep the original event_id so the fulfillment consumer can deduplicate it.
Pause replay if consumer errors exceed 1% for two minutes.
Store a replay report with the count, time range, and incident reference.

## Poison messages

A message with an invalid schema is quarantined without another retry.
Record its event_id and schema version, but redact payment tokens from logs.
The producer owner must provide a corrected event; operators must not edit
customer addresses inside the queue console.
