@integration @live @storage-tables
Feature: NotificationLog integration
  Scenario: Publish a Cope request and verify its NotificationLog result
    Given the NotificationLog integration is configured
    When I publish the following request to the "cope-requests" queue:
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
          }
        ]
      }
      """
    Then the latest NotificationLog record has a successful HTTP status and Succeeded is true within 600 seconds
    