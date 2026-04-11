import {
    ActionRowBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    ModalActionRowComponentBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} from 'discord.js';
import { EntityTarget, ObjectLiteral } from 'typeorm';
import { Database } from '../../services/database';
import { BaseCommand, CustomizableCommand } from '../structure/command';
import { Translator } from '../../services/translator';

/**
 * This module provides a collection of method decorators for creating dynamic,
 * interactive settings components for `CustomizableCommand` classes.
 *
 * These decorators simplify the process of building select menus and modals for command settings
 * by handling the UI generation and interaction flow, allowing the developer to focus on the
 * logic of saving the settings.
 *
 * @see CustomizableCommand
 */

/**
 * Base options for all setting component decorators.
 * @internal
 */
type componentOptions = {
    display_name: string;
    pretty: string;
    description: string;
    format_specifier: string;
    database: EntityTarget<ObjectLiteral>;
    database_key: string;
    db_column_is_array?: boolean;
    is_bot_owner_only: boolean;
    view_in_ui: boolean;
};

/**
 * The expected method signature for a decorated setting method.
 * @internal
 */
type descriptorType = (
    this: BaseCommand | CustomizableCommand,
    interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
    ...args: unknown[]
) => Promise<void>;

/**
 * The translation function scoped to the 'commands' namespace.
 * @private
 * @static
 * @type {(options: { key: string; replacements?: { [key: string]: unknown }; guild_id?: bigint }) => string}
 */
const t = Translator.generateQueryFunc({ caller: '' });

/**
 * A factory function that generates the core logic for a setting component decorator.
 *
 * It handles metadata registration using `Reflect.defineMetadata` and wraps the original
 * decorated method with UI-generating logic.
 *
 * @internal
 * @param {Partial<componentOptions>} o The options for the setting component.
 * @param {function} [wrapper] An optional function that wraps the original method, adding UI logic.
 * @returns {MethodDecorator} A method decorator.
 */
function generateSettingComponent(
    o: Partial<componentOptions>,
    wrapper?: (
        orig: descriptorType,
        context: {
            name: string;
            pretty_key: string;
            options: object;
        },
    ) => descriptorType,
): MethodDecorator {
    return (target, key, descriptor: PropertyDescriptor) => {
        const name = new (target.constructor as new () => BaseCommand)().name;
        const pretty_key = key.toString().toLowerCase();
        const metadata: Map<string, Omit<typeof o, 'options'> & { func: typeof descriptor }> =
            Reflect.getMetadata('custom:settings', target.constructor) ?? new Map();

        if (wrapper) {
            const orig = descriptor.value;
            descriptor.value = wrapper(orig, { name, pretty_key, options: o });
        }

        metadata.set(pretty_key, {
            pretty: `settings.${pretty_key}.pretty_name`,
            database: o.database,
            database_key: o.database_key,
            display_name: `settings.${pretty_key}.display_name`,
            description: `settings.${pretty_key}.description`,
            format_specifier: o.format_specifier ?? 'command.settings.view_in_edit_mode',
            db_column_is_array: o.db_column_is_array ?? false,
            is_bot_owner_only: o.is_bot_owner_only ?? false,
            view_in_ui: o.view_in_ui ?? true,
            func: descriptor,
        });

        Reflect.defineMetadata('custom:settings', metadata, target.constructor);
    };
}

/**
 * A generic setting decorator that registers a method as a setting without adding
 * any special UI logic. The decorated method is expected to handle its own interaction response.
 *
 * @param {Partial<componentOptions>} o The options for the setting.
 */
export function SettingGenericSettingComponent(o: Partial<componentOptions>): MethodDecorator {
    return generateSettingComponent(o);
}

/**
 * A decorator that transforms a setting method into a `StringSelectMenu` interaction.
 *
 * When the user first selects this setting, the decorator presents a string select menu.
 * When the user makes a selection from that menu, the decorated method is executed with the chosen value.
 *
 * @param {object} o The options for the string select menu.
 */
