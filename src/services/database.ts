import { Config, DatabaseConfig_t } from '@services/config';
import { Logger } from '@services/logger';
import { Guilds } from '@src/types/database/entities/guilds';
import { Users } from '@src/types/database/entities/users';
import { DatabaseManager } from '@src/types/structure/database';
import { glob } from 'glob';
import { DataSource } from 'typeorm';

/**
 * A static class for initializing and managing the TypeORM DataSource.
 *
 * Responsibilities:
 * - Dynamically discovers entities, migrations, and subscribers from the `src/types/database` directory.
 * - Initializes and exposes the TypeORM `DataSource` for use across the application.
 * - Provides a `dbManager` proxy for convenient access to the entity manager with custom helper methods.
 *
 * Initialization errors during `init()` are thrown to be caught by the global error handler in `main.ts`.
 */
export class Database {
    /**
     * The `Logger` class used for reporting initialization events.
     * @private
     * @static
     * @type {typeof Logger}
     */
    private static logger: typeof Logger = Logger;

    /**
     * The currently loaded database configuration used to build the `DataSource`.
     * @static
     * @type {DatabaseConfig_t}
     */
    public static current_dbcfg: DatabaseConfig_t;

    /**
     * The TypeORM `DataSource` instance once initialization completes.
     * Will be `null` until `init()` successfully runs.
     * @type {(DataSource | null)}
     */
    public static dataSource: DataSource | null = null;

    /**
     * Provides a proxy-wrapped TypeORM `EntityManager` with added convenience methods
     * for retrieving `Guilds` and `Users` entities by their IDs.
     *
     * @returns {DatabaseManager} Proxy-wrapped EntityManager with custom methods.
     */
    public static get dbManager(): DatabaseManager {
        return new Proxy(this.dataSource!.manager, {
            get: (target, prop: keyof DatabaseManager) => {
                switch (prop) {
                    case 'getGuild':
                        return async (guild_id: bigint): Promise<Guilds | null> => {
                            return target.findOne(Guilds, { where: { gid: BigInt(guild_id) } });
                        };
                    case 'getUser':
                        return async (user_id: bigint): Promise<Users | null> => {
                            return target.findOne(Users, { where: { uid: BigInt(user_id) } });
                        };
                }
                const original = target[prop];
                if (typeof original === 'function') {
                    return (...args: unknown[]) => {
                        return (original as (...a: unknown[]) => unknown).apply(target, args);
                    };
                }
                return original;
            },
        }) as DatabaseManager;
    }

    /**
     * Initialize the TypeORM `DataSource`:
     * - Scans repository for entities, migrations, and subscribers.
     * - Constructs a `DataSource` using the loaded configuration and modules.
     * - Calls `dataSource.initialize()` and throws on error.
     *
     * @static
     * @async
     * @param {DatabaseConfig_t} [c_dbcfg] Optional override for the database configuration.
     * @returns {Promise<void>} Resolves when initialization completes.
     * @throws {Error} If initialization fails.
     */
    public static async init(c_dbcfg?: DatabaseConfig_t): Promise<void> {
        Database.current_dbcfg = c_dbcfg || Config.current_dbcfg;
        const entities = (await glob('src/types/database/entities/*.ts')).sort((a, b) => a.localeCompare(b));
        const migrations = (await glob('src/types/database/migrations/*.ts')).sort((a, b) => a.localeCompare(b));
        const subscribers = (await glob('src/types/database/subscribers/*.ts')).sort((a, b) => a.localeCompare(b));

        try {
            Database.dataSource = new DataSource({
                type: 'postgres',
                host: Database.current_dbcfg.host,
                port: Database.current_dbcfg.port,
                username: Database.current_dbcfg.username,
                password: Database.current_dbcfg.password,
                database: Database.current_dbcfg.database,
                synchronize: Database.current_dbcfg.synchronize,
                logging: Database.current_dbcfg.logging,
                entities,
                migrations,
                subscribers,
            });

            await Database.dataSource.initialize();
            Logger.send('services', 'database', 'info', 'init.success');
        } catch (error) {
            throw new Error(
                `Failed to initialize database: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    /**
     * Gracefully closes the TypeORM `DataSource`, releasing the underlying connection pool.
     *
     * Safe to call when the datasource was never initialized or already destroyed; in those
     * cases the method resolves without performing any work and without throwing.
     * @public
     * @static
     * @async
     * @returns {Promise<void>} Resolves when the connection has been closed (or there was nothing to close).
     */
    public static async stop(): Promise<void> {
        const data_source = Database.dataSource;
        if (!data_source) return;
        try {
            await data_source.destroy();
            Logger.send('services', 'database', 'info', 'closed');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            Logger.send('services', 'database', 'error', 'close_failed', { message });
        }
    }
}
