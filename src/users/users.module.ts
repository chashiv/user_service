import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User, UserIdentity } from '../database/entities';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserIdentity])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

