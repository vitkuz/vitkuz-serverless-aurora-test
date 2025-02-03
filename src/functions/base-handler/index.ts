import type { ContextContainer } from '@utils/context-container'

export abstract class BaseHandler<TEvent, TResult> {
  context: ContextContainer
  event: TEvent
  protected abstract handleRequest(): Promise<TResult>
  protected abstract handleError(error: Error): TResult

  constructor(context: ContextContainer, event: TEvent) {
    this.context = context
    this.event = event
  }

  public async execute(): Promise<TResult> {
    this.context.logger.info('Execution started')

    try {
      const result = await this.handleRequest()
      this.context.logger.info('Request handled successfully')

      return result
    } catch (error: unknown) {
      if (error instanceof Error) {
        return this.handleError(error)
      }

      this.context.logger.error('Unknown error occurred', { data: { error } })
      const genericError = new Error('Unknown error occurred')

      return this.handleError(genericError)
    }
  }
}
