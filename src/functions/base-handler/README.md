# `BaseHandler` Class

The `BaseHandler` class is an abstract base class used to simplify and standardize the creation of AWS Lambda handlers. It provides a framework for handling common tasks such as schema validation, error handling, JSON parsing, and response formatting.

## Key Methods

1. `handleRequest(context: ContextContainer, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>`: An abstract method that must be implemented by subclass handlers to define the core logic of the Lambda function.
2. `parseSchema<T>(event: APIGatewayProxyEvent): T`: Parses and validates the incoming request against the provided schema using zodParser. Throws a `ZodError` if validation fails.
3. `parseJSONBody(body: string | null, headers: APIGatewayProxyEventHeaders): Record<string, unknown>`: Parses the JSON body of the request.
4. `execute(context: ContextContainer, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult>`: The main entry point for executing the Lambda handler. It manages schema validation, error handling, and invokes the `handleRequest` method. It logs additional information, including the start and successful handling of requests and any unknown errors.

## Usage

To use the `BaseHandler` class, you need to extend it and implement the abstract `handleRequest` method.

### 1. Create a Subclass

Create a new file for handler and extend the `BaseHandler` class. Implement the `handleRequest` method with the specific logic for Lambda function.

```ts
// extend new Lambda handler with BaseHandler
export class ExampleHandler extends APIGatewayBaseHandler {
  constructor(clients: ContextContainer) {
    super(clients, schema)
  }

  protected async handleRequest(context: ContextContainer, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const validatedEvent = this.parseSchema(event)

    // ...and execute business logic here
    const result = await someLogic(this.clients)

    return this.formatResponse({
      statusCode: StatusCodes.OK,
      body: {
        data: result
      }
    })
  }
}
```

### 2. Export Lambda Function

Export an instance of handler’s execute method to be used as the entry point for the AWS Lambda function.

```ts
export const handler = async (event: APIGatewayProxyEvent) => {
  // initialize required clients for the Lambda function
  const clients: ContextContainer = {}

  // create an instance of the handler with initialized clients and schema
  const exampleHandler = new ExampleHandler(clients, Schema)

  // execute the handler's logic and return the result
  return exampleHandler.execute(clients, event)
}
```

The handler is now ready to be deployed to AWS Lambda. When AWS Lambda invokes the function, it will call the `execute` method of handler class, which schema validation, request handling, and error handling.
