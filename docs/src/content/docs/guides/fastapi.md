---
title: FastAPI
description: Reference documentation for FastAPI
---

[FastAPI](https://fastapi.tiangolo.com/) is a framework for building APIs in Python.

The AWS Plugin for Nx makes building APIs with FastAPI easy by providing two main generators:

- [`py#fast-api`](#fastapi-generator) - Generates the backend code to implement a FastAPI as well as infrastructure to deploy it with API Gateway
- [`api-connection`](#api-connection-fastapi-react) - Supports integrating a FastAPI with a React website

## FastAPI Generator

The FastAPI generator creates a new FastAPI with AWS CDK infrastructure setup. The generated backend uses AWS Lambda for serverless deployment, exposed via an AWS API Gateway HTTP API. It sets up [AWS Lambda Powertools](https://docs.powertools.aws.dev/lambda/python/latest/) for observability, including logging, AWS X-Ray tracing and Cloudwatch Metrics.

### Generating a new FastAPI

You can generate a new FastAPI in two ways:

#### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then generate your API:

1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "py#fast-api"
4. Fill in the required parameters in the form
5. Click "Run"

#### 2. Using CLI

Generate the API:

```bash
nx g @aws/nx-plugin:py#fast-api --name=my-api --directory=apps/api
```

You can also perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:py#fast-api --name=my-api --directory=apps/api --dry-run
```

Both methods will create a new FastAPI backend API in the specified directory with all the necessary configuration and infrastructure code.

#### Input Parameters

| Parameter | Type   | Default    | Description                                                                  |
| --------- | ------ | ---------- | ---------------------------------------------------------------------------- |
| name\*    | string | -          | The name of the API (required). Used to generate class names and file paths. |
| directory | string | "packages" | The directory to store the application in.                                   |

\*Required parameter

### Implementing your FastAPI

The generator will create the following project structure in the `<directory>/<api-name>` directory:

```
<directory>/<api-name>/
├── project.json        # Project configuration and build targets
├── pyproject.toml     # Python project configuration and dependencies
└── <module_name>/     # Your API module
    ├── __init__.py    # Module initialization
    └── main.py        # API implementation
```

#### API Implementation

The main API implementation is in `main.py`. This is where you define your API routes and their implementations. Here's an example:

```python
from .init import app, tracer
from pydantic import BaseModel

class Item(BaseModel):
  name: str

@app.get("/items/{item_id}")
def get_item(item_id: int) -> Item:
    return Item(name=...)

@app.post("/items")
def create_item(item: Item):
    return ...
```

The generator sets up several features automatically:

1. AWS Lambda Powertools integration for observability
2. Error handling middleware
3. Request/response correlation
4. Metrics collection
5. AWS Lambda handler using Mangum

#### Observability with AWS Lambda Powertools

##### Logging

The generator configures structured logging using AWS Lambda Powertools. You can access the logger in your route handlers:

```python
from .init import app, logger

@app.get("/items/{item_id}")
def read_item(item_id: int):
    logger.info("Fetching item", extra={"item_id": item_id})
    return {"item_id": item_id}
```

The logger automatically includes:

- Correlation IDs for request tracing
- Request path and method
- Lambda context information
- Cold start indicators

##### Tracing

AWS X-Ray tracing is configured automatically. You can add custom subsegments to your traces:

```python
from .init import app, tracer

@app.get("/items/{item_id}")
@tracer.capture_method
def read_item(item_id: int):
    # Creates a new subsegment
    with tracer.provider.in_subsegment("fetch-item-details"):
        # Your logic here
        return {"item_id": item_id}
```

##### Metrics

CloudWatch metrics are collected automatically for each request. You can add custom metrics:

```python
from .init import app, metrics
from aws_lambda_powertools.metrics import MetricUnit

@app.get("/items/{item_id}")
def read_item(item_id: int):
    metrics.add_metric(name="ItemViewed", unit=MetricUnit.Count, value=1)
    return {"item_id": item_id}
```

Default metrics include:

- Request counts
- Success/failure counts
- Cold start metrics
- Per-route metrics

#### Error Handling

The generator includes comprehensive error handling:

```python
from fastapi import HTTPException

@app.get("/items/{item_id}")
def read_item(item_id: int):
    if item_id < 0:
        raise HTTPException(status_code=400, detail="Item ID must be positive")
    return {"item_id": item_id}
```

Unhandled exceptions are caught by the middleware and:

1. Log the full exception with stack trace
2. Record a failure metric
3. Return a safe 500 response to the client
4. Preserve the correlation ID

#### Streaming

With FastAPI, you can stream a response to the caller with the [`StreamingResponse`](https://fastapi.tiangolo.com/reference/responses/?h=streaming#fastapi.responses.StreamingResponse) response type.

##### Infrastructure Changes

Since AWS API Gateway does not support streaming responses, you will need to deploy your FastAPI to a platform which supports this. The simplest option is to use an AWS Lambda Function URL. To achieve this, you can adjust the generated `HttpApi` construct to add an option for streaming, and conditionally instantiate the relevant constructs.

<details>
<summary>Example Changes</summary>

```diff lang="ts"
 import { Construct } from 'constructs';
-import { CfnOutput, Duration } from 'aws-cdk-lib';
+import { CfnOutput, Duration, Stack } from 'aws-cdk-lib';
 import {
   CorsHttpMethod,
   HttpApi as _HttpApi,
@@ -7,7 +7,16 @@ import {
   IHttpRouteAuthorizer,
 } from 'aws-cdk-lib/aws-apigatewayv2';

       },
     });

-    this.api = new _HttpApi(this, id, {
-      corsPreflight: {
-        allowOrigins: props.allowedOrigins ?? ['*'],
-        allowMethods: [CorsHttpMethod.ANY],
-        allowHeaders: [
-          'authorization',
-          'content-type',
-          'x-amz-content-sha256',
-          'x-amz-date',
-          'x-amz-security-token',
-        ],
-      },
-      defaultAuthorizer: props.defaultAuthorizer,
-    });
+    let apiUrl;
+    if (props.apiType === 'api-gateway') {
+      this.api = new _HttpApi(this, id, {
+        corsPreflight: {
+          allowOrigins: props.allowedOrigins ?? ['*'],
+          allowMethods: [CorsHttpMethod.ANY],
+          allowHeaders: [
+            'authorization',
+            'content-type',
+            'x-amz-content-sha256',
+            'x-amz-date',
+            'x-amz-security-token',
+          ],
+        },
+        defaultAuthorizer: props.defaultAuthorizer,
+      });

-    this.api.addRoutes({
-      path: '/{proxy+}',
-      methods: [
-        HttpMethod.GET,
-        HttpMethod.DELETE,
-        HttpMethod.POST,
-        HttpMethod.PUT,
-        HttpMethod.PATCH,
-        HttpMethod.HEAD,
-      ],
-      integration: new HttpLambdaIntegration(
-        'RouterIntegration',
-        this.routerFunction,
-      ),
-    });
+      this.api.addRoutes({
+        path: '/{proxy+}',
+        methods: [
+          HttpMethod.GET,
+          HttpMethod.DELETE,
+          HttpMethod.POST,
+          HttpMethod.PUT,
+          HttpMethod.PATCH,
+          HttpMethod.HEAD,
+        ],
+        integration: new HttpLambdaIntegration(
+          'RouterIntegration',
+          this.routerFunction,
+        ),
+      });
+      apiUrl = this.api.url;
+    } else {
+      const stack = Stack.of(this);
+      this.routerFunction.addLayers(
+        LayerVersion.fromLayerVersionArn(
+          this,
+          'LWALayer',
+          `arn:aws:lambda:${stack.region}:753240598075:layer:LambdaAdapterLayerX86:24`,
+        ),
+      );
+      this.routerFunction.addEnvironment('PORT', '8000');
+      this.routerFunction.addEnvironment(
+        'AWS_LWA_INVOKE_MODE',
+        'response_stream',
+      );
+      this.routerFunction.addEnvironment(
+        'AWS_LAMBDA_EXEC_WRAPPER',
+        '/opt/bootstrap',
+      );
+      this.routerFunctionUrl = this.routerFunction.addFunctionUrl({
+        authType: FunctionUrlAuthType.AWS_IAM,
+        invokeMode: InvokeMode.RESPONSE_STREAM,
+        cors: {
+          allowedOrigins: props.allowedOrigins ?? ['*'],
+          allowedHeaders: [
+            'authorization',
+            'content-type',
+            'x-amz-content-sha256',
+            'x-amz-date',
+            'x-amz-security-token',
+          ],
+        },
+      });
+      apiUrl = this.routerFunctionUrl.url;
+    }

-    new CfnOutput(this, `${props.apiName}Url`, { value: this.api.url! });
+    new CfnOutput(this, `${props.apiName}Url`, { value: apiUrl! });

     RuntimeConfig.ensure(this).config.httpApis = {
       ...RuntimeConfig.ensure(this).config.httpApis!,
-      [props.apiName]: this.api.url!,
+      [props.apiName]: apiUrl,
     };
   }

   public grantInvokeAccess(role: IRole) {
-    role.addToPrincipalPolicy(
-      new PolicyStatement({
-        effect: Effect.ALLOW,
-        actions: ['execute-api:Invoke'],
-        resources: [this.api.arnForExecuteApi('*', '/*', '*')],
-      }),
-    );
+    if (this.api) {
+      role.addToPrincipalPolicy(
+        new PolicyStatement({
+          effect: Effect.ALLOW,
+          actions: ['execute-api:Invoke'],
+          resources: [this.api.arnForExecuteApi('*', '/*', '*')],
+        }),
+      );
+    } else if (this.routerFunction) {
+      role.addToPrincipalPolicy(
+        new PolicyStatement({
+          effect: Effect.ALLOW,
+          actions: ['lambda:InvokeFunctionUrl'],
+          resources: [this.routerFunction.functionArn],
+          conditions: {
+            StringEquals: {
+              'lambda:FunctionUrlAuthType': 'AWS_IAM',
+            },
+          },
+        }),
+      );
+    }
   }
 }