export function SettingStringSelectComponent(
    o: Partial<Omit<componentOptions, 'description' | 'display_name' | 'pretty'>> & {
        options?: {
            min_values?: number;
            max_values?: number;
            values: { label: string; description?: string }[];
        };
    },
): MethodDecorator {
    return generateSettingComponent(o, (orig, { name, pretty_key, options }) => {
        return async function(this, interaction, ...args: unknown[]) {
            if (interaction.isStringSelectMenu() && args.length > 0) {
                return await orig.apply(this, [interaction, ...args]);
            } else if (interaction.isStringSelectMenu()) {
                await interaction.update({
                    components: [
                        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(`settings:${name}:${pretty_key}`)
                                .setPlaceholder(
                                    t.commands({
                                        caller: name,
                                        key: `settings.${pretty_key}.placeholder`,
                                        guild_id: BigInt(interaction.guildId!),
                                    }),
                                )
                                .setMinValues((options as typeof o).options?.min_values ?? 1)
                                .setMaxValues((options as typeof o).options?.max_values ?? 1)
                                .addOptions(
                                    (options as typeof o).options?.values.map((val) => ({
                                        label: val.label,
                                        description: val.description,
                                        value: `settings:${name}:${pretty_key}:${val.label}`,
                                    })) ?? [],
                                ),
                        ),
                    ],
                });
            }
        };
    });
}

/**
 * A decorator that transforms a setting method into a `ChannelSelectMenu` interaction.
 *
 * When the user first selects this setting, the decorator presents a channel select menu.
 * When the user selects a channel, the decorated method is executed.
 *
 * @param {object} o The options for the channel select menu.
 */
export function SettingChannelMenuComponent(
    o: Partial<Omit<componentOptions, 'description' | 'display_name' | 'pretty'>> & {
        options?: {
            channel_types?: ChannelType[];
            min_values?: number;
            max_values?: number;
            placeholder?: string;
        };
    },
): MethodDecorator {
    return generateSettingComponent(o, (orig, { name, pretty_key, options }) => {
        return async function(this, interaction, ...args: unknown[]) {
            if (interaction.isChannelSelectMenu()) {
                return await orig.apply(this, [interaction, ...args]);
            }

            if (!interaction.isStringSelectMenu()) return;
            await interaction.update({
                components: [
                    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
                        new ChannelSelectMenuBuilder()
                            .setCustomId(`settings:${name}:${pretty_key}`)
                            .setPlaceholder(
                                t.commands({
                                    caller: name,
                                    key:
                                        (options as typeof o).options?.placeholder ??
                                        `settings.${pretty_key}.placeholder`,
                                    guild_id: BigInt(interaction.guildId!),
                                }),
                            )
                            .setMinValues((options as typeof o).options?.min_values ?? 1)
                            .setMaxValues((options as typeof o).options?.max_values ?? 1)
                            .addChannelTypes((options as typeof o).options?.channel_types ?? []),
                    ),
                ],
            });
        };
    });
}

/**
 * A decorator that transforms a setting method into a `RoleSelectMenu` interaction.
 *
 * When the user first selects this setting, the decorator presents a role select menu.
 * When the user selects a role, the decorated method is executed.
 *
 * @param {object} o The options for the role select menu.
 */
export function SettingRoleSelectMenuComponent(
    o: Partial<Omit<componentOptions, 'description' | 'display_name' | 'pretty'>> & {
        options?: {
            min_values?: number;
            max_values?: number;
            placeholder?: string;
        };
    },
): MethodDecorator {
    return generateSettingComponent(o, (orig, { name, pretty_key, options }) => {
        return async function(this, interaction, ...args: unknown[]) {
            if (interaction.isRoleSelectMenu()) {
                return await orig.apply(this, [interaction, ...args]);
            }

            if (!interaction.isStringSelectMenu()) return;
            await interaction.update({
                components: [
                    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId(`settings:${name}:${pretty_key}`)
                            .setPlaceholder(
                                t.commands({
                                    caller: name,
                                    key:
                                        (options as typeof o).options?.placeholder ??
                                        `settings.${pretty_key}.placeholder`,
                                    guild_id: BigInt(interaction.guildId!),
                                }),
                            )
                            .setMinValues((options as typeof o).options?.min_values ?? 1)
                            .setMaxValues((options as typeof o).options?.max_values ?? 1),
                    ),
                ],
            });
        };
    });
}

