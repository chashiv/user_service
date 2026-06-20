import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_identities')
@Unique('uniq_provider_user', ['provider', 'providerUserId'])
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, (u) => u.identities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'text', name: 'provider_user_id' })
  providerUserId!: string;

  @Column({ type: 'text', nullable: true, name: 'email_at_provider' })
  emailAtProvider!: string | null;

  @Column({ type: 'text', nullable: true, name: 'raw_profile' })
  rawProfile!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
