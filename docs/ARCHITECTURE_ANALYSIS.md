# Unified Email Campaign Platform Architecture Analysis

## Scope and decision record

This document records the repository analysis performed before application behavior was changed. CadenceRelay is the product and runtime base. The AWS sample is a reference implementation for SES and AWS event-delivery patterns; it is not a second product to merge.

The target remains a modular monolith: the existing React application, Express API, PostgreSQL database, and BullMQ workers remain the product boundary. AWS services extend the email delivery boundary. This avoids duplicating authentication, campaign management, recipient storage, templates, and analytics in Cognito, API Gateway, Lambda, and DynamoDB.

## CadenceRelay

### Technology stack

- Frontend: React 18, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, Recharts, React Hook Form, Zod, and Monaco Editor.
- Backend: Node.js 20, Express, TypeScript, Zod, Winston, BullMQ, Nodemailer, and AWS SDK v3.
- Data: PostgreSQL 16 through `pg`; Redis 7 for BullMQ, caching, locks, counters, and rate limiting.
- Packaging/deployment: Docker Compose with development, test, and production variants; Nginx reverse proxy; optional Certbot on the VPS deployment path.
- Tests: Jest/ts-jest server tests. There is no frontend test runner configured.

### Frontend architecture

`client/src/App.tsx` owns the route tree. `DashboardLayout`, `Header`, and `Sidebar` form the authenticated shell. Pages cover login, dashboard, analytics, campaigns and campaign details, contact import and management, lists, templates, projects, automations, bounce/suppression management, and settings. API access is split by domain in `client/src/api`, while TanStack Query hooks in `client/src/hooks` own server-state fetching and invalidation. `AuthContext` stores the JWT session. Campaign and recipient analytics are already rendered by the product UI, so the AWS sample UI is redundant.

### Backend architecture

`server/src/app.ts` creates the Express application and mounts versioned routes. Controllers use parameterized SQL directly through a PostgreSQL pool. Authentication, validation, logging, and error translation are middleware. Sending is asynchronous: API actions enqueue campaign-dispatch work, dispatch materializes campaign recipients and send jobs, and email workers invoke a provider. Separate workers handle schedules, automations, contact health, engagement decay, Gmail bounce polling, and SES events.

The code is a modular monolith, not a collection of independently versioned services. That is an appropriate deployment boundary for the current product. Logical services should remain separable in code without forcing a microservice split.

### Database and migrations

The canonical database is PostgreSQL. `node-pg-migrate` exists and the initial migrations create users, contacts, lists, templates and versions, campaigns, campaign recipients, email events, settings, and unsubscribes. The deployed schema has subsequently been expanded in `scripts/migrate.sql` with smart-list fields, projects, custom variables, labels, suppression, automations, health and engagement data, A/B tests, attachments, accounts, reply-to configuration, and bounce classification.

There is schema drift: many later additions exist only in the idempotent SQL script rather than typed `node-pg-migrate` migrations. New work must use a real migration and should not create duplicate Campaign, Recipient, or Event tables.

### Authentication and tenancy

Authentication uses an `admin_users` table, bcrypt password hashes, JWT access and refresh tokens, and Express authorization middleware. The current schema is effectively a single administrative tenant: campaign, contact, template, and account tables do not consistently carry an owner/tenant key. No AWS credentials are exposed to the React client, but settings APIs must continue masking encrypted secrets.

Production multi-tenancy cannot be truthfully claimed without a separate ownership migration and comprehensive query scoping. This implementation preserves the current single-tenant/admin model and makes tenant tags optional for future use.

### Campaign model

`campaigns` stores template/list associations, draft/scheduled/sending/paused/completed/failed/cancelled state, provider/account selection, start and completion timestamps, per-second and hourly throttle settings, cached counters, template snapshots, A/B-test configuration, reply-to, attachments, labels/projects, and pause reason. Controllers support CRUD, send, schedule, pause/resume/cancel, recipient export, duplication, resend-to-non-openers, transient-bounce resend, and suppression of permanent bounces.

