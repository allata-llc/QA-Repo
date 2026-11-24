@integration @cope @live @sas @headless
Feature: Publish to the cope Service Bus queues with a SAS token over REST
  Mirrors the portal walkthrough (resource group "cope-platform-poc-rg" > Service Bus namespace
  "cope-pocsb" > queue > Shared access policies > "bulk-send-key") without driving the UI: the
  primary key of that policy is read from the environment, a SAS token is signed locally, the
  property request is sent with a plain HTTP POST and the broker's acceptance is checked. Messages
  can be consumed immediately, so a subsequent peek cannot reliably verify a send on these queues.

  Note: "bulk-send-key" is a queue-scoped policy, so each queue has its own key. They are read
  from SERVICE_BUS_SAS_KEY_COPE_REQUESTS and SERVICE_BUS_SAS_KEY_COPE_REQUESTS_DEV; a token signed
  with the wrong queue's key returns 401. @sas is excluded from the cope-e2e job, which needs only
  Azure SDK credentials, so keep that tag on every scenario here.

  Background:
    Given the Service Bus SAS integration is configured for namespace "cope-pocsb"

  Scenario Outline: Send a property request to <queue> with its bulk-send-key SAS token
    Given a SAS token is generated for the "<queue>" queue using the "bulk-send-key" shared access policy
    When I publish the property request over HTTP to the "<queue>" queue with correlation id "<correlationId>", source system "CaffeineCRM", address line1 "4529 Winona Ct", city "Denver", state "CO" and zip code "80222"
    Then the Service Bus REST response status is 201

    Examples:
      | queue             | correlationId             |
      | cope-requests     | caf-prospect-sas-rest     |
      | cope-requests-dev | caf-prospect-sas-rest-dev |