```

</details>

After making these changes, make sure you update `packages/common/constructs/src/app/http-apis/<my-api>.ts` to use your new function url option.

##### Implementation

Once you've updated the infrastructure to support streaming, you can implement a streaming API in FastAPI. The API should:

- Return a [`StreamingResponse`](https://fastapi.tiangolo.com/reference/responses/?h=streaming#fastapi.responses.StreamingResponse)
- Declare the return type of each response chunk
- Add the OpenAPI vendor extension `x-streaming: true` if you intend to use the [API Connection](#api-connection-fastapi-react).

For example, if you would like to stream a series of JSON objects from your API, you can implement this as follows

```py /return (StreamingResponse)/ /openapi_extra[^)]*/ /-> (Chunk)/
from pydantic import BaseModel
from fastapi.responses import StreamingResponse

class Chunk(BaseModel):
  message: str
  timestamp: datetime

async def stream_chunks():
  for i in range(0, 100):
    yield Chunk(message=f"This is chunk {i}", timestamp=datetime.now())

@app.get("/stream", openapi_extra={'x-streaming': True})
def my_stream() -> Chunk:
    return StreamingResponse(stream_chunks(), media_type="application/json")
```

##### Consumption

To consume a stream of responses, you can make use of the [API Connection Generator](#consuming-a-stream) which will provide a type-safe method for iterating over your streamed chunks.

### Local Development

The generator configures a local development server that you can run with:

```bash
nx run my-api:serve
```

This starts a local FastAPI development server with:

- Auto-reload on code changes
- Interactive API documentation at `/docs` or `/redoc`
- OpenAPI schema at `/openapi.json`

### Deploying your FastAPI

The FastAPI generator creates a CDK construct for deploying your API in the `common/constructs` folder. You can use this in a CDK application:

```ts
import { MyApi } from ':my-scope/common-constructs';