The scheduler promotes due campaigns into dispatch. The dispatcher snapshots template data, resolves normal or smart lists, materializes `campaign_recipients`, renders personalization, adds unsubscribe/tracking URLs, and queues bounded chunks. The current worker uses Redis fixed-window counters and configured fixed rates; it does not fetch SES quota or adapt to feedback.

### Contact and list model

`contacts` stores unique email addresses, names, metadata, status, bounce/send counts, delivery-health fields, engagement score, and domain-specific school fields. `contact_lists` and `contact_list_members` support static lists; smart lists store JSON filter criteria. Import is streamed from CSV and designed for large inputs. Suppression exists both as contact status and an application-level `suppression_list`, with suppressed domains also supported by the later schema.

### Template model

`templates` stores subject, HTML, optional text, variables, active state, project, and version. `template_versions` preserves prior content. The React editor supports HTML editing, preview, import, variables, restore, and test sending. Campaign dispatch snapshots template content to protect an in-flight campaign from later template edits.

### Current sending implementation

`EmailProvider` currently exposes `send` and `verifyConnection`, with shared options/results and SMTP-oriented error classes. `providerFactory` selects SES or Gmail/SMTP and decrypts stored credentials. Campaign sending is recipient-per-job through BullMQ; attachments are loaded into raw MIME messages. Each successful send persists a provider message ID and a `sent` event.

The design already has the right seam but needs richer provider capabilities (`sendBatch`, sending limits, sender verification), trace context, normalized failure classification, and role-based AWS credentials.

### SMTP implementation

`GmailProvider` is a pooled Nodemailer SMTP transport. It supports distinct SMTP auth and visible From addresses, reply-to, attachments, custom headers, connection verification, and classification of common SMTP response, authentication, rate-limit, and network errors. This remains useful and should be kept. Despite the name, it can operate with compatible SMTP relays.

### SES implementation

`SESProvider` uses AWS SDK v3 `@aws-sdk/client-ses` and `SendRawEmailCommand`; Nodemailer constructs MIME to retain attachment support. It records SES `MessageId` and maps several SDK failures into local error classes. Weaknesses are: explicit static credentials are always constructed; SES v1 is used despite SES v2 already being installed; no configuration set or message tags are attached; sending quota and identity status are not exposed; batch capability is absent; and errors are incompletely normalized.

### Tracking and analytics

Application-side open pixels, click redirects, and secure unsubscribe routes use per-recipient tracking tokens. `email_events` provides recipient timelines, IP/user agent fields, and event metadata. Campaign counters and recipient engagement timestamps/counts feed dashboard, campaign, and contact analytics plus CSV exports. Existing analytics calculate open, click, bounce, complaint, unsubscribe, delivery, CTR, and CTOR-style rates.

SES ingestion currently accepts SNS envelopes, queues the embedded event, and handles Delivery, Bounce, and Complaint by SES message ID. Some status-guarded updates reduce duplicates, but there is no stable unique provider-event ID, transaction around event/history/counter updates, explicit Send/Reject/DeliveryDelay/Open/Click support, or signature verification. Engagement must remain orthogonal to delivery state.

### Background jobs and queues

BullMQ queues are `campaign-dispatch`, `email-send`, and `event-processing`. Campaign and send jobs have three exponential-backoff attempts; event jobs have no explicit attempts/backoff or dead-letter retention policy. Workers run independently from the API container and Redis locks protect campaign dispatch. The email worker checks campaign state, fixed per-second/per-hour counters, application daily limits, suppression, and provider failures. Redis/BullMQ remains the local and default queue system.

### Environment variables

Existing variables cover PostgreSQL, Redis, JWT secrets, seed-admin credentials, API port/environment, frontend API URL, tracking domain, Gmail values, and AWS region/access key/secret/from address. Provider credentials may also be encrypted in database account settings. Missing production controls include configuration-set name, optional AWS session token/endpoint, adaptive-rate thresholds, retry policy, event-ingestion mode, and unsubscribe signing configuration.

### Deployment model

