import { Translator } from '@services/translator';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ColorResolvable,
    EmbedBuilder,
    StringSelectMenuBuilder,
} from 'discord.js';

/**
 * A static utility class for creating and managing paginated embeds in Discord.
 *
 * The `Paginator` handles state management for multi-page messages, allowing users
 * to navigate through content using buttons and select menus.
 */

/**
 * Defines the state for a paginated message, including the current page
 * and the configuration for the items being displayed.
 * @internal
 */
interface pageItem {
    current_page: number;
    config: {
        title: string;
        color: ColorResolvable;
        items: { name: string; pretty_name: string; description?: string; namespace: 'command' | 'settings' }[];
        items_per_page: number;
        select_menu_placeholder?: string;
        enable_select_menu_descriptions?: boolean;
        enable_select_menu?: boolean;
    };
}

/**
 * Defines the configuration for a detailed "view" page, which is shown
 * when a user selects an item from the paginated list.
 * @internal
 */
interface viewItem {
    color: ColorResolvable;
    title: string;
    description: string;
}

/**
 * A static class that provides methods for creating and managing paginated messages.
 *
 * It maintains the state of each user's paginated view in memory and provides
 * methods to navigate between pages (`nextPage`, `previousPage`) and to generate
 * the initial view (`generatePage`).
 */
export class Paginator {
    // ============================ HEADER ============================ //
    /**
     * An in-memory map to store the pagination state for each user and command interaction.
     * The key is a unique string generated from the guild, user, and command name.
     * @private
     * @static
     */
    private static page_states: Map<string, pageItem> = new Map();

    /**
     * Generates a unique key for storing the pagination state.
     * @private
     * @static
     * @param {string} guild_id The ID of the guild.
     * @param {string} user_id The ID of the user.
     * @param {string} command_name The name of the command that initiated the pagination.
     * @returns {string} A unique key for the state map.
     */
    private static getStateKey(guild_id: string, user_id: string, command_name: string): string {
        return `${guild_id}:${user_id}:${command_name}`;
    }

    /**
     * Constructs the Discord message payload (embeds and components) for the current page.
     * @private
     * @static
     * @param {pageItem} pagination_state The current state of the paginated message.
     * @param {string} command_name The name of the associated command.
     * @param {string} [guild_id] The ID of the guild, used for localization.
     * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] }}
     * The message payload to be sent to Discord.
     */
    private static buildPageResponse(
        pagination_state: pageItem,
        command_name: string,
        guild_id?: string,
    ): {
        embeds: EmbedBuilder[];
        components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    } {
        const { current_page, config } = pagination_state;
        const {
            title,
            color,
            items_per_page,
            select_menu_placeholder,
            enable_select_menu_descriptions,
            enable_select_menu,
        } = config;

        const post = new EmbedBuilder();
        const button_row = new ActionRowBuilder<ButtonBuilder>();
        const prev = new ButtonBuilder()
            .setCustomId(`page:${command_name}:prev`)
            .setEmoji('⬅️')
            .setLabel(Paginator.t({ caller: 'buttons', key: 'previous', guild_id: BigInt(guild_id!) }))
            .setStyle(ButtonStyle.Primary);
        const next = new ButtonBuilder()
            .setCustomId(`page:${command_name}:next`)
            .setEmoji('➡️')
            .setLabel(Paginator.t({ caller: 'buttons', key: 'next', guild_id: BigInt(guild_id!) }))
            .setStyle(ButtonStyle.Primary);

        post.setTitle(title).setColor(color);
        let description = '';

        const total_pages = Math.ceil(config.items.length / items_per_page);
        prev.setDisabled(current_page === 1);
        next.setDisabled(current_page >= total_pages);
        button_row.addComponents(prev, next);

        const start_index = (current_page - 1) * items_per_page;
        const end_index = current_page * items_per_page;
        const page_items = config.items
            .sort((a, b) => a.pretty_name.localeCompare(b.pretty_name))
            .slice(start_index, end_index);

        for (const item of page_items) {
            description += `**${item.pretty_name}**${item.description ? `\n${item.description}` : ''}\n\n`;
        }

        post.setDescription(description.trim() || 'No items available.');
        post.setFooter({
            text: Paginator.t({
                caller: 'labels',
                key: 'pageStatus',
                replacements: { current_page, total_pages },
                guild_id: BigInt(guild_id!),
            }),
        });
        const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

        if (config.items.length > items_per_page) {
            rows.push(button_row);
        }

        if (enable_select_menu !== false) {
            const string_select_menu = new StringSelectMenuBuilder()
                .setCustomId(`command:${command_name}:pageitem`)
                .setPlaceholder(
                    select_menu_placeholder ||
                        Paginator.t({ caller: 'placeholders', key: 'selectItemFromList', guild_id: BigInt(guild_id!) }),
                );

            for (const item of page_items) {
                string_select_menu.addOptions({
                    label: item.pretty_name,
                    description: enable_select_menu_descriptions
                        ? item.description?.substring(0, 97) + (item.description?.length >= 100 ? '...' : '')
                        : undefined,
                    value:
                        item.namespace === 'settings'
                            ? `settings:${item.name}`
                            : `command:${command_name}:pageitem:${item.name}`,
                });
            }

            rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(string_select_menu));
        }

