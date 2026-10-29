# Webhook delivery

## Signature verification

Verify the X-Harbor-Signature header with HMAC-SHA256 over the raw request body.
Compare signatures with a constant-time function. Reject timestamps more than
five minutes old. Parsing and reserializing JSON before verification changes
the signed bytes and must be avoided.

## Acknowledgment and delivery

Persist the event before returning HTTP 202. Acknowledge within two seconds.
Process business logic asynchronously after persistence.
Delivery is at least once, so consumers must deduplicate by event_id.
Keep the deduplication record for seven days. Event order is not guaranteed.
Fetch the current order state when an older event arrives after a newer one.

## Signing key rotation

Publish the new key identifier at least 24 hours before switching the sender.
Accept both old and new signing keys during a 48-hour overlap window.
Remove the old key after confirming no recent delivery uses its identifier.
If a key is compromised, revoke it immediately and use the incident process;
the normal overlap window does not apply.
