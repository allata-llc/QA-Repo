@integration @mcp
Feature: MCP server integration
  Validate the MCP server exposed by allata-llc/mcp-server.

  Background:
    Given the MCP server integration is configured

  Scenario: List available tools
    When I initialize an MCP session
    And I list the MCP tools
    Then the MCP tool list response is valid