        return {
            embeds: [post],
            components: rows,
        };
    }

    /**
     * Creates or updates the state for a paginated message and returns the initial page view.
     * @public
     * @static
     * @param {string} guild_id The ID of the guild.
     * @param {string} user_id The ID of the user.
     * @param {string} command_name The name of the command initiating the pagination.
     * @param {pageItem['config']} o The configuration for the paginated content.
     * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] }>} The message payload for the first page.
     */
    public static async generatePage(
        guild_id: string,
        user_id: string,
        command_name: string,
        o: pageItem['config'],
    ): Promise<{
        embeds: EmbedBuilder[];
        components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    }> {
        const items_per_page = o.items_per_page ?? 5;
        const state_key = Paginator.getStateKey(guild_id, user_id, command_name);

        let pagination_state = Paginator.page_states.get(state_key);
        if (!pagination_state) {
            pagination_state = {
                current_page: 1,
                config: {
                    title: o.title,
                    color: o.color,
                    items: o.items,
                    items_per_page,
                    select_menu_placeholder: o.select_menu_placeholder,
                    enable_select_menu_descriptions: o.enable_select_menu_descriptions ?? true,
                    enable_select_menu: o.enable_select_menu,
                },
            };
            Paginator.page_states.set(state_key, pagination_state);
        } else {
            pagination_state.config = {
                title: o.title,
                color: o.color,
                items: o.items,
                items_per_page,
                select_menu_placeholder: o.select_menu_placeholder,
                enable_select_menu_descriptions: o.enable_select_menu_descriptions ?? true,
                enable_select_menu: o.enable_select_menu,
            };
        }

        return Paginator.buildPageResponse(pagination_state, command_name, guild_id);
    }

    public static async viewPage(
        guild_id: string,
        user_id: string,
        command_name: string,
        o: viewItem,
    ): Promise<{
        embeds: EmbedBuilder[];
        components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    }> {
        const { title, color, description } = o;
        const post = new EmbedBuilder();
        post.setTitle(title).setColor(color);
        post.setDescription(description.replaceAll(/^[ ]{16}/gm, '').trim());
        const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`page:${command_name}:back`)
                .setEmoji('⬅️')
                .setLabel(Paginator.t({ caller: 'buttons', key: 'back', guild_id: BigInt(guild_id!) }))
                .setStyle(ButtonStyle.Secondary),
        );
        return {
            embeds: [post],
            components: [back],
        };
    }

    /**
     * Moves to the previous page and returns the updated message payload.
     * @public
     * @static
     * @param {string} guild_id The ID of the guild.
     * @param {string} user_id The ID of the user.
     * @param {string} command_name The name of the command.
     * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] }>} The message payload for the previous page.
     */
    public static async previousPage(
        guild_id: string,
        user_id: string,
        command_name: string,
    ): Promise<{
        embeds: EmbedBuilder[];
        components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    }> {
        const state_key = Paginator.getStateKey(guild_id, user_id, command_name);
        const pagination_state = Paginator.page_states.get(state_key);
        if (!pagination_state) return { embeds: [], components: [] };
        if (pagination_state.current_page > 1) {
            pagination_state.current_page--;
        }
        return Paginator.buildPageResponse(pagination_state, command_name, guild_id);
    }

    /**
     * Moves to the next page and returns the updated message payload.
     * @public
     * @static
     * @param {string} guild_id The ID of the guild.
     * @param {string} user_id The ID of the user.
     * @param {string} command_name The name of the command.
     * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] }>} The message payload for the next page.
     */
    public static async nextPage(
        guild_id: string,
        user_id: string,
        command_name: string,
    ): Promise<{
        embeds: EmbedBuilder[];
        components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    }> {
        const state_key = Paginator.getStateKey(guild_id, user_id, command_name);
        const pagination_state = Paginator.page_states.get(state_key);
        if (!pagination_state) return { embeds: [], components: [] };
        const total_pages = Math.ceil(pagination_state.config.items.length / pagination_state.config.items_per_page);
        if (pagination_state.current_page < total_pages) {
            pagination_state.current_page++;
        }
        return Paginator.buildPageResponse(pagination_state, command_name, guild_id);
    }

    /**
     * Returns to the main paginated view from a detailed view.
     * @public
     * @static
     * @param {string} guild_id The ID of the guild.
     * @param {string} user_id The ID of the user.
     * @param {string} command_name The name of the command.
     * @returns {Promise<{ embeds: EmbedBuilder[], components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] }>} The message payload for the main list view.
     */
    public static async backPage(
        guild_id: string,
        user_id: string,
        command_name: string,
    ): Promise<{
        embeds: EmbedBuilder[];
        components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
    }> {
        const state_key = Paginator.getStateKey(guild_id, user_id, command_name);
        const pagination_state = Paginator.page_states.get(state_key);
        if (!pagination_state) return { embeds: [], components: [] };
        return Paginator.buildPageResponse(pagination_state, command_name, guild_id);
    }

    /**
     * The translation function for localizing paginator text.
     * @private
     * @static
     * @type {(options: { key: string; replacements?: { [key: string]: unknown }; guild_id?: bigint }) => string}
     */
    private static t = Translator.generateQueryFunc({ caller: 'paginator' }).system;
}
