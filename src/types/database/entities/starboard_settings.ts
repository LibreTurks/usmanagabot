import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Channels } from './channels';
import { Guilds } from './guilds';
import { Users } from './users';

@Entity()
export class StarboardSettings {
    @PrimaryGeneratedColumn({ type: 'smallint' })
    id!: number;

    @Column({ type: 'varchar', length: 20, nullable: false, default: 'Disabled' })
    is_enabled!: string;

    @Column({ type: 'bigint', nullable: true, default: null })
    starboard_channel_id!: bigint | null;

    @ManyToOne(() => Channels, { nullable: true, eager: true })
    @JoinColumn({ name: 'starboard_channel_id', referencedColumnName: 'cid' })
    starboard_channel!: Channels | null;

    @Column({ type: 'varchar', length: 100, nullable: false, default: '⭐' })
    emoji!: string;

    @Column({ type: 'smallint', nullable: false, default: 3 })
    threshold!: number;

    @Column({ type: 'varchar', length: 20, nullable: false, default: 'Not Allowed' })
    allow_self_star!: string;

    @Column({ type: 'varchar', length: 20, nullable: false, default: 'Delete' })
    remove_below_threshold!: string;

    @ManyToOne(() => Users, { nullable: false, eager: true })
    @JoinColumn({ name: 'latest_action_from_user', referencedColumnName: 'id' })
    latest_action_from_user!: Users;

    @ManyToOne(() => Guilds, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_guild', referencedColumnName: 'id' })
    from_guild!: Guilds;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    timestamp!: Date;
}
