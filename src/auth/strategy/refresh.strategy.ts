import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import refreshJwtConfig from 'src/config/refresh-jwt.config';
import { ConfigType } from '@nestjs/config';

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'refresh-jwt') {
  constructor(
    private configService: ConfigService,

    @Inject(refreshJwtConfig.KEY)
    private refreshJWTConfig: ConfigType<typeof refreshJwtConfig>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: refreshJWTConfig.secret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: any) {
    return { email: payload.email, role: payload.role };
  }
}