export class ExampleStack extends Stack {
  constructor(scope: Construct, id: string) {
    // Add the api to your stack
    const api = new MyApi(this, 'MyApi');
  }
}
```

This sets up:

1. AWS Lambda function running your FastAPI application
2. API Gateway HTTP API as the function trigger
3. IAM roles and permissions
4. CloudWatch log group
5. X-Ray tracing configuration
6. CloudWatch metrics namespace

#### Granting Access

You can use the `grantInvokeAccess` method to grant access to your API:

```ts
api.grantInvokeAccess(myIdentityPool.authenticatedRole);
```

## API Connection: FastAPI React

AWS Plugin for Nx provides a generator to quickly integrate your FastAPI with a React website. It sets up all necessary configuration for connecting to your FastAPI backends in a type-safe manner, including client generation, AWS IAM authentication support and proper error handling.

### Prerequisites

Before using this generator, ensure your React application has:

1. A `main.tsx` file that renders your application
2. An `<App/>` JSX element where the API client provider will be automatically injected
3. A working FastAPI backend (generated using the FastAPI generator)

Example of required `main.tsx` structure:

```tsx
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import App from './app/app';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### Usage

You can generate the FastAPI React integration in two ways:

#### 1. Using VSCode IDE

First, install the NX Console extension for VSCode:

