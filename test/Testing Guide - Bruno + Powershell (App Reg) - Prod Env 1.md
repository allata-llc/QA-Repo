---
title: Gateway API - Get a Token with PowerShell and Submit a Request
created: 2026-11-11
tags:
  - azure
  - entra-id
  - powershell
  - bruno
  - postman
  - api
aliases:
  - Gateway Token Guide
---

# Gateway API: Get a Token with PowerShell and Submit a Request

Step-by-step guide to request an access token from Microsoft Entra ID using **client credentials** in PowerShell, then call the gateway from Bruno or Postman and poll for results.

> [!info] Overview
> 1. Request the token in PowerShell (client ID and client secret).
> 2. Paste the token in the **Auth** tab of Bruno or Postman as a **Bearer Token**.
> 3. Send the `POST` request to `/api/submit` with the example body.
> 4. Use the `status_url` from the response (`GET`, same token) to retrieve the orchestration results.

No Azure CLI and no interactive sign-in are required.

## Reference values

| Name                      | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| Tenant ID                 | `03e832ce-094d-4423-b864-c11e2a626509`                           |
| API (app registration) ID | `04dad64f-2a25-4e8b-b587-699fe0fb9064`                           |
| Submit endpoint           | `https://func-sn-data-prod-gateway.azurewebsites.net/api/submit` |
| Required roles            | `Submit`, `Polling`                                              |
| Client ID                 | `<CLIENT_ID>` (provided to you)                                  |
| Client secret             | `<CLIENT_SECRET>` (provided to you)                              |

## Prerequisites

- [ ] An app registration (client) with the **`Submit`** and **`Polling`** application permissions on the API, with **admin consent granted**.
- [ ] The app's **Client ID** and a **client secret value** (not the *Secret ID*).
- [ ] PowerShell 5.1 or PowerShell 7+.
- [ ] Bruno or Postman.

> [!warning]
> The roles must be assigned to the **same app** whose client ID and secret you use. Otherwise Entra returns `AADSTS501051`.

---

## 1. Request the token in PowerShell

### Declare the variables

```powershell
$tenantId     = "03e832ce-094d-4423-b864-c11e2a626509"
$clientId     = "<CLIENT_ID>"
$clientSecret = "<CLIENT_SECRET>"
$apiId        = "04dad64f-2a25-4e8b-b587-699fe0fb9064"
```

### Request the token

```powershell
$response = Invoke-RestMethod -Method Post `
  -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{
    grant_type    = "client_credentials"
    client_id     = $clientId
    client_secret = $clientSecret
    scope         = "api://$apiId/.default"
  }
```

### Display the token

```powershell
$response.access_token
```

Copy the value printed in the console.

> [!note]
> The token is valid for roughly **60 to 90 minutes**. When you get a `401`, repeat this step.


---

## 2. Configure the request in Bruno or Postman

| Field  | Value                                                            |
| ------ | ---------------------------------------------------------------- |
| Method | `POST`                                                           |
| URL    | `https://func-sn-data-prod-gateway.azurewebsites.net/api/submit` |
| Body   | `raw` / JSON (see below)                                         |

### Add the token in the Auth tab

> [!important]
> Paste the token in the **Auth** tab, not in the body or headers manually.

- **Bruno:** **Auth → Bearer Token** → paste the token in the **Token** field.
- **Postman:** **Authorization → Auth Type: Bearer Token** → paste the token in the **Token** field.

### Request body (example)

```json
{
  "callbackUrl": "http://localhost:5173/",
  "requests": [
    {
      "clientRef": "caf-prospect-111",
      "locationNo": 1,
      "buildingNo": 1,
      "maxAgeDays": 365,
      "address": {
        "line1": "324 Underhill Avenue",
        "city": "Bronx",
        "state": "NY",
        "postalCode": "80212",
        "county": "Bronx"
      }
    }
  ]
}
```

> [!warning] Set your own `callbackUrl`
> The example uses `"callbackUrl" as a placeholder.` Replace it with the **URL of your webhook**, which is where the API sends notifications about the orchestration. For example: `"callbackUrl": "https://your-domain.com/webhooks/gateway"`.

Click **Send**.

---

## 3. API response

A successful request returns something like:

```json
{
  "lookup_id": "a3e1d0d1-dc81-4bd8-8bf2-5da16d073269",
  "status_url": "https://func-sn-data-prod-orc.azurewebsites.net/api/polling/a3e1d0d8-dc81-4bd8-8bf2-5da16d073269"
}
```

| Field | Description |
|---|---|
| `lookup_id` | Unique identifier of the submitted lookup. |
| `status_url` | URL to retrieve the status and results of the orchestration. |

---

## 4. Retrieve the results

Send a `GET` request to the `status_url` returned in the previous step, using **the same token** from step 1 as the Bearer Token:

```
GET https://func-sn-data-prod-orc.azurewebsites.net/api/polling/a3e1d0d8-dc81-4bd8-8bf2-5da16d073269
```

- **Auth:** Bearer Token (same token as before).
- **Body:** none.

Repeat the `GET` until the orchestration is complete. If the token expires in the meantime, request a new one (step 1) and update the Auth tab.

> [!note]
> The `Polling` role is required for this call.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `AADSTS501051` | The app has no role assigned on the API | Confirm roles and consent for **this** client ID |
| `AADSTS7000215` | Invalid client secret | Use the secret **Value**, not the *Secret ID* |
| `AADSTS7000222` | Client secret expired | Generate a new secret |
| `AADSTS700016` | Wrong client ID or tenant | Check `$clientId` and `$tenantId` |
| `AADSTS1002012` / `AADSTS500011` | Wrong scope or API ID | Check `$apiId` |
| `401 Unauthorized` | Expired or invalid token | Request a new token |
| `403 Forbidden` | Token without the required role | Check `roles` in the token (`Submit` / `Polling`) |
| Token has no `roles` | Permission is *Delegated* or consent is missing | Use *Application* permissions with admin consent |

## Security notes

- Never share the client secret or the token in public chats, emails, tickets, or documents.
- Do not commit secrets or tokens to Git.
- Clear the secret from your session when finished:

```powershell
Remove-Variable clientSecret, response, token -ErrorAction SilentlyContinue
```

## Related

- [[Entra ID Service Principals]]
- [[Gateway Role Assignment]]
