---
title: API Connection
description: Reference documentation for API connections
---

This generator is used to connect projects to APIs. Simply select the source project (the project that will call your API) and target project (your API project), and this generator will handle integrating the two.

## Connecting an API

You can connect a source and target project in two ways:

### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then generate your API:

1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "api-connection"
4. Fill in the required parameters in the form
5. Click "Run"

### 2. Using CLI

Generate the API:

```bash
nx g @aws/nx-plugin:api-connection --sourceProject=my-client-project --targetProject=my-api-project --auth=IAM
```

You can also perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:api-connection --sourceProject=my-client-project --targetProject=my-api-project --auth=IAM --dry-run
```

Both methods will add the necessary code and configuration to integrate the source project with the target api project.

### Input Parameters

| Parameter       | Type   | Default | Description                                                  |
| --------------- | ------ | ------- | ------------------------------------------------------------ |
| sourceProject\* | string | -       | The name of the project which will call your API (required). |
| targetProject\* | string | -       | The name of your API project (required).                     |
| auth\*          | string | "IAM"   | Authentication strategy. Options: "IAM", "None"              |

\*Required parameter

## Supported Connections

### tRPC

You can connect a React website to a tRPC API. For details, please refer to the [API connection section of the tRPC reference documentation](/reference/trpc/#api-connection-trpc-react).
