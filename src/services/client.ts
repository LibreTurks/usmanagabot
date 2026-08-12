import { CommandLoader } from '@commands/index';
import { EventLoader } from '@events/index';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { BotConfig_t } from './config';
import { Logger } from './logger';

/**
 * A static class responsible for initializing and managing the Discord.js client.
 *
 * This class orchestrates the bot's startup sequence:
 * 1. Creates a new `Client` instance with the required gateway intents and partials.
 * 2. Initializes the `EventLoader` to register all event handlers.
 * 3. Initializes the `CommandLoader` to load all application commands.
 * 4. Logs the client into Discord using the provided token.
 *
 * The initialized client is stored in the static `BotClient.client` property for global access.
 */
export class BotClient {
    /**
     * The `Logger` class, used for logging client-related events.
     * @private
     * @static
     * @type {typeof Logger}
     */
    private static logger: typeof Logger = Logger;

    /**
     * The global `discord.js` `Client` instance, accessible after `init()` is called.
     * @public
     * @static
     * @type {Client}
     */
    public static client: Client;

    /**
     * Initializes the Discord client, loads events and commands, and logs in.
     * This is the main entry point for starting the bot.
     * @public
     * @static
     * @async
     * @param {BotConfig_t['token']} token The Discord bot authentication token.
     * @returns {Promise<void>}
     * @throws {Error} If the login to Discord fails.
     */
    public static async init(token: BotConfig_t['token']): Promise<void> {
        const intents = [
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.DirectMessageTyping,
            GatewayIntentBits.DirectMessageReactions,
            GatewayIntentBits.GuildExpressions,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.MessageContent,
        ];
        const partials = [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User];
        const client = new Client({ intents, partials });
        BotClient.client = await EventLoader.init(client);
        await CommandLoader.init();
        await BotClient.client.login(token);
    }

    /**
     * Gracefully tears down the Discord.js client.
     *
     * `client.destroy()` closes the gateway WebSocket, flushes pending writes and removes all
     * event listeners registered via `client.on/once`. After this call, no further Discord
     * events will be delivered. Safe to call when the client was never initialized.
     * @public
     * @static
     * @async
     * @returns {Promise<void>} Resolves when the gateway has been closed.
     */
    public static async stop(): Promise<void> {
        if (!BotClient.client) return;
        await BotClient.client.destroy();
    }
}
