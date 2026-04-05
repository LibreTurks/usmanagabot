import {
    ActionRowBuilder,
    BaseInteraction,
    Colors,
    CommandInteraction,
    ContextMenuCommandBuilder,
    EmbedBuilder,
    Interaction,
    MessageFlags,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    User,
} from 'discord.js';
import moment from 'moment';
import 'reflect-metadata';
import { format } from 'util';
import { BotClient } from '../../services/client';
import { Config } from '../../services/config';
import { Database } from '../../services/database';
import { Logger, LogLevels } from '../../services/logger';
import { SupportedLanguages, Translator } from '../../services/translator';
import { Paginator } from '../../utils/paginator';
import { Users } from '../database/entities/users';
import { DatabaseManager } from './database';

/**
 * The abstract base class for all application commands.
 *
 * It provides a common structure for command properties (e.g., `name`, `description`),
 * utility getters for accessing static services (`cfg`, `db`, `log`), and core methods
 * for execution and localization.
 *
 * All new commands should extend either `BaseCommand` or `CustomizableCommand`.
 */
export abstract class BaseCommand {
    // ======================== HEADER SECTION ======================== //
    /**
     * Specifies whether the command is enabled and should be registered.
     * @public
     * @readonly
     * @type {boolean}
     * @default true
     */
    public enabled: boolean = true;

    /**
     * The unique name of the command.
     * @public
     * @readonly
     * @type {string}
     */
    public readonly name: string;

    /**
     * A user-friendly, human-readable name for the command.
     * @public
     * @readonly
     * @type {string}
     */
    public readonly pretty_name: string;

    /**
     * A brief summary of what the command does.
     * @public
     * @readonly
     * @type {string}
     */
    public readonly description: string;

    /**
     * Indicates whether the command requires administrator privileges to use.
     * @public
     * @readonly
     * @type {boolean}
     */
    public readonly is_admin_command: boolean = false;

    /**
     * Indicates whether the command is restricted to bot owners only.
     * @public
     * @readonly
     * @type {boolean}
     */
    public readonly is_bot_owner_command: boolean = false;

    /**
     * Detailed help text for the command, intended for display in a help command.
     * @public
     * @readonly
     * @type {string}
     */
    public readonly help: string;

    /**
     * The duration in seconds that a user must wait before using the command again.
     * @public
     * @readonly
     * @type {number}
     * @default 0
     */
    public readonly cooldown: number;

    /**
     * An array of alternative names for the command.
     * @public
     * @readonly
     * @type {string[] | undefined}
     */
    public readonly aliases?: string[];
    // ================================================================ //

    // ===================== COMMAND DATA SECTION ===================== //
    /**
     * The `discord.js` command data builder for the main slash command.
     * @private
     * @type {(SlashCommandBuilder | ContextMenuCommandBuilder | null)}
     */
    private main_command_data: SlashCommandBuilder | ContextMenuCommandBuilder | null = null;

    /**
     * A set of additional command data builders, for subcommands or related commands.
     * @private
     * @type {Set<SlashCommandBuilder | ContextMenuCommandBuilder>}
     */
    private extra_command_data: Set<SlashCommandBuilder | ContextMenuCommandBuilder> = new Set();
    // ================================================================ //

    // ===================== COMMAND BASE SECTION ===================== //
    /**
     * The main execution logic for the command. This method must be implemented by all subclasses.
     * @public
     * @abstract
     * @param {Interaction | CommandInteraction | unknown} interaction The interaction object from Discord.js.
     * @param {unknown} [args] Optional additional arguments.
     * @returns {Promise<unknown>} A promise that resolves when the command execution is complete.
     */
    public abstract execute(interaction: Interaction | CommandInteraction | unknown, args?: unknown): Promise<unknown>;

    /**
     * Initializes a new instance of the `BaseCommand`, setting its properties and
     * creating the initial slash command data builder with localized names and descriptions.
     * @param {Partial<BaseCommand> & { name: string }} options The options to initialize the command with.
     */
    constructor(options: Partial<BaseCommand> & { name: string }) {
        this.enabled = options.enabled ?? true;
        this.name = options.name;
        this.t = Translator.generateQueryFunc({ caller: this.name });
        this.pretty_name = this.t.commands({ key: options.pretty_name ?? 'pretty_name' }) ?? 'No pretty name provided.';
        this.description = this.t.commands({ key: options.description ?? 'description' }) ?? 'No description provided.';
        this.is_admin_command = options.is_admin_command ?? false;
        this.is_bot_owner_command = options.is_bot_owner_command ?? false;
        this.help = this.t.commands({ key: options.help ?? 'help' }) ?? 'No help provided.';
        this.cooldown = options.cooldown ?? 0;
        this.aliases = options.aliases;
        this.main_command_data = new SlashCommandBuilder().setName(this.name).setDescription(this.description);
        this.main_command_data.setNameLocalizations(this.getLocalizations('name'));
        this.main_command_data.setDescriptionLocalizations(this.getLocalizations('description'));
    }
    // ================================================================ //

