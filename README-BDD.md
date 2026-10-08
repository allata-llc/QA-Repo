Setup and run Cucumber + Playwright BDD

Prerequisites
- Node.js 16+

Install dependencies:

```bash
npm install
```

Install Playwright browsers:

```bash
npm run install-browsers
```

Run the BDD scenarios (Cucumber):

```bash
npm run test:bdd
```

Browser scenarios have been replaced by the Azure Service Bus / Blob integration
scenarios, which are opt-in via the `@integration` tag.

Install the integration dependencies and create local configuration:

```powershell
npm install
Copy-Item .env.example .env
```

Start the MCP server from its cloned repository:

```powershell
cd ..\mcp-server
hatch env create
hatch run start
```

The MCP integration expects:

```text
MCP_SERVER_URL=http://127.0.0.1:7071/mcp
```

Run MCP scenarios with:

```powershell
cd ..\AgenticAI
npm run test:integration:mcp
```

`pipeline-function` is a Service Bus queue-triggered function, not an HTTP
API. Its source contract can be checked locally without Azure credentials:

```powershell
npm run test:integration:pipeline
```

The live queue scenario requires either a connection string or Azure SDK credentials:

```text
SERVICE_BUS_CONNECTION=<Service Bus connection string>
# or:
SERVICE_BUS_NAMESPACE_FQDN=cope-pocsb.servicebus.windows.net
AZURE_CLIENT_ID=<app registration client id>
AZURE_CLIENT_SECRET=<app registration client secret>
AZURE_TENANT_ID=<tenant id>
PIPELINE_QUEUE_NAME=cope-requests
PIPELINE_FUNCTION_REPO=../pipeline-function
```

Run it with:

```powershell
npm run test:integration:pipeline:live
```

Publishing a message only verifies that Service Bus accepted it. End-to-end
processing additionally requires the pipeline function, `AzureWebJobsStorage`,
Azure AI Foundry settings, and credentials described in the pipeline
repository's README.

Notes
- Feature files live in `specs/`.
- Cucumber World is `specs/support/world.js` which wires Playwright and page objects.
- Step definitions are in `specs/steps/`; integration steps are isolated in `integration.steps.js`.

The `@storage-tables` scenario is a non-UI integration test. It publishes the request through
the Service Bus SDK, polls `NotificationLog` through the Azure Tables SDK, and asserts a 2xx
HTTP status plus `Succeeded=true`. Run it with `npm run test:integration:storage-tables`.
It uses Azure CLI/OIDC identity by default; grant Service Bus Data Sender on the namespace
and Storage Table Data Reader on the storage account. Dedicated connection strings can be
provided with `NOTIFICATION_SERVICE_BUS_CONNECTION` and `NOTIFICATION_TABLE_CONNECTION_STRING`.

## CI/CD (GitHub Actions)

## Microsoft authentication

There are two different auth problems here, and conflating them is what caused the expiring-session failures. Neither solution below has anything that expires.

### 1. Service Bus / Blob Storage - GitHub OIDC federated identity

The SDK-based tests never use a user session. The job requests a short-lived token from GitHub and exchanges it with Entra at run time (`specs/support/azure-credential.js`). Nothing is stored, so nothing can go stale. Client secrets are still accepted as a fallback, but they expire (24 months max), so OIDC is preferred.

One-time setup on the app registration:

