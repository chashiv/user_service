import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SessionsService } from '../../sessions';
import { UsersService } from '../../users';
import { CookieHelper } from '../helpers';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly cookies: CookieHelper,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const sessionId = this.cookies.readSession(req);
    if (!sessionId) throw new UnauthorizedException({ error: 'unauthorized' });

    const session = await this.sessions.get(sessionId);
    if (!session) throw new UnauthorizedException({ error: 'unauthorized' });

    const user = await this.users.findById(session.userId);
    if (!user) throw new UnauthorizedException({ error: 'unauthorized' });

    (req as any).user = user;
    (req as any).session = session;
    return true;
  }
}
