import { BaseHandler } from '.'

export abstract class CognitoBaseHandler<TEvent> extends BaseHandler<TEvent, TEvent> {
  protected handleError(error: Error): TEvent {
    this.context.logger.error('Error occurred in Cognito handler', { error, event: this.event })
    throw error
  }
}
