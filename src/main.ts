import { BotClient } from '@services/client';
import { Config } from '@services/config';
import { Database } from '@services/database';
import { Logger } from '@services/logger';
import pkg from '../package.json';
import { Translator } from '@services/translator';

/**
 * The main entry point for the application.
 *
 * This self-executing asynchronous function orchestrates the initialization of all core services.
 * It ensures that services are started in the correct order, handling any potential critical failures
 * during the startup process.
 */
(async () => {
    await Translator.init();
    Logger.setLogLevel = Config.current_botcfg.log_level;
    Translator.setLanguage = Config.current_botcfg.language;
    await Database.init();
    await BotClient.init(Config.current_botcfg.token);
    Logger.send('services', 'system', 'info', 'started', { name: pkg.name, version: pkg.version });
})();
