import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { DomainException } from '../../domain/exceptions/domain.exception';

/**
 * Exception filter for business rule violations in wallet operations.
 * Returns 422 Unprocessable Entity instead of 500 Internal Server Error.
 */
@Catch(DomainException)
export class WalletExceptionFilter implements ExceptionFilter {
  catch(exception: DomainException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: exception.message,
      type: exception.constructor.name,
    });
  }
}