/**
 * A decorator that transforms a setting method into a `UserSelectMenu` interaction.
 *
 * When the user first selects this setting, the decorator presents a user select menu.
 * When the user selects a user, the decorated method is executed.
 *
 * @param {object} o The options for the user select menu.
 */
export function SettingUserSelectMenuComponent(
    o: Partial<Omit<componentOptions, 'description' | 'display_name' | 'pretty'>> & {
        options?: {
            min_values?: number;
            max_values?: number;
            placeholder?: string;
        };
    },
): MethodDecorator {
    return generateSettingComponent(o, (orig, { name, pretty_key, options }) => {
        return async function(this, interaction, ...args: unknown[]) {
            if (interaction.isUserSelectMenu()) {
                return await orig.apply(this, [interaction, ...args]);
            }

            if (!interaction.isStringSelectMenu()) return;
            await interaction.update({
                components: [
                    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
                        new UserSelectMenuBuilder()
                            .setCustomId(`settings:${name}:${pretty_key}`)
                            .setPlaceholder(
                                t.commands({
                                    caller: name,
                                    key:
                                        (options as typeof o).options?.placeholder ??
                                        `settings.${pretty_key}.placeholder`,
                                    guild_id: BigInt(interaction.guildId!),
                                }),
                            )
                            .setMinValues((options as typeof o).options?.min_values ?? 1)
                            .setMaxValues((options as typeof o).options?.max_values ?? 1),
                    ),
                ],
            });
        };
    });
}

/**
 * A decorator that transforms a setting method into a `Modal` interaction.
 *
 * This is the most complex component decorator and has two modes:
 * 1.  **Direct Modal**: If `require_selectmenu` is false, it immediately shows a modal with predefined text inputs.
 *     The decorated method is executed when the modal is submitted.
 * 2.  **Select Menu -> Modal**: If `require_selectmenu` is true, it first shows a select menu populated from the
 *     database. When the user selects an item, it then shows a modal with fields pre-filled with data
 *     from the selected item.
 *
 * @param {object} o The options for the modal component.
 */
