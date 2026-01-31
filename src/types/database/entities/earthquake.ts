import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Guilds } from './guilds';
import { Users } from './users';

@Entity()
export class Earthquake {
    @PrimaryGeneratedColumn({ type: 'smallint' })
    id!: number;

    @Column({ type: 'boolean', nullable: false, default: false })
    is_enabled!: boolean;

    @Column({ type: 'bigint', nullable: true, default: null })
    channel_id!: string;

    @Column({ type: 'float', nullable: true, default: null })
    magnitude_limit!: number;

    @Column({ type: 'float', nullable: true, default: null })
    everyone_ping_threshold!: number | null;

    @Column({ type: 'text', nullable: true, default: null })
    seismicportal_api_url!: string;

    @Column({ type: 'bigint', nullable: true, default: null })
    ping_role_id!: string | null;

    @Column({ type: 'varchar', nullable: true, default: 'en', length: 8 })
    region_code!: string;

    @ManyToOne(() => Users, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_user', referencedColumnName: 'id' })
    latest_action_from_user!: Users;

    @ManyToOne(() => Guilds, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_guild', referencedColumnName: 'id' })
    from_guild!: Guilds;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    timestamp!: Date;
}

@Entity()
export class EarthquakeLogs {
    @PrimaryGeneratedColumn({ type: 'smallint' })
    id!: number;

    @Column({ type: 'boolean', nullable: false, default: false })
    is_delivered!: boolean;

    @Column({ type: 'varchar', length: 64, nullable: false })
    source_id!: string;

    @Column({ type: 'varchar', length: 32, nullable: false })
    source_name!: string;

    @ManyToOne(() => Guilds, { nullable: false, eager: true })
    @JoinColumn({ name: 'from_guild', referencedColumnName: 'id' })
    from_guild!: Guilds;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    timestamp!: Date;
}

@Entity()
export class EarthquakeSubscription {
    @PrimaryGeneratedColumn({ type: 'integer' })
    id!: number;

    @ManyToOne(() => Users, { nullable: false, eager: true })
    @JoinColumn({ name: 'user', referencedColumnName: 'id' })
    user!: Users;

    @ManyToOne(() => Guilds, { nullable: false, eager: true })
    @JoinColumn({ name: 'guild', referencedColumnName: 'id' })
    guild!: Guilds;

    @Column({ type: 'text', nullable: false })
    city!: string;
}
