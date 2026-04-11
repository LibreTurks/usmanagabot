import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Channels } from './channels';
import { Guilds } from './guilds';
import { Messages } from './messages';
import { Users } from './users';

@Entity()
export class Starboard {
    @PrimaryGeneratedColumn({ type: 'smallint' })
    id!: number;

    @Column({ type: 'boolean', nullable: false, default: false })
    is_enabled!: boolean;

    @Column({ type: 'bigint', nullable: true, default: null })
    channel_id!: bigint | null;

    @Column({ type: 'varchar', length: 100, nullable: false, default: '⭐' })
    emoji!: string;

    @Column({ type: 'smallint', nullable: false, default: 3 })
    threshold!: number;

    @Column({ type: 'boolean', nullable: false, default: false })
    allow_self_star!: boolean;

    @Column({ type: 'boolean', nullable: false, default: false })
    allow_bot_messages!: boolean;

    @ManyToOne(() => Users, { nullable: false, eager: true })
    @JoinColumn({ name: 'latest_action_from_user', referencedColumnName: 'id' })
    latest_action_from_user!: Users;

    @ManyToOne(() => Guilds, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_guild', referencedColumnName: 'id' })
    from_guild!: Guilds;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    timestamp!: Date;
}

@Entity()
export class StarboardLogs {
    @PrimaryGeneratedColumn({ type: 'smallint' })
    id!: number;

    @Column({ type: 'smallint', nullable: false })
    star_count!: number;

    @Column({ type: 'bigint', nullable: true, default: null })
    starboard_message_id!: bigint | null;

    @ManyToOne(() => Messages, { nullable: false, eager: true })
    @JoinColumn({ name: 'message_id', referencedColumnName: 'id' })
    source_message!: Messages;

    @ManyToOne(() => Users, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_user', referencedColumnName: 'id' })
    from_user!: Users;

    @ManyToOne(() => Channels, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_channel', referencedColumnName: 'id' })
    from_channel!: Channels;

    @ManyToOne(() => Guilds, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_guild', referencedColumnName: 'id' })
    from_guild!: Guilds;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    timestamp!: Date;
}