export function SettingModalComponent(
    o: Partial<Omit<componentOptions, 'description' | 'display_name' | 'pretty'>> & {
        require_selectmenu?: boolean;
        select_menu?: {
            enable: boolean;
            label_key: string;
            description_key: string;
            include_cancel?: boolean;
        };
        inputs: ({
            id: string;
            style?: TextInputStyle;
            required?: boolean;
            placeholder?: string;
            min_length?: number;
            max_length?: number;
        } & Partial<Pick<componentOptions, 'database' | 'database_key' | 'db_column_is_array'>>)[];
    },
): MethodDecorator {
    return generateSettingComponent(o, (orig, { name, pretty_key, options }) => {
        return async function(this, interaction, ...args: unknown[]) {
            if (interaction.isModalSubmit()) {
                if ((options as typeof o).require_selectmenu) {
                    const custom_id_parts = interaction.customId.split(':');
                    const selected_value = custom_id_parts[custom_id_parts.length - 1];
                    return await orig.apply(this, [interaction, selected_value, ...args]);
                }
                return await orig.apply(this, [interaction, ...args]);
            }
            const inputs = (options as typeof o).inputs || [];
            if (inputs.length < 1 || inputs.length > 5) {
                throw new Error(`SettingModalComponent: inputs array must contain 1-5 items, got ${inputs.length}`);
            }

            const enable_select_menu = (options as typeof o).select_menu?.enable;
            const config = (options as typeof o).select_menu;

            const fetchItems = () =>
                Database.dbManager.find(o.database!, {
                    where: o.is_bot_owner_only ? { id: 1 } : { from_guild: { gid: BigInt(interaction.guildId!) } },
                });

            const buildTextInput = (input: (typeof o.inputs)[number], value?: string) => {
                const ti = new TextInputBuilder()
                    .setCustomId(input.id)
                    .setLabel(
                        t.commands({
                            caller: name,
                            key: `settings.${pretty_key}.parameters.${input.id}.name`,
                            guild_id: BigInt(interaction.guildId!),
                        }),
                    )
                    .setPlaceholder(
                        t.commands({
                            caller: name,
                            key: `settings.${pretty_key}.parameters.${input.id}.placeholder`,
                            guild_id: BigInt(interaction.guildId!),
                        }),
                    )
                    .setStyle(input.style ?? TextInputStyle.Short)
                    .setRequired(input.required ?? true);

                if (value !== undefined) ti.setValue(String(value));
                if (input.min_length !== undefined) ti.setMinLength(input.min_length);
                if (input.max_length !== undefined) ti.setMaxLength(input.max_length);

                return new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(ti);
            };

            if (enable_select_menu) {
                if (interaction.isStringSelectMenu() && interaction.customId === `settings:${name}`) {
                    const items = await fetchItems();

                    const select_options = items.map((item) => ({
                        label: String(item[config!.label_key]),
                        description: config!.description_key ? String(item[config!.description_key]) : undefined,
                        value: `settings:${name}:${pretty_key}:${String(item[config!.label_key])}`,
                    }));

                    if (config!.include_cancel !== false) {
                        select_options.push({
                            label: t.system({ caller: 'buttons', key: 'back', guild_id: BigInt(interaction.guildId!) }),
                            description: t.system({
                                caller: 'labels',
                                key: 'backDescription',
                                guild_id: BigInt(interaction.guildId!),
                            }),
                            value: `settings:${name}`,
                        });
                    }

                    await interaction.update({
                        components: [
                            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId(`settings:${name}:${pretty_key}`)
                                    .setPlaceholder(
                                        t.commands({
                                            caller: name,
                                            key: `settings.${pretty_key}.placeholder`,
                                            guild_id: BigInt(interaction.guildId!),
                                        }),
                                    )
                                    .addOptions(select_options),
                            ),
                        ],
                    });
                    return;
                }

                if (
                    interaction.isStringSelectMenu() &&
                    interaction.customId.startsWith(`settings:${name}:${pretty_key}`)
                ) {
                    const selected_value = interaction.values[0].split(':').pop()!;
                    const items = await fetchItems();
                    const selected_item = items.find((x) => String(x[config!.label_key]) === selected_value);

                    const components = inputs.map((input) =>
                        buildTextInput(input, input.database_key ? selected_item?.[input.database_key] : undefined),
                    );

                    await interaction.showModal(
                        new ModalBuilder()
                            .setCustomId(`settings:${name}:${pretty_key}:${selected_value}`)
                            .setTitle(
                                t.commands({
                                    caller: name,
                                    key: `settings.${pretty_key}.title`,
                                    replacements: { name: selected_value },
                                    guild_id: BigInt(interaction.guildId!),
                                }),
                            )
                            .addComponents(components),
                    );
                    return;
                }
            }

            const components = [];
            for (const input of inputs) {
                let value;

                if (o.database || input.database) {
                    const db = input.database ?? o.database!;
                    const key = input.database_key ?? o.database_key!;

                    if (o.db_column_is_array || input.db_column_is_array) {
                        const items = await Database.dbManager.find(db, {
                            where: o.is_bot_owner_only ? { id: 1 } : { from_guild: { gid: interaction.guild?.id } },
                        });

                        value = items.map((e) => e[key]).join(', ');
                    } else {
                        const item = await Database.dbManager.findOne(db, {
                            where: o.is_bot_owner_only ? { id: 1 } : { from_guild: { gid: interaction.guild?.id } },
                        });

                        value = item?.[key] ?? input.placeholder ?? '';
                    }
                }

                components.push(buildTextInput(input, value));
            }

            await interaction.showModal(
                new ModalBuilder()
                    .setCustomId(`settings:${name}:${pretty_key}`)
                    .setTitle(
                        t.commands({
                            caller: name,
                            key: `settings.${pretty_key}.pretty_name`,
                            guild_id: BigInt(interaction.guildId!),
                        }),
                    )
                    .addComponents(components),
            );
        };
    });
}
