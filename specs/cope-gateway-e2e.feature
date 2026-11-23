@integration @cope @live @gateway
Feature: Cope pipeline end-to-end through the gateway
  Submit a property request to the Cope gateway (dev), then poll the returned status URL
  until the orchestration completes. Mirrors the manual gateway flow used on dev and prod.

  Background:
    Given the Cope gateway integration is configured

  @headless
  Scenario: Submit a property request through the gateway and poll until completed
    When I submit a property request through the cope gateway with client reference "caf-prospect-ci-headless", address line1 "4529 Winona Ct", city "Denver", state "CO", zip code "80222" and county "Denver"
    Then the cope orchestration completes within 900 seconds
    And the cope orchestration reports 1 succeeded and 0 failed