1. Open VSCode
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Nx Console"
4. Install [Nx Console](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)

Then add FastAPI to your React application:

1. Open the NX Console in VSCode
2. Click on "Generate"
3. Search for "api-connection"
4. Fill in the required parameters in the form
5. Click "Run"

#### 2. Using CLI

Add FastAPI to your React application:

```bash
nx g @aws/nx-plugin:api-connection --sourceProject=my-app --targetProject=my-api --auth=IAM
```

You can also perform a dry-run to see what files would be generated without actually creating them:

```bash
nx g @aws/nx-plugin:api-connection --sourceProject=my-app --targetProject=my-api --auth=IAM --dry-run
```

Both methods will add FastAPI client integration to your React application with all the necessary configuration.

### Input Parameters

| Parameter       | Type   | Default | Description                                            |
| --------------- | ------ | ------- | ------------------------------------------------------ |
| sourceProject\* | string | -       | The name of your React application project (required). |
| targetProject\* | string | -       | The name of your FastAPI backend project (required).   |
| auth\*          | string | "IAM"   | Authentication strategy. Options: "IAM", "None"        |

\*Required parameter

### Expected Output

The generator creates the following structure in your React application:

```
src/
└── hooks/
    └── useSigV4.tsx        # Custom hook for signing HTTP(s) requests with SigV4 (IAM only)
    └── use<ApiName>.tsx    # Custom hook for the given backend API
```

Additionally, it:

1. Configures an `openapi` build target in your FastAPI project which generates an OpenAPI specification from your FastAPI
2. Configures a `generate:my-api-client` build target in your React website project which creates a type-safe client from the OpenAPI specification, writing the client as `.gen.ts` files to `src/generated/<api-name>`.
3. Installs required dependencies:
   - aws4fetch (if using IAM auth)

### Using the Generated Code

#### Using the API Hook

The generator provides a `use<ApiName>` hook that gives you access to the type-safe API client:

```tsx {5,13}
import { useState, useEffect } from 'react';
import { useMyApi } from './hooks/useMyApi';

function MyComponent() {
  const api = useMyApi();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchItem = async () => {
      try {
        const data = await api.getItem({ itemId: 'some-id' });
        setItem(data);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };
    fetchItem();
  }, [api]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>Item: {item.name}</div>;
}
```

#### Error Handling

The integration includes built-in error handling with typed error responses. An `<operation-name>Error` type is generated which encapsulates the possible error responses defined in the OpenAPI specification. Each error has a `status` and `error` property, and by checking the value of `status` you can narrow to a specific type of error.

```tsx {9,15}
function MyComponent() {
  const api = useMyApi();
  const [error, setError] = useState<CreateItemError | null>(null);

  const handleClick = async () => {
    try {
      await api.createItem({ name: 'New Item' });
    } catch (e) {
      const err = e as CreateItemError;
      setError(err);
    }
  };

  if (error) {
    switch (error.status) {
      case 400:
        // error.error is typed as CreateItem400Response
        return (
          <div>
            <h2>Invalid input:</h2>
            <p>{error.error.message}</p>
            <ul>
              {error.error.validationErrors.map((err) => (
                <li key={err.field}>{err.message}</li>
              ))}
            </ul>
          </div>
        );
      case 403:
        // error.error is typed as CreateItem403Response
        return (
          <div>
            <h2>Not authorized:</h2>
            <p>{error.error.reason}</p>
          </div>
        );
      case 500:
      case 502:
        // error.error is typed as CreateItem5XXResponse
        return (
          <div>
            <h2>Server error:</h2>
            <p>{error.error.message}</p>
            <p>Trace ID: {error.error.traceId}</p>
          </div>
        );
    }
  }

  return <button onClick={handleClick}>Create Item</button>;
}
```

