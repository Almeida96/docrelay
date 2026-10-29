# Service access

## Service credentials

Use one service account per workload and environment. Production credentials
must never be copied to a developer workstation.
Applications obtain short-lived credentials from the secret manager at runtime.
Tokens expire after 60 minutes and should be refreshed five minutes before expiry.

## Emergency access

Emergency access requires approval from the incident commander and expires
after 30 minutes. Record the ticket ID and requested permissions before use.
Export the access audit trail to the incident record after recovery.
Do not share an emergency session between operators.

## Log retention

Keep application logs for 14 days and access audit logs for 90 days.
Redact authorization headers, payment tokens, and email addresses before storage.
Deletion requests are handled by the privacy operations team; changing local
retention settings is not a substitute for the deletion workflow.
