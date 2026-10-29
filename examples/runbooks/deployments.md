# Deployments

Harbor is a fictional order-processing service. These runbooks are sample data,
not instructions for a real production environment.

## Release procedure

Every release uses an immutable container image digest. Record the digest and
the database migration number in the change ticket before starting.
Deploy to the canary pool first. The canary receives 5% of incoming requests.
Observe it for 15 minutes before expanding to the remaining instances.
Only the on-call engineer can approve the final rollout.

## Rollback triggers

Roll back when the API error rate exceeds 2% for five consecutive minutes,
or when checkout p95 latency exceeds 800 ms for ten minutes.
Compare both measurements with the previous release before acting.
Stop the rollout, restore the previous image digest, and confirm the error rate
returns below 0.5%. Keep the change ticket open until the canary is healthy.
Do not reverse a database migration automatically during an application rollback.

## Database migrations

Schema changes follow expand-and-contract: add the new nullable column first,
deploy code that handles both schemas, backfill in batches of 500 rows, then
remove the old column in a later release after checking all readers.
Destructive migrations require a restore drill and a reviewed recovery plan.
An application rollback must remain compatible with the expanded schema.

## Verification

Run the checkout smoke test with a sandbox customer after every release.
Verify the order appears exactly once and the payment event reaches the worker.
Use the release digest as the deployment marker in the latency dashboard.
