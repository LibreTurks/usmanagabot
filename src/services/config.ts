import botcfg from '@config/bot.jsonc';
import dbcfg from '@config/database.jsonc';
import { env } from 'process';
import { z } from 'zod';
import { LogLevels } from './logger';
import { SupportedLanguages } from './translator';

/**
 * Configuration module.
 * Provides Zod schemas and a static Config class that loads and validates
 * bot and database configurations.
 *
 * This class handles parsing from JSONC files, environment variables, and in-memory objects,
 * making it flexible for different deployment environments.
 */

/**
 * Helper function to parse environment variables for Zod schema parsing.
 *
 * @param {string} key The environment variable key to read.
 * @param {T} schema A Zod schema instance to validate the environment variable against.
 * @param {(v: z.infer<T>) => z.infer<T>} [parser] Optional parser function to transform the raw env var.
 */
const parseEnv = <T extends z.ZodType>(key: string, schema: T, parser?: (v: z.infer<T>) => z.infer<T>) => {
    return z.preprocess((val) => {
        const raw = env[key];
        if (raw === undefined) return val;
        return parser ? parser(raw as z.infer<T>) : raw;
    }, schema);
};

/**
 * Zod schema for the bot configuration.
 *
 * Validated properties:
 * - app_id: Discord application ID (string) - uses BOT__APP_ID env var if set, fallback to JSONC
 * - clear_old_commands_on_startup: whether to clear old commands on startup (boolean) - uses BOT__CLEAR_OLD_COMMANDS_ON_STARTUP env var if set, fallback to JSONC or false
 * - language: localization language (enum of SupportedLanguages) - uses BOT__LANGUAGE env var if set, fallback to JSONC or SupportedLanguages.EN
 * - log_level: logging level (enum of LogLevels) - uses BOT__LOG_LEVEL env var if set, fallback to JSONC or debug/error based on NODE_ENV
 * - management: object containing management channel_id, guild_id, user_id (all strings) - uses BOT__MANAGEMENT__* env vars if set, fallback to JSONC
 * - health: object containing enabled (boolean) and port (number 1-65535) for the /health HTTP endpoint - uses BOT__HEALTH__* env vars if set, fallback to JSONC or { enabled: true, port: 3000 }
 * - token: Discord bot token (string) - uses BOT__TOKEN env var if set, fallback to JSONC
 */
const bot_config_schema = z.object({
    app_id: parseEnv('BOT__APP_ID', z.string().min(1, 'Application ID cannot be empty')),
    clear_old_commands_on_startup: parseEnv('BOT__CLEAR_OLD_COMMANDS_ON_STARTUP', z.boolean().default(false), (v) => {
        if (typeof v === 'string') {
            return (v as string).toLowerCase() === 'true';
        }
        return v;
    }),
    language: parseEnv(
        'BOT__LANGUAGE',
        z
            .enum(SupportedLanguages, {
                message: 'Invalid language',
            })
            .default(SupportedLanguages.EN_US),
    ),
    log_level: parseEnv(
        'BOT__LOG_LEVEL',
        z
            .enum(LogLevels, {
                message: 'Invalid log level',
            })
            .default(process.env.NODE_ENV === 'production' ? LogLevels.error : LogLevels.debug),
        (v) => {
            if (isNaN(Number(v))) return v;
            return Number(v);
        },
    ),
    management: z.object({
        channel_id: parseEnv('BOT__MANAGEMENT__CHANNEL_ID', z.string().min(1, 'Management channel_id cannot be empty')),
        guild_id: parseEnv('BOT__MANAGEMENT__GUILD_ID', z.string().min(1, 'Management guild_id cannot be empty')),
        user_id: parseEnv('BOT__MANAGEMENT__USER_ID', z.string().min(1, 'Management user_id cannot be empty')),
    }),
    health: z
        .object({
            enabled: parseEnv('BOT__HEALTH__ENABLED', z.boolean().default(true), (v) => {
                if (typeof v === 'string') {
                    return (v as string).toLowerCase() === 'true';
                }
                return v;
            }),
            port: parseEnv(
                'BOT__HEALTH__PORT',
                z
                    .number()
                    .int('Health port must be an integer')
                    .min(1, 'Health port must be between 1 and 65535')
                    .max(65535, 'Health port must be between 1 and 65535')
                    .default(3000),
                (v) => {
                    if (typeof v === 'string') {
                        return parseInt(v, 10);
                    }
                    return v;
                },
            ),
        })
        .default({ enabled: true, port: 3000 }),
    token: parseEnv('BOT__TOKEN', z.string().min(1, 'Bot token cannot be empty')),
});
export type BotConfig_t = z.infer<typeof bot_config_schema>;

