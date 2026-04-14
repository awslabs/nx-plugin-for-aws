# @aws/nx-plugin-mcp

A lightweight, standalone MCP (Model Context Protocol) server for the [Nx Plugin for AWS](https://github.com/awslabs/nx-plugin-for-aws).

This package provides the same MCP server as `@aws/nx-plugin`, but bundled into a single file with zero npm dependencies for significantly faster startup.

## Usage

Configure the MCP server in your AI assistant:

```json
{
  "mcpServers": {
    "nx-plugin-for-aws": {
      "command": "npx",
      "args": ["-y", "@aws/nx-plugin-mcp"]
    }
  }
}
```

## License

Apache-2.0
