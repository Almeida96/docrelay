# Cache operations

## Cache stampedes

Product snapshots have a 300 second TTL with random jitter of up to 30 seconds.
Use a per-key single-flight lock so only one request refreshes an expired entry.
Serve stale product data for up to 60 seconds while the refresh is in progress.
Never serve stale inventory counts during checkout; read them from the database.

## Invalidation

Invalidate product details after a product.updated event is committed.
Use versioned keys with the product ID and schema version.
During a schema change, let the old namespace expire rather than flushing the
entire cache. A full flush can overload the database.

## Cache outage

When the cache is unavailable, enable the database fallback with a concurrency
limit of 10 requests per API instance. Shed reporting traffic first.
Track the fallback rate and database connection wait time until recovery.
Warm the 100 most frequently requested products before disabling the fallback.