```powershell
az ad app federated-credential create --id <APP_OBJECT_ID> --parameters '{
  "name": "github-agenticai-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<owner>/<repo>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Add a second credential with `"subject": "repo:<owner>/<repo>:pull_request"` so PR runs work too. Then set `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` as repository variables (no secret needed) and grant the service principal `Azure Service Bus Data Sender` on the queue and `Storage Blob Data Reader` on the container. The workflow already declares `permissions: id-token: write`.

### 2. Azure Portal UI - manual only, not in CI

The `@azure-portal` scenario drives the same business flow through the portal. It asserts nothing the headless scenario does not already cover - only that the portal renders - so it is **excluded from CI** and kept for local, on-demand runs:

```powershell
npm run test:integration:azure-portal
```

It needs an interactive Entra sign-in. On an Entra-joined machine single sign-on completes automatically and no credentials are required. Elsewhere, set `AZURE_PORTAL_USERNAME`, `AZURE_PORTAL_PASSWORD` and `TOTP_SECRET` (an authenticator seed, see `specs/support/totp.js`) and a code is generated per run.

Automating this in CI was attempted and abandoned: the tenant presents a FIDO2/passkey prompt to GitHub runners, and scripting around phishing-resistant sign-in would mean putting a real account's password and a permanent MFA bypass into GitHub secrets for no additional coverage.

The captured storage state (`npm run auth:azure-portal`) remains a local convenience so you don't re-authenticate on every local run.

### 3. Fallback when you don't have Entra admin rights

Creating an app registration is usually self-service, but granting it RBAC on the Service Bus namespace and storage account is not. If you can't get that done, the SDK steps accept long-lived shared secrets instead:

- `SERVICE_BUS_CONNECTION` - a Service Bus connection string.
- `STORAGE_SAS_URL` - the blob endpoint with a SAS query string appended, or `STORAGE_CONNECTION_STRING`.

This is a deliberate trade-down: unlike OIDC these are bearer secrets that live in GitHub until someone rotates them. Scope them as tightly as the resource allows - a **Send-only** Service Bus authorization rule rather than `RootManageSharedAccessKey`, and a **container-scoped, read/list-only** SAS rather than the storage account key. Move to OIDC once an admin can assign the roles.

## CI/CD (GitHub Actions)

A single workflow, **`.github/workflows/ci.yml`**, runs all jobs (`copilot-setup-steps.yml`
is separate - it's the file GitHub's Copilot coding agent uses to prep its own sandbox, not
a test job).

Every test job runs on each push/PR to `main`, plus a nightly run at 06:00 UTC to catch
environment drift on quiet days.

- **`unit`** - `npm run test:unit` (`node --test`) over `test/`. Pure logic: TOTP code
  generation against the RFC 4226/4648 vectors, Service Bus payload building.
- **`bdd`** - `npm run test:validate`, a Cucumber `--dry-run` that parses every feature file
  and binds each step to a definition without executing it, so undefined/ambiguous/renamed
  steps fail the build. Then runs the non-`@integration` scenarios.
- **`integration`** - MCP server + `pipeline-function` contract tests. Needs `ORG_REPO_TOKEN`
  (read access to the private `allata-llc/mcp-server` and `allata-llc/pipeline-function`
  repos); skips rather than fails when absent, e.g. on fork PRs.
- **`cope-pipeline-e2e`** - `test:integration:cope-e2e`, the browserless end-to-end scenario
  (Service Bus -> Foundry -> Blob) over the Azure SDK. No browser, no user sign-in, no MFA.
  This is the job that proves the pipeline works.
- **`live-pipeline`** - manual only, via `workflow_dispatch` with the `run_live_pipeline`
  input checked. Publishes a real message to the `cope-requests` queue.

A **`preflight`** job reports which credential sets are configured and publishes them as job
outputs; credential-dependent jobs gate on those outputs, so an unconfigured job is
**skipped** (a skipped job does not fail the run) instead of failing with a
missing-credentials error. This indirection is necessary because the `secrets` context is
not available in job or step `if:` conditions. Nothing uses `continue-on-error` - a failing
test always fails its job.

Workflows set default values for `SERVICE_BUS_NAMESPACE_FQDN` and `STORAGE_ACCOUNT_URL`,
overridable with repository variables of the same names.

All jobs read an `environment` input (`dev`/`stage`/`prod`, default `dev`) so
environment-specific variables/secrets can be configured per GitHub Environment (Settings >
Environments) without editing the workflow.