The supported deployment is Docker Compose on a VPS: React is built/served through Nginx, with separate API and worker processes plus PostgreSQL and Redis. This remains locally runnable and should stay the default product deployment. An AWS extension stack should create only SES/event/queue/monitoring resources required by this application, rather than replacing the product with API Gateway/Cognito/Lambda/DynamoDB.

## AWS Sample Mass Email System

### Overall architecture

The sample is a separate serverless application. A React/Cloudscape UI authenticates with Cognito and calls API Gateway Lambdas. S3 holds recipient CSVs, generated batches, attachments, and frontend artifacts. Step Functions orchestrates campaign setup, extraction, batch dispatch, and batch monitoring. DynamoDB stores a campaign registry plus dynamically created per-campaign recipient and batch tracking tables. CloudFormation is the sole IaC system, split into foundation, Cognito, email, CI/CD, frontend, and CORS stacks.

### SES sending mechanism and API

The email sender is an SQS-triggered Python Lambda. It uses boto3 SES `send_email` with Simple or Raw content (including attachments), captures `MessageId`, and conditionally supplies `ConfigurationSetName`. It can add SES contact-list/topic subscription-management options and an optional tokenized reply-to integration. Reserved Lambda concurrency is tied to the configured email rate.

### Configuration sets and event destinations

The sample accepts an existing configuration-set name rather than creating the set. When supplied, `AWS::SES::ConfigurationSetEventDestination` adds an EventBridge destination matching delivery, bounce, complaint, reject, open, and click. The sending Lambda applies the configuration set and message tags such as campaign identity and recipient-table identity. This trace-tag/event-destination pattern is reusable; the sample's table-name tag is not.

### SNS, EventBridge, SQS, Lambda, and Step Functions

- EventBridge receives SES events and invokes a delivery-callback Lambda.
- SQS buffers individual send work and has an email DLQ. Lambda event-source mapping consumes batches with controlled concurrency.
- Separate Lambda DLQs receive asynchronous function failures.
- Step Functions coordinates setup, extraction, distributed batch work, waits, checks, and completion; retry clauses cover Lambda service failures.
- EventBridge also reacts to uploaded recipient manifests and state-machine status changes.
- SNS is used for operational error notification, not the main SES feedback path.

For CadenceRelay, EventBridge to SQS is preferable to direct Lambda-to-database delivery: it buffers bursts, provides retry/DLQ semantics, and permits the existing worker to process events. A small Lambda forwarder is only required when the PostgreSQL-backed worker cannot consume SQS directly or is not network reachable.

### Campaign orchestration, batching, and rate handling

The initiator starts a campaign state machine. Setup creates tracking resources. A data extractor splits CSV data into S3 batch files, a batch processor places recipient messages on SQS, and monitor workflows poll DynamoDB until completion. Batch size and email-rate limit are deployment parameters. SQS/Lambda concurrency protects SES, while per-recipient attempts are persisted.

This is appropriate for the sample's million-recipient, fully serverless boundary but too complex for CadenceRelay's existing PostgreSQL/BullMQ campaign workflow. The useful concepts are durable batch boundaries, queue backpressure, bounded concurrency, DLQs, and persisted attempts. Fixed reserved concurrency alone is not the requested adaptive controller.

### Retries and recipient state

Step Functions retries Lambda service exceptions with interval/backoff/max-attempt policies. SQS redrive handles repeated send failures. DynamoDB recipient rows store status, message ID, timestamps, and attempt counts. Sender code distinguishes some client/SES failures, but its retry model is coupled to Lambda/SQS and does not provide the complete product-level retry taxonomy requested here.

### Bounce, complaint, delivery, open, and click handling

The EventBridge callback maps modern SES detail types and legacy `eventType` values. Delivery/bounce/complaint/reject change the DynamoDB recipient status; open/click set engagement flags without overwriting delivery. Bounce type/subtype and complaint feedback type are retained. Updates require the recipient row to exist. The processor is not a complete event ledger and has no stable event-id uniqueness, so its logic is a reference rather than code to copy.

The sample event destination omits send, rendering failure, delivery delay, and subscription events. Those must be added in the unified design where supported by the selected SES event schema.

