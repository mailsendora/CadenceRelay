# Sendora + Senqo WhatsApp Integration Architecture

## 1. Decision summary

Sendora remains the product shell and system of record for identity, projects,
email contacts, email campaigns, SES events and global analytics. Senqo remains
the WhatsApp domain application: Baileys sessions, WhatsApp numbers, inbox,
AI agents, knowledge bases, WhatsApp conversations and WhatsApp delivery.

Senqo must not be copied blindly into Sendora and its tables must not be merged
by name. The recommended implementation is a modular sidecar deployment in one
repository/workspace:

```text
Browser
  |
  v
Sendora web shell (one login, one left navigation)
  |-- /email/*       Sendora React routes
  |-- /whatsapp/*    Senqo React routes mounted below the shell
  |
  v
Edge reverse proxy (one public origin)
  |-- /api/v1/*      Sendora API
  |-- /whatsapp-api/* Senqo API/BFF
  |-- /whatsapp-svc/* Baileys service (private only)
  |
  +--> Sendora API + worker ----> SES / email queues
  +--> Senqo backend -----------> PostgreSQL / R2 / pg-boss
  +--> WhatsApp service --------> WhatsApp Web/Baileys
  |
  v
One PostgreSQL database, isolated schemas + integration schema
```

This gives the user one Sendora experience while retaining Senqo's tested
WhatsApp boundaries. It also allows Senqo to be upgraded without rewriting the
email product.

## 2. What must be inspected before implementation

The Senqo repository is not currently present beside Sendora. Before coding,
clone it into the parent folder and inspect `AGENTS.md`, compose files, Drizzle
schema/migrations, auth middleware, frontend router, backend routes, webhook
handlers and WhatsApp service API. The actual table and endpoint names must be
recorded in a compatibility matrix before any migration is written.

Required compatibility checks:

| Area | Sendora | Senqo | Integration rule |
| --- | --- | --- | --- |
| Runtime | Node/Express/React | Node/Hono/React | Keep service boundaries; share only contracts |
| Auth | admin JWT | workspace/cookie auth | Sendora is IdP; bridge token creates Senqo session |
| Contacts | `contacts`, email identity | workspace contacts/phone identity | Link by tenant + normalized email/phone, never email alone |
| Campaigns | email campaigns | WhatsApp campaigns/flows | Integration links, no table rename/overwrite |
| Jobs | BullMQ/Redis workers | pg-boss | Keep queues separate; integration outbox provides delivery |
| Storage | local/uploads as applicable | Cloudflare R2/S3 | Keep R2 for WhatsApp assets; do not duplicate uploads |
| Events | SES EventBridge/SQS | WhatsApp webhooks | Normalize into integration events |
| UI | Sendora dashboard shell | Senqo SPA | Mount Senqo routes behind Sendora shell/navigation |

## 3. Unified authentication

There must be one browser login. Do not ask the user to log into WhatsApp a
second time.

1. User signs in at Sendora.
2. Sendora access JWT remains the browser's primary credential.
3. Clicking **WhatsApp** calls `POST /api/v1/integrations/whatsapp/session`.
4. Sendora validates the user/tenant and creates a short-lived, one-time bridge
   token containing `iss=sendora`, `sub=user_id`, `tenant_id`, `aud=senqo`,
   `jti`, `iat`, `exp` and a nonce. It contains no password or provider secret.
5. The browser navigates to `/whatsapp/sso?token=...` on the same origin.
6. Senqo backend validates the token using a private shared signing key or
   internal token-exchange endpoint, creates its normal secure HttpOnly session
   cookie, consumes the nonce, and redirects to `/whatsapp/inbox`.
7. The token is removed from the URL immediately. It is never logged.

For production, prefer asymmetric signing (Sendora private key, Senqo public
key) or an internal mTLS token-exchange endpoint. The two applications must
share tenant membership and authorization claims, not user passwords. Logout
at Sendora revokes/ends the Senqo session through the integration endpoint.

## 4. One PostgreSQL database without destructive table merging

The requirement is one PostgreSQL instance/database, not one flat namespace.
Use one database and three logical schemas:

```text
sendora      existing email/product tables
senqo        Senqo tables, adapted through Drizzle schema/search_path
integration  cross-channel identity, links, rules, outbox and projections
```

If Senqo cannot be schema-qualified safely, keep its tables in `public` with a
`senqo_` prefix and document that as a compatibility exception. Never rename
existing Sendora tables such as `contacts`, `campaigns` or `email_events` just
to match Senqo.

Compose runs one PostgreSQL service and passes the same `DATABASE_URL` to both
backends. Each migration remains owned by its application; the integration
migrations are run once by a dedicated migration job. Existing Sendora data is
preserved and Senqo migrations are imported/rebased only after a schema diff.

## 5. Integration data model

Only these cross-system entities belong in the `integration` schema:

### `integration_tenants`

