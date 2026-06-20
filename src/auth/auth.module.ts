import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers';
import { UsersModule } from '../users';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { SessionGuard } from './guards';
import { CookieHelper } from './helpers';

@Module({
  imports: [ProvidersModule, UsersModule],
  providers: [AuthService, SessionGuard, CookieHelper],
  controllers: [AuthController, MeController],
  exports: [SessionGuard, CookieHelper, AuthService],
})
export class AuthModule {}