    // ================== COMMAND UTILITIES SECTION =================== //
    /**
     * Provides access to the static `Config` class.
     * @protected
     * @returns {typeof Config} The `Config` class.
     */
    protected get cfg(): typeof Config {
        return Config;
    }

    /**
     * Provides access to the `DatabaseManager` proxy.
     * @protected
     * @returns {DatabaseManager} The `DatabaseManager` instance.
     */
    protected get db(): DatabaseManager {
        return Database.dbManager;
    }

    /**
     * A logging function that prefixes log messages with the 'commands' context.
     * @protected
     * @returns {(type: keyof typeof LogLevels, key: string, replacements?: { [key: string]: unknown }) => void} The logging function.
     */
    protected get log(): (
        type: keyof typeof LogLevels,
        key: string,
        replacements?: { [key: string]: unknown },
    ) => void {
        return (type: keyof typeof LogLevels, key: string, replacements?: { [key: string]: unknown }) => {
            return Logger.send('commands', this.name, type, key, replacements);
        };
    }

    /**
     * Provides access to the static `Paginator` class.
     * @protected
     * @returns {typeof Paginator} The `Paginator` class.
     */
    protected get paginator(): typeof Paginator {
        return Paginator;
    }

    /**
     * Gets the primary command data builder.
     * @public
     * @returns {SlashCommandBuilder | ContextMenuCommandBuilder | null} The main command data builder.
     */
    public get base_cmd_data(): SlashCommandBuilder | ContextMenuCommandBuilder | null {
        return this.main_command_data;
    }

    /**
     * Sets the primary command data builder.
     * @public
     * @param {SlashCommandBuilder | ContextMenuCommandBuilder | null} data The command data builder to set.
     */
    public set base_cmd_data(data: SlashCommandBuilder | ContextMenuCommandBuilder | null) {
        this.main_command_data = data;
    }

    /**
     * Gets an array containing the main and all extra command data builders.
     * @public
     * @returns {(SlashCommandBuilder | ContextMenuCommandBuilder | null)[]} An array of all command data builders.
     */
    public get all_cmd_data(): (SlashCommandBuilder | ContextMenuCommandBuilder | null)[] {
        return [this.main_command_data, ...(this.extra_command_data ?? [])];
    }

    /**
     * Adds a new command data builder to the set of extra command data.
     * It ensures that no duplicate command names are added.
     * @public
     * @param {SlashCommandBuilder | ContextMenuCommandBuilder} data The command data builder to add.
     */
    public set push_cmd_data(data: SlashCommandBuilder | ContextMenuCommandBuilder) {
        for (const cmd_data of this.extra_command_data) {
            if (cmd_data.name === data.name) return;
        }
        this.extra_command_data.add(data);
    }

    /**
     * Translates a given key using the command's translation context.
     * @protected
     * @param {{ key: string; replacements?: { [key: string]: unknown }; lang?: SupportedLanguages; id?: bigint | Interaction }} o The translation options.
     * @returns {string} The translated string.
     */
    protected t!: ReturnType<typeof Translator.generateQueryFunc>;

    /**
     * Generates localized names or descriptions for all supported languages.
     * @protected
     * @param {string} key The localization key to translate.
     * @returns {Record<string, string>} An object mapping language codes to localized strings.
     */
    protected getLocalizations(key: string, replacements?: { [key: string]: unknown }): Record<string, string> {
        return Object.values(SupportedLanguages)
            .filter((l) => /^[a-z]*$/.test(l[0]))
            .reduce(
                (acc, lang) => {
                    if (lang === SupportedLanguages.AUTO) return acc;
                    acc[lang] = this.t.commands({ key, replacements, lang });
                    return acc;
                },
                {} as Record<string, string>,
            );
    }
    // ================================================================ //
}

