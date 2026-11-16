@integration @cope @live
Feature: Cope pipeline end-to-end automation
  Publish a property request to the Azure Service Bus queue "cope-requests" (namespace cope-pocsb),
  let Azure Foundry process it, and verify the result is written as a blob in the "cope-agent-responses"
  container of storage account "copepocsa".

  Background:
    Given the Cope Azure pipeline integration is configured

  @headless @sdk
  Scenario: Publish a property request and verify the pipeline output blob
    When I publish a property request to the cope pipeline queue with correlation id "caf-prospect-ci-headless", source system "CaffeineCRM", address line1 "4529 Winona Ct", city "Denver", state "CO" and zip code "80222"
    Then an output blob for the request is written to storage account "copepocsa" within 300 seconds
    And the output blob content is valid JSON

  # Manual only: the same business flow driven through the portal UI. It asserts nothing the
  # headless scenario above does not already cover - only that the portal renders - and it
  # needs an interactive Entra sign-in, so it is excluded from CI.
  # Run locally with: npm run test:integration:azure-portal
  @azure-portal @ui @manual
  Scenario: Navigate to the cope-requests queue in the Azure Portal
    Given I am signed in to the Azure Portal
    When I select the subscription "1e398626-ee78-481a-be48-9c7eaae00575"
    And I navigate to the resource group "cope-platform-poc-rg"
    And I open the Service Bus namespace "cope-pocsb"
    And I open "Queues" under the "Entities" section
    And I select the queue "cope-requests"
    And I should land on the "cope-requests" queue Overview page
    And I open the Service Bus Explorer for the queue
    And I show the property request payload in the Service Bus Explorer for correlation id "caf-prospect-12345699", source system "CaffeineCRM", address line1 "4529 Winona Ct", city "Denver", state "CO" and zip code "80222"
    And I publish a property request to the cope pipeline queue with correlation id "caf-prospect-12345699", source system "CaffeineCRM", address line1 "4529 Winona Ct", city "Denver", state "CO" and zip code "80222"
    And I peek the published message in the Service Bus Explorer
    And I refresh the queue Overview page to see the published message
    And an output blob for the request is written to storage account "copepocsa" within 180 seconds
    And I open the output blob in storage account "copepocsa" in the Azure Portal
    Then the output blob content is valid JSON
