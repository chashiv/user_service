import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SESSION_STORE } from '../common/constants';
import { AppConfigModule } from '../config';
import { Session } from '../database/entities';
import { ISessionStore } from './interfaces';
import { MemorySessionStore, RedisSessionStore, DbSessionStore } from './stores';
import { SessionsService } from './sessions.service';

@Module({})
export class SessionsModule {
  static forRoot(): DynamicModule {
    // .env is loaded eagerly at the top of main.ts so process.env is populated here.
    const choice = (process.env.SESSION_STORE || 'memory') as 'memory' | 'redis' | 'db';

    let StoreClass: Type<ISessionStore>;
    switch (choice) {
      case 'redis':
        StoreClass = RedisSessionStore;
        break;
      case 'db':
        StoreClass = DbSessionStore;
        break;
      case 'memory':
      default:
        StoreClass = MemorySessionStore;
        break;
    }

    const providers: Provider[] = [
      StoreClass,
      { provide: SESSION_STORE, useExisting: StoreClass },
      SessionsService,
    ];

    return {
      module: SessionsModule,
      global: true,
      imports: [AppConfigModule, TypeOrmModule.forFeature([Session])],
      providers,
      exports: [SessionsService],
    };
  }
}