### Persistence and infrastructure

CloudFormation provisions KMS keys, encrypted/versioned S3 buckets, DynamoDB, IAM roles/policies, Lambda functions/log groups, SQS queues/DLQs, SNS alarms, EventBridge rules, Step Functions, API Gateway/WAF, Cognito, CloudFront, and CI/CD. Strong patterns worth adapting are least-privilege IAM, encryption, TLS-only bucket policies, log retention, CloudWatch alarms, queue redrive, conditional DynamoDB updates, and masked email logs.

The per-campaign DynamoDB-table approach, S3 CSV source of truth, Cognito/API Gateway product API, React UI, dynamic tracking resources, and Step Functions orchestration must not be copied because PostgreSQL, BullMQ, JWT auth, and the CadenceRelay UI already own those concerns.

## Requirement mapping

| Requirement | CadenceRelay implementation | AWS implementation | Final implementation | Action |
| --- | --- | --- | --- | --- |
| Product UI/dashboard | Full React/TypeScript product UI | Separate React/Cloudscape UI | CadenceRelay UI | KEEP |
| Authentication | JWT + PostgreSQL admin user | Cognito | Existing auth; document current single-tenant boundary | KEEP |
| Contacts/lists/CSV | PostgreSQL static/smart lists and streamed CSV | S3 CSV and SES contact lists | PostgreSQL remains source of truth | KEEP |
| Templates | Versioned HTML/text templates and editor | SES templates and Quill editor | CadenceRelay templates rendered before send | KEEP |
| Campaign lifecycle | Draft/schedule/send/pause/resume/cancel, BullMQ | Step Functions executions and registry | PostgreSQL state machine with BullMQ orchestration | REFACTOR |
| Provider abstraction | `send` + `verifyConnection`; SES/Gmail | Direct boto3 SES | Capability-rich interface; retain SMTP | REFACTOR |
| SES API | SES v1 raw-email SDK call | boto3 SES v2-style content call | AWS SDK v3 SESv2 `SendEmail`, raw MIME, tags/config set | REPLACE |
| IAM credentials | Encrypted static account credentials | Lambda execution role | Default provider chain/IAM role; optional local keys | ADAPT |
| Sender verification | Connection probe only | Lists verified identities | Provider identity lookup/verification status | NEW |
| Sending quota | App daily counter only | Deployment rate parameter | SES account quota + app/campaign caps | NEW |
| Batching/queue | BullMQ recipient jobs in chunks | S3 batches to SQS | Keep BullMQ locally; durable bounded job generation | REFACTOR |
| Adaptive throughput | Fixed Redis windows | Fixed Lambda concurrency | Feedback-driven controller bounded by SES/app/campaign limits | NEW |
| Retry taxonomy | Custom exceptions, BullMQ exponential retry | SQS redrive + Step Functions retries | Explicit retryability, exponential backoff with jitter, max attempts, failed-job/DLQ visibility | REFACTOR |
| SES configuration set | Absent | Existing set attached to sends and EventBridge | Configurable set on every SES send | ADAPT |
| Traceability | Message ID + tracking token | Message ID + SES tags | campaign/recipient/attempt/tenant SES tags and structured logs | NEW |
| Event transport | Public SNS webhook to BullMQ | SES -> EventBridge -> Lambda | SES -> EventBridge -> SQS/DLQ -> processor; signed SNS compatibility retained | ADAPT |
| Event idempotency | Status guards only | Conditional recipient update | Stable event fingerprint + unique DB constraint + transaction | NEW |
| Delivery/bounce/complaint | Partial SNS support | EventBridge callback | Unified parser and event service | REFACTOR |
| Send/reject/delay/open/click | Local open/click only; reject/delay absent | Reject/open/click supported | All supported SES lifecycle events plus local engagement | NEW |
| Engagement vs delivery | Recipient status may become opened/clicked | Separate flags | Delivery state never destroyed by engagement | REFACTOR |
| Event history | `email_events` timeline | Current-state DynamoDB rows | Append-only PostgreSQL ledger with unique provider event IDs | REFACTOR |
| Suppression | Contact status, unsubscribe, list/domain suppression | SES contact topics | App suppression source of truth; optional SES account-level lookup/write | REFACTOR |
| Unsubscribe | Token routes and RFC 8058 headers/footer | SES contact-list topics | HMAC tokens, one-click POST, global app suppression; optional SES sync | REFACTOR |
| Metrics | Existing dashboard/rates/timelines | DynamoDB monitor | SQL aggregation from deduplicated recipient/events data | REFACTOR |
| Pre-send quality | Basic spam checker and renderer | Frontend validation | Modular deterministic quality service and API | NEW |
| Infrastructure | Docker Compose/VPS | Six CloudFormation stacks | Compose retained; one focused CloudFormation AWS integration stack | ADAPT |
| Observability | Winston and worker logs | CloudWatch logs/alarms/SNS | Structured correlation fields, queue/error/rate metrics, CloudWatch resources | REFACTOR |
| Multi-tenancy | Not consistently modeled | Cognito users, shared resources | Do not claim tenancy; future owner key migration | KEEP |

