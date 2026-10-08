@integration @live @notification-log @rate-limit
Feature: NotificationLog rate limit handling
  When the upstream data source throttles part of a batch, the throttled addresses are
  reported as failed with a 429 error, the rest are still processed, and the callback is delivered.
  Several copies of the batch are sent at once to push the data source over its rate limit.

  Scenario: Concurrent multi-address batches report rate-limited addresses as failed
    Given the NotificationLog integration is configured
    When I publish 4 copies of the following request to the "cope-requests" queue at the same time:
      """
      {
        "callbackUrl": "https://httpbin.org/post",
        "requests": [
          {
            "clientRef": "demo-portfolio-001",
            "locationNo": 1,
            "buildingNo": 1,
            "maxAgeDays": 365,
            "address": {
              "line1": "324 Underhill Avenue",
              "city": "Bronx",
              "state": "NY",
              "postalCode": "10473",
              "county": "Bronx"
            }
          },
          {
            "clientRef": "demo-portfolio-001",
            "locationNo": 2,
            "buildingNo": 1,
            "maxAgeDays": 365,
            "address": {
              "line1": "135 Willow St",
              "city": "Guilderland",
              "state": "NY",
              "postalCode": "12084",
              "county": "Albany"
            }
          },
          {
            "clientRef": "demo-portfolio-001",
            "locationNo": 3,
            "buildingNo": 1,
            "maxAgeDays": 365,
            "address": {
              "line1": "453 Plainfield Avenue",
              "city": "Berkeley Heights",
              "state": "NJ",
              "postalCode": "07922",
              "county": "Union"
            }
          },
          {
            "clientRef": "demo-portfolio-001",
            "locationNo": 4,
            "buildingNo": 1,
            "maxAgeDays": 365,
            "address": {
              "line1": "3537 Drumore Dr",
              "city": "Philadelphia",
              "state": "PA",
              "postalCode": "19154",
              "county": "Philadelphia"
            }
          },
          {
            "clientRef": "demo-portfolio-001",
            "locationNo": 5,
            "buildingNo": 1,
            "maxAgeDays": 365,
            "address": {
              "line1": "11204 County Line Rd",
              "city": "Fountain",
              "state": "FL",
              "postalCode": "32438",
              "county": "Bay"
            }
          }
        ]
      }
      """
    Then a NotificationLog record is written for every requested address within 900 seconds
    And at least one address is rejected with error "429 - rate limit exceeded"
    And every address that was not rate limited succeeded
    And every batch result callback is delivered with a successful HTTP status
