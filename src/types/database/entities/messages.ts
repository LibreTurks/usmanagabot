import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Channels } from './channels';
import { Guilds } from './guilds';
import { Users } from './users';

@Entity()
export class Messages {
    @PrimaryGeneratedColumn({ type: 'int' })
    id!: number;

    @Column({ type: 'boolean', nullable: false, default: false })
    message_is_deleted!: boolean;

    @Column({ type: 'boolean', nullable: false, default: false })
    message_is_edited!: boolean;

    @Column({ type: 'bigint', nullable: false, unique: true })
    message_id!: bigint;

    @Column({ type: 'bigint', nullable: true, default: null })
    logged_message_id!: bigint;

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
