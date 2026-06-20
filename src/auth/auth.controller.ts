import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ProvidersService } from '../providers';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';
import { CookieHelper } from './helpers';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly providers: ProvidersService,
    private readonly cookies: CookieHelper,
  ) {}

  @Get('providers')
  listProviders() {
    return { enabled: this.providers.names() };
  }

  @Post(':provider/login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async login(
    @Param('provider') providerName: string,
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.auth.loginWithProvider(providerName, body.token);
    this.cookies.setSession(res, session.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        createdAt: user.createdAt,
      },
      session: { expiresAt: session.expiresAt },
    };
  }

  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = this.cookies.readSession(req);
    await this.auth.logout(sessionId);
    this.cookies.clearSession(res);
    return { ok: true };
  }
}
