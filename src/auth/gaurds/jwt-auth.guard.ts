import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from 'src/decorators/public-route';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  // getRequest(context: ExecutionContext) {
  //   const ctx = context.switchToHttp();
  //   const request = ctx.getRequest();

  //   return request.raw ?? request;
  // }

  // handleRequest(err, user, info, context: ExecutionContext) {
  //   if (err || !user) {
  //     throw err || new UnauthorizedException('Invalid access token');
  //   }
  //   const req = context.switchToHttp().getRequest();
  //   req.user = user;
  //   return user;
  // }
}