/**
 * An abstract class for commands that have customizable, guild-specific settings.
 *
 * This class extends `BaseCommand` and adds functionality for managing per-guild configurations,
 * including methods for preparing data (`prepareCommandData`) and rendering a settings UI (`settingsUI`).
 * It also provides a helper method, `findOrCreateSetting`, to simplify database interactions.
 */
export abstract class CustomizableCommand extends BaseCommand {
    // ============= CUSTOMIZABLE COMMAND HEADER SECTION ============== //
    // ================================================================ //

    // ============== CUSTOMIZABLE COMMAND DATA SECTION =============== //
    /**
     * An optional warning message to be displayed at the top of the settings UI.
     * @protected
     * @type {string | null}
     */
    protected warning: string | null = null;
    // ================================================================ //

    // ============== CUSTOMIZABLE COMMAND BASE SECTION =============== //
    /**
     * An abstract method for preparing command-specific data for a guild, such as creating
     * default database entries. This is called by the `CommandLoader` at startup.
     * @public
     * @abstract
     * @param {bigint} guild_id The ID of the guild for which to prepare data.
     * @returns {Promise<void>} A promise that resolves when preparation is complete.
     */
    public abstract prepareCommandData(guild_id: bigint): Promise<void>;

    /**
     * Renders and sends the settings user interface for the command.
     *
     * This method dynamically builds an embed and select menu based on the setting components
     * registered with the `@Setting...` decorators.
     * @public
     * @param {BaseInteraction | CommandInteraction} interaction The interaction that triggered the settings UI.
     * @returns {Promise<void>} A promise that resolves when the UI has been sent or updated.
     */
    public async settingsUI(interaction: BaseInteraction | CommandInteraction): Promise<void> {
        const subsettings = Reflect.getMetadata('custom:settings', this.constructor);
        const cmd_name = this.t.commands({ key: 'pretty_name', guild_id: BigInt(interaction.guildId!) });
        const ui = new EmbedBuilder().setTitle(
            `:gear: ${this.t.commands({ caller: 'settings', key: 'execute.title', replacements: { command: cmd_name }, guild_id: BigInt(interaction.guildId!) })}`,
        );
        const menu = new StringSelectMenuBuilder().setCustomId(`settings:${this.name}`).setPlaceholder(
            this.t.commands({
                caller: 'settings',
                key: 'execute.placeholder',
                guild_id: BigInt(interaction.guildId!),
            }),
        );
        if (this.warning) {
            ui.setColor(Colors.Yellow);
            ui.addFields({ name: ':warning:', value: this.warning });
            this.warning = null;
        } else {
            ui.setColor(Colors.Blurple);
        }

        let latest_action_from_user: [Users | string | null, Date | null] = [null, null];
        for (const [name, setting] of subsettings) {
            if (setting.view_in_ui) {
                let row;
                if (setting.is_bot_owner_only) {
                    if (setting.db_column_is_array) {
                        const rows = await this.db.find(setting.database, {
                            where: { id: 1 },
                        });
                        row = rows.map((r) => r[setting.database_key as keyof unknown]);
                        if (Array.isArray(row[0])) row = row[0];
                    } else {
                        const db = (await this.db.findOne(setting.database, {
                            where: { id: 1 },
                        }))!;
                        latest_action_from_user = [
                            this.cfg.current_botcfg.management.user_id,
                            db['timestamp' as keyof unknown],
                        ];
                        row = db[setting.database_key as keyof unknown];
                    }
                } else {
                    if (setting.db_column_is_array) {
                        const rows = await this.db.find(setting.database, {
                            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
                        });
                        row = rows.map((r) => r[setting.database_key as keyof unknown]);
                        if (Array.isArray(row[0])) row = row[0];
                    } else {
                        const db = (await this.db.findOne(setting.database, {
                            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
                        }))!;
                        latest_action_from_user = [
                            db['latest_action_from_user' as keyof unknown],
                            db['timestamp' as keyof unknown],
                        ];
                        row = db[setting.database_key as keyof unknown];
                    }
                }
                let key = this.t.commands({ key: setting.display_name, guild_id: BigInt(interaction.guildId!) });
                let value;
                if (typeof row === 'boolean') {
                    value = row
                        ? `:green_circle: ${this.t.system({ caller: 'buttons', key: 'yes', guild_id: BigInt(interaction.guildId!) })}`
                        : `:red_circle: ${this.t.system({ caller: 'buttons', key: 'no', guild_id: BigInt(interaction.guildId!) })}`;
                } else if (setting.db_column_is_array) {
                    value = setting.database_key
                        ? Array.isArray(row) && row.length > 0
                            ? row.length == 1 && row[0] === null
                                ? `:orange_circle: ${this.t.commands({ caller: 'settings', key: 'execute.not_set', guild_id: BigInt(interaction.guildId!) })}`
                                : row.map((val) => format(setting.format_specifier, val)).join(', ')
                            : `:orange_circle: ${this.t.commands({ caller: 'settings', key: 'execute.not_set', guild_id: BigInt(interaction.guildId!) })}`
                        : this.t.commands({
                              caller: 'settings',
                              key: 'execute.view_in_edit_mode',
                              guild_id: BigInt(interaction.guildId!),
                          });
                } else {
                    value = setting.database_key
                        ? row
                            ? format(setting.format_specifier, row ?? '')
                            : `:orange_circle: ${this.t.commands({ caller: 'settings', key: 'execute.not_set', guild_id: BigInt(interaction.guildId!) })}`
                        : this.t.commands({
                              caller: 'settings',
                              key: 'execute.view_in_edit_mode',
                              guild_id: BigInt(interaction.guildId!),
                          });
                }
                ui.addFields({
                    name: key,
                    value: value,
                });
            }
            menu.addOptions({
                label: this.t.commands({ key: setting.pretty, guild_id: BigInt(interaction.guildId!) }),
                description: this.t.commands({ key: setting.description, guild_id: BigInt(interaction.guildId!) }),
                value: `settings:${this.name}:${name}`,
            });
        }
        menu.addOptions({
            label: this.t.system({ caller: 'buttons', key: 'back', guild_id: BigInt(interaction.guildId!) }),
            description: this.t.system({
                caller: 'labels',
                key: 'backDescription',
                guild_id: BigInt(interaction.guildId!),
            }),
            value: 'command:settings',
        });

        if (latest_action_from_user[0]) {
            let user: User | undefined;
            let date: string | null;
            if (typeof latest_action_from_user[0] === 'object') {
                const uid = BigInt((latest_action_from_user[0] as Users).uid);
                if (uid == 0n) {
                    user = BotClient.client.users.cache.get(BotClient.client.user!.id);
                    date = moment(latest_action_from_user[1]).format('YYYY/MM/DD HH:mm:ss Z');
                } else {
                    user = BotClient.client.users.cache.get(uid.toString());
                    date = moment(latest_action_from_user[1]).format('YYYY/MM/DD HH:mm:ss Z');
                }
            } else if (typeof latest_action_from_user[0] === 'string') {
                user = BotClient.client.users.cache.get(latest_action_from_user[0]);
                date = moment(latest_action_from_user[1]).format('YYYY/MM/DD HH:mm:ss Z');
            } else {
                user = undefined;
                date = null;
            }
            if (user) {
                ui.addFields({ name: '\u00A0', value: '' });
                ui.setFooter({
                    iconURL: user ? user.displayAvatarURL() : undefined,
                    text: this.t.commands({
                        caller: 'settings',
                        key: 'execute.last_modified_by',
                        replacements: {
                            user: user
                                ? user.tag
                                : this.t.commands({
                                      key: 'execute.unknown_user',
                                      guild_id: BigInt(interaction.guildId!),
                                  }),
                            date: date
                                ? date
                                : this.t.commands({
                                      key: 'execute.unknown_date',
                                      guild_id: BigInt(interaction.guildId!),
                                  }),
                        },
                        guild_id: BigInt(interaction.guildId!),
                    }),
                });
            }
        }

        if (interaction instanceof BaseInteraction) {
            const payload = {
                embeds: [ui],
                components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu).toJSON()],
            };

            if (interaction.isChatInputCommand()) {
                if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
                else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
            } else if (
                interaction.isStringSelectMenu() ||
                interaction.isChannelSelectMenu() ||
                interaction.isUserSelectMenu() ||
                interaction.isButton()
            ) {
                await interaction.update(payload);
            } else if ((interaction.isModalSubmit() && interaction.isFromMessage()) || interaction.isRoleSelectMenu()) {
                if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
                else await interaction.update({ ...payload });
            }
        }
    }

    /**
     * Initializes a new instance of the `CustomizableCommand`.
     * @param {Partial<CustomizableCommand> & { name: string }} options The options to initialize the command with.
     */
    constructor(options: Partial<CustomizableCommand> & { name: string }) {
        super(options);
    }
    // ================================================================ //

    // ============ CUSTOMIZABLE COMMAND UTILITIES SECTION ============ //
    // ================================================================ //
}
