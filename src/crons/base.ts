import { Client, GatewayIntentBits } from 'discord.js';
import { Config } from '@services/config';
import { Database } from '@services/database';
import { Logger, LogLevels } from '@services/logger';
import { Translator } from '@services/translator';

export abstract class CronBase {
    protected abstract name: string;

    public readonly db = Database.dbManager;

    protected readonly t = Translator.generateQueryFunc({ caller: this.name });

    protected readonly log = (
        type: keyof typeof LogLevels,
        key: string,
        replacements?: { [key: string]: unknown },
    ): void => {
        return Logger.send('commands', this.name, type, key, replacements);
    };

    public static async init(): Promise<void> {
        await Translator.init();
        Logger.setLogLevel = Config.current_botcfg.log_level;
        Translator.setLanguage = Config.current_botcfg.language;
        await Database.init();
    }

    public createDiscordClient(): Client {
        const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMessageReactions,
            ],
        });
        return client;
    }

    public async loginDiscordClient(client: Client, token: string): Promise<void> {
        await client.login(token);
    }
}