/**
 * Zod schema for the database configuration.
 *
 * Validated properties:
 * - host: database host (string) - uses DB_HOST env var if set, fallback to JSONC or 'localhost'
 * - port: database port (number) - uses DB_PORT env var if set, fallback to JSONC or 5432
 * - username: database user (string) - uses DB_USERNAME env var if set, fallback to JSONC or 'usmanagabot'
 * - password: database password (string|undefined) - uses DB_PASSWORD env var if set, fallback to JSONC
 * - database: database name (string) - uses DB_DATABASE env var if set, fallback to JSONC or 'usmanagabot'
 * - synchronize: whether to synchronize schema (boolean) - uses DB_SYNCHRONIZE env var if set, fallback to JSONC or false
 * - logging: enable TypeORM logging (boolean) - uses DB_LOGGING env var if set, fallback to JSONC or false
 */
const database_config_schema = z.object({
    host: parseEnv('DB__HOST', z.string().min(1, 'Database host cannot be empty').default('localhost')),
    port: parseEnv('DB__PORT', z.number().min(1, 'Database port must be a positive integer').default(5432), (v) => {
        if (typeof v === 'string') {
            return parseInt(v, 10);
        }
        return v;
    }),
    username: parseEnv('DB__USERNAME', z.string().min(1, 'Database username cannot be empty').default('usmanagabot')),
    password: parseEnv('DB__PASSWORD', z.string().optional()),
    database: parseEnv('DB__DATABASE', z.string().min(1, 'Database name cannot be empty').default('usmanagabot')),
    synchronize: parseEnv('DB__SYNCHRONIZE', z.boolean().default(false), (v) => {
        if (typeof v === 'string') {
            return (v as string).toLowerCase() === 'true';
        }
        return v;
    }),
    logging: parseEnv('DB__LOGGING', z.boolean().default(false), (v) => {
        if (typeof v === 'string') {
            return (v as string).toLowerCase() === 'true';
        }
        return v;
    }),
});
export type DatabaseConfig_t = z.infer<typeof database_config_schema>;

/**
 * A static class for loading, validating, and providing access to runtime configuration.
 *
 * The class reads from JSONC files, environment variables, and in-memory objects.
 * It uses Zod to ensure that the configuration is valid before it is used.
 *
 * To use, call `Config.init()` at startup. The loaded configuration will be available
 * via `Config.current_botcfg` and `Config.current_dbcfg`.
 */
export class Config {
    /**
     * The currently loaded and validated bot configuration.
     */
    public static current_botcfg: BotConfig_t = Config.parse(botcfg, bot_config_schema as z.ZodType<BotConfig_t>);

    /**
     * The currently loaded and validated database configuration.
     */
    public static current_dbcfg: DatabaseConfig_t = Config.parse(
        dbcfg,
        database_config_schema as z.ZodType<DatabaseConfig_t>,
    );

    /**
     * Parse raw configuration data using the provided Zod schema.
     *
     * Behavior:
     * - If `data` is a string, it reads the file contents asynchronously and parses JSONC.
     * - If `data` is already an object, it validates that object directly.
     * - On validation or parse error, throws an error.
     *
     * @private
     * @static
     * @template T
     * @param {string|object} data Path to a JSON file or an in-memory object to validate.
     * @param {z.ZodType<T>} schema A Zod schema instance that validates the shape of T.
     * @returns {Promise<T>} The validated configuration typed as T.
     * @throws {Error} If parsing or validation fails.
     */
    private static parse<T>(data: object, schema: z.ZodType<T>): T {
        try {
            return schema.parse(data);
        } catch (error) {
            const message =
                error instanceof z.ZodError ? JSON.stringify(error.issues, null, 2) : (error as Error).message;
            throw new Error(`Failed to parse configuration: ${message}`);
        }
    }
}
