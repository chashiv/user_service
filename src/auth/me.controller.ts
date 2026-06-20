import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { User } from '../database/entities';
import { UsersService } from '../users';
import { SessionGuard } from './guards';

@Controller('api')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentUser() user: User) {
    const identities = await this.users.listIdentities(user.id);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      identities: identities.map((i) => ({
        provider: i.provider,
        providerUserId: i.providerUserId,
        emailAtProvider: i.emailAtProvider,
        linkedAt: i.createdAt,
      })),
    };
  }
}