Maps Sendora tenant/admin ownership to the Senqo workspace. Includes
`sendora_tenant_id`, `senqo_workspace_id`, status and timestamps.

### `contact_identities`

One row per external identity:

```text
id, tenant_id, sendora_contact_id, senqo_contact_id,
email_normalized, phone_e164, whatsapp_opt_in, source,
created_at, updated_at
```

Uniqueness is `(tenant_id, sendora_contact_id)` and, where present,
`(tenant_id, phone_e164)`. Email-to-phone matching is never performed globally
or by fuzzy name matching; ambiguous matches require manual confirmation.

### `channel_campaign_links`

Maps products without coupling their primary tables:

```text
id, tenant_id,
sendora_project_id, sendora_campaign_id,
senqo_workspace_id, senqo_campaign_id, senqo_flow_id,
label, status, created_by, created_at
```

One email campaign may have multiple WhatsApp follow-up flows. A WhatsApp flow
may be linked to one email campaign or a project-level default. All reads are
tenant-scoped.

### `cross_channel_rules`

```text
id, tenant_id, project_id, email_campaign_id,
trigger_type, conditions_json, action_type, action_json,
cooldown_seconds, enabled, created_by, created_at
```

Supported initial triggers: `email_opened`, `email_clicked`,
`email_replied`, `email_delivered`, `email_bounced`. Supported initial action:
`start_whatsapp_flow` or `send_whatsapp_template`.

### `cross_channel_events`

Normalized immutable event ledger:

```text
id, tenant_id, source, source_event_id, event_type,
sendora_campaign_id, sendora_recipient_id, senqo_workspace_id,
senqo_contact_id, payload_json, occurred_at, processed_at
```

Unique `(source, source_event_id)` makes dispatch idempotent. Raw provider
payloads are minimized/redacted; no full email body or credentials are stored.

### `integration_outbox`

Transactional outbox rows for actions to Senqo. Fields include event ID,
destination, payload, attempts, next retry time, status and last error. A
worker delivers these through the Senqo internal API and moves permanent
failures to a DLQ.

## 6. Email-to-WhatsApp automation flow

```text
SES OPEN/CLICK event or inbound EMAIL_REPLY
  -> Sendora event processor (idempotent)
  -> normalized cross-channel event
  -> evaluate tenant/project/campaign rules
  -> verify contact identity + WhatsApp opt-in + suppression/consent
  -> enforce cooldown, frequency and 24h/template policy
  -> insert integration_outbox with unique action key
  -> WhatsApp integration worker calls Senqo internal API
  -> Senqo starts flow/sends approved template
  -> Senqo webhook returns queued/sent/delivered/failed/replied
  -> cross-channel event + campaign projection updated
```

An email **open** is a weak signal and can be generated by privacy proxies;
the default rule should require a click or reply for a WhatsApp action. The
product may allow open-triggered actions, but it must display a warning and
provide a cooldown. Email `replied` requires a real inbound email source
(provider webhook or the existing IMAP/mailbox processor); it must never be
inferred from an open event.

Before any WhatsApp send, verify:

- contact has a valid E.164 phone and WhatsApp opt-in;
- tenant/workspace is active;
- recipient is not globally unsubscribed or blocked;
- a WhatsApp template is approved when the 24-hour service window requires it;
- rule cooldown/frequency caps allow the action;
- the action idempotency key has not already been delivered.

## 7. UI and navigation

Sendora's left panel gets a **WhatsApp** section with these routes:

```text
/whatsapp/inbox
/whatsapp/contacts
/whatsapp/campaigns
/whatsapp/automations
/whatsapp/agents
/whatsapp/knowledge
/whatsapp/connect
/whatsapp/settings
```

The Senqo screens remain functionally complete. The shell supplies Sendora
navigation, tenant context, error boundary and logout. A shared campaign
context bar shows `Project`, `Email campaign`, `WhatsApp flow`, connection
status and consent warnings.

### Email campaign detail

Add a WhatsApp tab/side panel showing:

- linked WhatsApp flow/campaign name and ID;
- contacts eligible, skipped and sent;
- WhatsApp delivery/reply status;
- rule that caused the action;
- per-contact email + WhatsApp timeline;
- link to open the conversation in the WhatsApp inbox.

### WhatsApp campaign/inbox

Show linked Sendora project/campaign name and ID wherever a WhatsApp action was
triggered by email. Filters must be backed by the normalized event/projection
queries, not frontend-only filtering.

### Unified dashboard

Keep email and WhatsApp metrics separate, with an optional combined view:

```text
Email: sent, delivered, opened, clicked, replied, bounced, complained
WhatsApp: queued, sent, delivered, read, replied, failed
Cross-channel: eligible, suppressed, triggered, skipped, converted
```

Do not add email opens to WhatsApp delivery counts or combine incompatible rate
denominators. Every chart exposes its source channel and denominator.

## 8. Deployment and environment contract

One root `.env` and `.env.example` are used. Variables are namespaced to avoid
collisions:

```env
# Shared
DATABASE_URL=postgresql://...
JWT_SECRET=...
FRONTEND_URL=https://...

# Sendora
AWS_REGION=...
SES_CONFIGURATION_SET=...

# Senqo
SENQO_DATABASE_SCHEMA=senqo
SENQO_S3_BUCKET=...
SENQO_S3_ENDPOINT=...
SENQO_S3_ACCESS_KEY=...
SENQO_S3_SECRET_KEY=...
SENQO_MODEL_PROVIDER=openai
SENQO_OPENAI_API_KEY=...

# Internal service bridge
SENQO_API_INTERNAL_URL=http://senqo-backend:3001
SENQO_WHATSAPP_INTERNAL_URL=http://whatsapp:3002
SENDORA_SSO_PRIVATE_KEY=...
SENQO_SSO_PUBLIC_KEY=...
WHATSAPP_SERVICE_API_KEY=...
WHATSAPP_WEBHOOK_AUTHORIZATION=...
```

If product policy requires one OpenAI key, use a shared `OPENAI_API_KEY` with
explicit service permissions; never send it to the browser. R2 remains required
for Senqo media and WhatsApp assets. Sendora's SES credentials remain backend
only.

Production exposes only the frontend/Caddy port. Backend, WhatsApp, Postgres,
Redis and pg-boss/BullMQ are private Docker-network services. WhatsApp session
files stay on a persistent, encrypted host volume; R2 stores media.

## 9. Observability and failure handling

Every cross-channel log includes:

```text
tenant_id, project_id, email_campaign_id, email_recipient_id,
whatsapp_workspace_id, whatsapp_campaign_id, cross_channel_event_id,
outbox_id, source_event_id
```

Metrics include outbox depth, Senqo API latency, webhook lag, duplicate events,
consent skips, rate-limit skips, failed actions and DLQ size. A WhatsApp outage
must not pause an email campaign; actions remain in the outbox and retry with
backoff. A failed cross-channel action is visible in the email campaign
timeline and can be replayed safely.

## 10. Implementation milestones

1. Clone Senqo and complete the compatibility matrix/schema diff.
2. Extract/confirm Senqo internal API contracts and webhook authentication.
3. Create one PostgreSQL database with isolated schemas and a migration runner.
4. Implement tenant/contact identity and campaign-link migrations.
5. Implement Sendora-issued SSO token exchange and Senqo session adapter.
6. Mount Senqo frontend below the Sendora shell and add WhatsApp navigation.
7. Add normalized event ledger and transactional outbox.
8. Add email event/reply triggers with consent, cooldown and idempotency checks.
9. Add Senqo action worker/webhook projection and linked campaign UI.
10. Add combined dashboard filters, audit logs, DLQ replay and end-to-end tests.

Verification must include duplicate event delivery, revoked SSO token,
cross-tenant access attempts, contact merge ambiguity, WhatsApp opt-out,
24-hour template rules, Senqo outage/retry, and email campaign continuity.

## 11. Deliberate non-goals

- No second login screen.
- No flat merge of two unrelated schemas.
- No direct browser-to-Baileys access.
- No automatic WhatsApp messaging without opt-in and rule evaluation.
- No assumption that an email open means a human intent or reply.
- No replacement of Sendora's SES/email campaign engine with Senqo jobs.
- No hard dependency on a specific OpenAI provider for either product.

## 12. Verified Senqo repository findings (M1)

The repository is now cloned at `senqo/` and the first compatibility pass is
complete. These are confirmed facts that refine the design above:

- Senqo has `frontend/`, `backend/`, `whatsapp/` and `database/` packages.
- Its backend is Hono + Drizzle and its WhatsApp service is a separate Baileys
  process on port 8080 internally.
- Its production compose currently creates a separate PostgreSQL 18 database
  named `senqo` and a separate migration service.
- Senqo's base migration creates a public `contacts` table, while Sendora also
  has a public `contacts` table. Pointing both applications at one flat
  database without schema isolation would be unsafe.
- Senqo authentication is email/password with HS256 JWT access/refresh tokens;
  workspace routes require `X-Workspace-Id`. Its frontend stores its own
  `senqo_auth` token and chooses a workspace before entering routes such as
  `/:workspaceId/dashboard`, `crm`, `agent`, `knowledge`, and `connect`.
- Senqo's backend already has internal WhatsApp routes and webhook handling;
  the Baileys service is not exposed publicly in production.
- Senqo declares Node 22.12+ while Sendora currently uses Node 20. Keeping
  separate images avoids a forced runtime downgrade/upgrade during the first
  integration. A later workspace build may standardize on Node 22 after tests.

These findings mean the first implementation should be an integration shell,
SSO/token exchange and shared-database migration—not a direct table or auth
merge. Senqo's own frontend token storage and workspace chooser must be adapted
to accept the bridge session while preserving its standalone sign-in route.
