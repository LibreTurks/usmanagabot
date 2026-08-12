import { BotClient } from '@services/client';
import { Config } from '@services/config';
import { Database } from '@services/database';
import { Health } from '@services/health';
import { Logger } from '@services/logger';
import pkg from '../package.json';
import { Translator } from '@services/translator';

/**
 * The maximum time, in milliseconds, to wait for in-flight work to drain during a graceful
 * shutdown before forcing the process to exit. Aligned with Kubernetes' default
 * `terminationGracePeriodSeconds` (30s) minus a safety margin so the process exits before
 * the kubelet sends SIGKILL.
 * @private
 */
const shutdown_timeout_ms = 25_000;

/**
 * Initializes the application services in the correct order and registers signal handlers
 * for graceful shutdown.
 *
 * Startup sequence:
 * 1. Translator — loads localized message bundles used by all other services.
 * 2. Logger — applies the configured log level.
 * 3. Database — opens the TypeORM `DataSource` (required by every service that touches state).
 * 4. Health — starts the `/health` HTTP endpoint so orchestration probes succeed early.
 * 5. BotClient — registers events/commands and logs into the Discord gateway.
 *
 * After successful startup, `SIGINT` and `SIGTERM` handlers are installed. Receiving either
 * signal triggers a single, idempotent shutdown that drains services in reverse order:
 *   Health → BotClient → Database
 * A hard timeout guards against a step hanging so the process still exits within the
 * Kubernetes grace window.
 * @private
 * @async
 */
(async () => {
    await Translator.init();
    Logger.setLogLevel = Config.current_botcfg.log_level;
    Translator.setLanguage = Config.current_botcfg.language;
    await Database.init();
    await Health.init();
    await BotClient.init(Config.current_botcfg.token);
    Logger.send('services', 'system', 'info', 'started', { name: pkg.name, version: pkg.version });

    let shutting_down = false;
    const shutdown = async (signal: NodeJS.Signals) => {
        if (shutting_down) return;
        shutting_down = true;
        Logger.send('services', 'system', 'info', 'stopping', { signal });

        const force_exit = setTimeout(() => {
            Logger.send('services', 'system', 'error', 'stop_timeout');
            process.exit(1);
        }, shutdown_timeout_ms);
        force_exit.unref();

        try {
            Health.stop();
            await BotClient.stop();
            await Database.stop();
            Logger.send('services', 'system', 'info', 'stopped');
            process.exit(0);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.send('services', 'system', 'error', 'stop_failed', { message });
            process.exit(1);
        }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})();
