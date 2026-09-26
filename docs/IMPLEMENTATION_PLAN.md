# Unified Email Platform Implementation Plan

## Delivery principles

- Sendora stays runnable throughout the work; migrations are additive and reversible where data preservation permits.
- Existing SMTP/Gmail behavior remains available.
- No test invokes a real provider.
- Provider, event normalization, persistence, suppression, quality, and rate-control modules are independently testable.
- PostgreSQL is the source of truth for product-visible state. Redis and AWS queues transport work but do not own analytics.

## M1 — Repository understanding

**Files affected:** `docs/ARCHITECTURE_ANALYSIS.md`, `docs/IMPLEMENTATION_PLAN.md`, later `README.md`.

**New files:** the two analysis/plan documents.

**Database changes:** none.

**Dependencies:** none.

**Risks:** deployed schema differs from the initial typed migration because `scripts/migrate.sql` contains later additions; current product is single-tenant despite optional user-oriented requirements.

**Verification:** inventory manifests and runtime entry points; trace API -> queue -> provider and SES event -> queue -> persistence; record a requirement mapping before behavior changes; capture baseline build/tests.

## M2 — Provider abstraction

**Files affected:** `server/src/services/email/EmailProvider.ts`, `GmailProvider.ts`, `providerFactory.ts`, settings/account validation call sites.

**New files:** `server/src/services/email/errors.ts` if separation improves clarity.

**Database changes:** none.

**Dependencies:** existing AWS SDK v3 and Nodemailer only.

**Risks:** breaking current provider implementations or test-send endpoints; widening the interface unnecessarily.

**Verification:** TypeScript build; existing Gmail tests; unit tests for default capability behavior and retry classification.

## M3 — SES sender

**Files affected:** `server/src/services/email/SESProvider.ts`, `providerFactory.ts`, `server/src/config/index.ts`, `.env.example`, email worker send call.

**New files:** SES unit tests and shared trace types.

**Database changes:** introduce `email_send_attempts`; add correlation/provider message indexes.

**Dependencies:** use installed `@aws-sdk/client-sesv2`; add no duplicate AWS SDK.

**Risks:** raw MIME compatibility, SES tag character constraints, configuration-set errors, credential-chain behavior, attachment size.

**Verification:** mocked SES v2 send, quota, and identity calls; ensure configuration set and campaign/recipient/attempt tags are present; validate IAM-role mode without static credentials; never send externally.

## M4 — SES event pipeline

**Files affected:** webhook route/controller, event worker, queue defaults, app JSON-body handling, configuration.

**New files:** normalized SES event parser, event service, optional SQS poller, signature-verification module, parser fixtures/tests, focused CloudFormation template.

**Database changes:** add event ID/provider/message/timestamp/source columns and uniqueness constraint to `email_events`.

**Dependencies:** prefer installed AWS SDK packages; add the narrow AWS SQS package only if an SQS poller is implemented. SNS signature verification must use Node crypto/HTTPS and trusted AWS certificate URLs.

**Risks:** SES EventBridge and SNS envelope differences, out-of-order delivery, duplicate messages, event timestamps, unsafe SNS subscription confirmation.

**Verification:** fixtures for send, delivery, bounce, complaint, reject, delivery delay, rendering failure, open, click, and subscription; duplicate ingestion test; transaction rollback test; malformed/untrusted SNS rejection test.

## M5 — Recipient status/event model

**Files affected:** event service, send worker, campaign/analytics controllers, campaign detail types/UI only where required.

**New files:** lifecycle transition policy and tests.

**Database changes:** expand recipient state constraint; create `email_send_attempts`; extend event types and operational campaign counters.

**Dependencies:** M3 and M4.

**Risks:** out-of-order events regressing terminal status; engagement overwriting delivery; cached counters diverging from ledger.

**Verification:** transition-table tests; timeline query test; reconcile campaign metrics from recipient/event data; TypeScript client build.

## M6 — Suppression

**Files affected:** suppression controller/service, dispatcher and send worker, tracking unsubscribe controller, SES event service.

**New files:** suppression service with normalized address/scope/source semantics and unit tests.

**Database changes:** evolve existing `suppression_list`; indexes and unique active-suppression rule; no second suppression table.

**Dependencies:** optional SES v2 account-level suppression methods.

**Risks:** race between dispatch and complaint/bounce, soft-bounce over-suppression, provider suppression availability by region/account.

**Verification:** hard bounce, complaint, global unsubscribe, suppressed-domain, and pre-send race tests; SES suppression failure cannot erase local suppression.

## M7 — Metrics/dashboard integration

**Files affected:** analytics and campaign controllers, analytics API types, dashboard/campaign detail components.

**New files:** SQL metric aggregation helper/tests if useful.

**Database changes:** add/reconcile delivered, delayed, rejected, suppressed, and attempted counters or compute from indexed facts.

**Dependencies:** normalized lifecycle/event model.

**Risks:** unique recipient metrics versus total event metrics; machine-generated opens; division-by-zero; legacy data.

