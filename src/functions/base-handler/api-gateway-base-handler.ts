import type { ZodSchema } from 'zod'
import type { APIGatewayProxyEvent, APIGatewayProxyEventHeaders, APIGatewayProxyResult } from 'aws-lambda'
import type { Input } from '@utils/response'
import { formatResponse } from '@utils/response'
import type { APIGatewayParsedEvent } from '@utils/mediators/zod-parser'
import { zodParser } from '@utils/mediators/zod-parser'
import { parseJSONBody } from '@utils/mediators/json-body-parser'
import { handleError } from '@utils/mediators/error-handler'
import { BaseHandler } from '.'
import type { ContextContainer } from '@utils/context-container'
import type { AuthRoles } from '@utils/auth/types'
import { checkAccess } from '@utils/auth'

export abstract class APIGatewayBaseHandler extends BaseHandler<APIGatewayProxyEvent, APIGatewayProxyResult> {
  protected readonly schema: ZodSchema

  constructor(context: ContextContainer, event: APIGatewayProxyEvent, schema: ZodSchema) {
    super(context, event)
    this.schema = schema
  }

  protected checkAccess(roles: AuthRoles[]): Promise<void> {
    return checkAccess(this.context, this.event, roles)
  }

  protected parseSchema<TSchema>(): TSchema {
    const customEvent: APIGatewayParsedEvent = {
      ...this.event,
      body: this.event.body ? this.parseJSONBody(this.event.body, this.event.headers) : {}
    }
    return zodParser<TSchema>(this.context, this.schema, customEvent)
  }

  protected parseJSONBody(body: string | null, headers: APIGatewayProxyEventHeaders): Record<string, unknown> {
    return parseJSONBody(this.context, body, headers)
  }

  protected formatResponse<TResponse>(response: Input<TResponse>): APIGatewayProxyResult {
    return formatResponse<TResponse>(response)
  }

  protected handleError(error: Error): APIGatewayProxyResult {
    return handleError(this.context, error, this.event)
  }
}