#### Consuming a Stream

If you have [configured your FastAPI to stream responses](#streaming), the generated client will include type-safe methods for asynchronously iterating over chunks in your stream using `for await` syntax.

For example:

```tsx {8}
function MyStreamingComponent() {
  const api = useMyApi();

  const [chunks, setChunks] = useState<Chunk[]>([]);

  useEffect(() => {
    const streamChunks = async () => {
      for await (const chunk of api.myStream()) {
        setChunks((prev) => [...prev, chunk]);
      }
    };
    streamChunks();
  }, [api]);

  return (
    <ul>
      {chunks.map((chunk) => (
        <li>
          {chunk.timestamp.toISOString()}: {chunk.message}
        </li>
      ))}
    </ul>
  );
}
```

### Best Practices

#### 1. Handle Loading States

Always handle loading and error states for a better user experience:

```tsx
function ItemList() {
  const api = useMyApi();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const data = await api.listItems();
        setItems(data);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [api]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    const err = error as ListItemsError;
    switch (err.status) {
      case 403:
        // err.error is typed as ListItems403Response
        return <ErrorMessage message={err.error.reason} />;
      case 500:
      case 502:
        // err.error is typed as ListItems5XXResponse
        return <ErrorMessage message={err.error.message} details={`Trace ID: ${err.error.traceId}`} />;
      default:
        return <ErrorMessage message="An unknown error occurred" />;
    }
  }

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
```

#### 2. Optimistic Updates

Implement optimistic updates for a better user experience:

```tsx
function ItemList() {
  const api = useMyApi();
  const [items, setItems] = useState([]);

  const handleDelete = async (itemId) => {
    // Optimistically remove the item
    const previousItems = items;
    setItems(items.filter((item) => item.id !== itemId));

    try {
      await api.deleteItem(itemId);
    } catch (error) {
      // Restore previous items on error
      setItems(previousItems);
      console.error('Failed to delete item:', error);
    }
  };

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>
          {item.name}
          <button onClick={() => handleDelete(item.id)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
```

### Type Safety

The integration provides complete end-to-end type safety. Your IDE will provide full autocompletion and type checking for all your API calls:

```tsx
function ItemForm() {
  const api = useMyApi();
  const [error, setError] = useState<CreateItemError | null>(null);

  const handleSubmit = async (data: CreateItemInput) => {
    try {
      // ✅ Type error if input doesn't match schema
      await api.createItem(data);
    } catch (e) {
      // ✅ Error type includes all possible error responses
      const err = e as CreateItemError;
      switch (err.status) {
        case 400:
          // err.error is typed as CreateItem400Response
          console.error('Validation errors:', err.error.validationErrors);
          break;
        case 403:
          // err.error is typed as CreateItem403Response
          console.error('Not authorized:', err.error.reason);
          break;
        case 500:
        case 502:
          // err.error is typed as CreateItem5XXResponse
          console.error('Server error:', err.error.message, 'Trace:', err.error.traceId);
          break;
      }
      setError(err);
    }
  };

  // Error UI can use type narrowing to handle different error types
  if (error) {
    switch (error.status) {
      case 400:
        return <FormError message="Invalid input" errors={error.error.validationErrors} />;
      case 403:
        return <AuthError reason={error.error.reason} />;
      default:
        return <ServerError message={error.error.message} />;
    }
  }

  return <form onSubmit={handleSubmit}>{/* ... */}</form>;
}
```

The types are automatically generated from your FastAPI's OpenAPI schema, ensuring that any changes to your API are reflected in your frontend code after a build.
