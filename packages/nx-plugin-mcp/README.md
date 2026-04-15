# @aws/nx-plugin-mcp

A lightweight, standalone MCP (Model Context Protocol) server for the [Nx Plugin for AWS](https://github.com/awslabs/nx-plugin-for-aws).

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
