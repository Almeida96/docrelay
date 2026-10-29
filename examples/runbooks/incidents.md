# Incident response

## Severity levels

SEV1 means checkout is unavailable or confirmed customer data loss is ongoing.
SEV2 means degraded service with a working alternative or a delayed queue.
The incident commander can raise severity when the scope is uncertain.

## Communication

For SEV1, assign an incident commander and a separate communications lead.
Publish the first status update within ten minutes of declaring the incident.
Provide updates every 20 minutes, including the impact, mitigation, and next
update time. Keep customer names and credentials out of status messages.
Record decisions with UTC timestamps in the incident timeline.

## Post-incident review

Schedule a review within three business days after recovery.
Write down the trigger, contributing conditions, detection gaps, and recovery
steps. Each follow-up needs an owner, a due date, and a verifiable outcome.
Check whether existing alerts fired before proposing a new alert.
Close the incident after the timeline and follow-up owners are recorded.