**Verification:** aggregation fixture covers all required counters and delivery/bounce/complaint/open/click/CTR/CTOR formulas; duplicate events do not alter unique metrics.

## M8 — Adaptive sending

**Files affected:** send worker, campaign orchestration/controller, queue defaults, settings/config.

**New files:** adaptive rate controller, retry classifier/backoff helper, health-window store, tests.

**Database changes:** persist effective rate, feedback window, automatic pause reason, attempt/retry outcome fields.

**Dependencies:** SES quota capability and normalized feedback events.

**Risks:** oscillation, distributed-worker races, quota exhaustion, pausing small campaigns on noisy samples.

**Verification:** deterministic controller tests for healthy ramp, throttle/delay/transient/bounce reduction, min/max bounds, quota exhaustion, and complaint/bounce safety pause; jitter tested within bounds.

## M9 — Pre-send quality engine

**Files affected:** campaign/template controllers and routes; campaign creation/review UI if surfaced immediately.

**New files:** `server/src/services/emailQuality/*` and tests.

**Database changes:** none initially; quality results may be evaluated on demand.

**Dependencies:** avoid a large HTML parser unless existing utilities cannot safely implement deterministic checks.

**Risks:** false confidence, link network checks leaking draft URLs or slowing requests, simplistic HTML heuristics.

**Verification:** tests for subject/from/reply-to, HTML/text, size, URL syntax, unsubscribe/list-unsubscribe, image-only ratio, link count, and missing alt; response explicitly labels score as internal quality, not inbox probability.

## M10 — Infrastructure/deployment

**Files affected:** `.env.example`, Docker Compose worker environment, `README.md`.

**New files:** one focused CloudFormation template under `Infrastructure/CloudFormation` plus AWS deployment documentation.

**Database changes:** migration execution documented for production.

**Dependencies:** AWS CLI/CloudFormation only for deployment; optional LocalStack documentation.

**Risks:** existing configuration-set ownership, VPC access from Lambda if a forwarder is selected, IAM overreach, EventBridge event coverage varying by SES.

**Verification:** CloudFormation validation/lint where tools exist; inspect IAM resources; deployment outputs provide queue URL/ARN, DLQ, configuration set, and rule; Compose starts without AWS integration configured.

## M11 — Tests and hardening

**Files affected:** test fixtures/config, README, operational documentation, any defects found.

**New files:** SES/event/suppression/retry/metrics/rate/pause/quality test suites.

**Database changes:** verify up/down migration in an isolated test database.

**Dependencies:** existing Jest/ts-jest; mocked AWS clients.

**Risks:** integration behavior not represented by mocks; baseline repository test/build failures; large-dataset query performance.

**Verification:** server build, Jest suite in-band, client production build, Docker Compose config, migration up/down/up, no secrets in tracked files, and `git diff --check`.

## M12 — Campaign governance and recipient protection

**Files affected:** campaign controllers/routes and creation/detail UI, send worker, scheduler, tracking routes, analytics/dashboard, environment and deployment documentation.

**New files:** additive governance migration, approval policy, recipient eligibility and timezone/fatigue policy services, and policy tests.

**Database changes:** approval audit fields; campaign topic/frequency/quiet-hour/duplicate settings; contact timezone and topic preferences; content fingerprint and history indexes.

**Dependencies:** existing JWT users, campaign-recipient history, BullMQ delayed jobs, PostgreSQL, and secure HMAC contact tokens.

**Risks:** installations with one admin require explicit self-approval configuration; missing contact timezone falls back to UTC; concurrent campaigns still rely on the final pre-send database check and queue ordering.

**Verification:** maker-checker policy test, quiet-hours-across-midnight test, daily/weekly/gap/duplicate/topic block tests, server/client builds, full Jest suite, and Compose validation.

## Intended milestone order and gates

1. M1 documents are committed to the worktree before behavior changes.
2. M2–M3 establish the provider and send-attempt boundary; build/tests must pass before event work.
3. M4–M6 establish reliable inbound state and suppression; parser, duplicate, and suppression tests gate analytics.
4. M7 exposes only reconciled facts.
5. M8 uses quota and event facts to regulate throughput and pause safely.
6. M9 is independent once provider/message requirements are stable.
7. M10 codifies AWS resources without replacing Compose.
8. M11 runs all verification and records remaining operational limitations.

## M13 — Senqo WhatsApp sidecar integration (started)

**Files affected:** `docker-compose.whatsapp.yml`, both nginx configs, Sendora sidebar, Senqo Vite/base-path configuration, shared `.env` files.

**Boundary:** Senqo remains an independent WhatsApp product/runtime. Sendora exposes it at `/whatsapp/` and proxies its API through `/whatsapp-api/`; the two applications keep separate JWT identities. A shared PostgreSQL server is used with Senqo tables isolated under the `senqo` schema.

**Verification:** normal Compose config remains valid without starting the sidecar; the sidecar is opt-in with `--profile whatsapp`. Client build and existing server tests pass. SSO token exchange, campaign/event mapping UI, and cross-channel outbox workers remain the next implementation gates.