## Target architecture

```text
CadenceRelay React UI
        |
Express Campaign API (JWT)
        |
Campaign orchestration service
  segmentation -> suppression -> quality/validation -> materialize recipients
        |
BullMQ dispatch/send queues (Redis)
        |
SES send workers -> EmailProvider -> SESProvider -> Amazon SES
                                              |
                                  Configuration Set
                                              |
                              EventBridge destination
                                              |
                                   SQS event queue -> DLQ
                                              |
                               SES event processor worker
                                              |
              PostgreSQL recipient state + send attempts + event ledger
                                              |
                              Analytics API -> existing UI
```

In a VPS deployment the worker may poll the AWS SQS event queue. SNS HTTPS ingestion remains a compatibility mode and must validate signatures before accepting envelopes. Local development uses Redis/BullMQ and mocked SES; LocalStack is optional.

## Required database changes

1. Extend campaign-recipient lifecycle values with `sending`, `rejected`, `delivery_delayed`, `suppressed`, while treating open/click as engagement timestamps rather than primary delivery states.
2. Add `email_send_attempts` for provider, attempt number, stable correlation ID, provider message ID, outcome, retry classification, error code/message, and timestamps.
3. Extend `email_events` with stable `event_id`, provider, provider message ID, send-attempt reference, provider timestamp, normalized event type, and source. Add a unique provider/event ID constraint.
4. Enrich application `suppression_list` with normalized email, scope/source/reason, provider metadata, timestamps, and indexes without duplicating it.
5. Add campaign operational fields for effective/current rate, delay/throttle/transient observations, delivered/rejected/delayed/suppressed counters, and automated pause reason where necessary.
6. Add indexes for campaign/status, recipient/provider-message, attempt/correlation/message, event campaign/type/time, and normalized suppression email.

All changes belong in a new `node-pg-migrate` migration. Existing columns remain for compatibility and are backfilled rather than discarded.

## Required AWS resources

- SES v2 verified domain/email identity managed independently or optionally referenced by IaC.
- SES configuration set with reputation and sending enabled.
- EventBridge configuration-set destination covering send, delivery, bounce, complaint, reject, delivery delay, rendering failure, open, click, and subscription events supported by SES.
- EventBridge rule routing SES events to an encrypted SQS event queue.
- SQS dead-letter queue and redrive policy.
- Queue policy allowing EventBridge `SendMessage` from the specific rule.
- Least-privilege IAM policy for the CadenceRelay API/worker role: SES send/quota/identity/suppression operations and SQS receive/delete/change-visibility/get-attributes.
- CloudWatch log/metric filters, alarms for DLQ depth, queue age/depth, throttling/failure signals, bounce rate, and complaint rate; optional SNS operational-alert topic.

PostgreSQL and Redis remain CadenceRelay infrastructure. Step Functions, DynamoDB, Cognito, API Gateway, the sample frontend, and per-campaign AWS resources are not required.

