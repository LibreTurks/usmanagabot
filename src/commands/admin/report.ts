import { MessageLogger } from '@src/types/database/entities/message_logger';
import { Messages } from '@src/types/database/entities/messages';
import { Reports } from '@src/types/database/entities/reports';
import {
    SettingChannelMenuComponent,
    SettingGenericSettingComponent,
    SettingRoleSelectMenuComponent,
} from '@src/types/decorator/settingcomponents';
import { CustomizableCommand } from '@src/types/structure/command';
import {
    ChannelSelectMenuInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    Colors,
    EmbedBuilder,
    MessageFlags,
    RoleSelectMenuInteraction,
    SlashCommandBuilder,
    StringSelectMenuInteraction,
    TextChannel,
} from 'discord.js';
import { CommandLoader } from '..';

/**
 * A command for users to report other users to the server administration.
 *
 * This command allows any user to file a report against another user, providing a reason and
 * optional links to specific messages as evidence. The report is then sent to a pre-configured
 * private channel where administrators can review it.
 *
 * The command is highly configurable per-guild, allowing settings for:
 * - A target channel for reports.
 * - A specific role to be pinged for new reports.
 * - Enabling or disabling the report system entirely.
 */
export default class ReportCommand extends CustomizableCommand {
    // ============================ HEADER ============================ //
    constructor() {
        super({ name: 'report', cooldown: 10 });

        (this.base_cmd_data as SlashCommandBuilder)
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription(this.t.commands({ key: 'parameters.user.description' }))
                    .setNameLocalizations(this.getLocalizations('parameters.user.name'))
                    .setDescriptionLocalizations(this.getLocalizations('parameters.user.description'))
                    .setRequired(true),
            )
            .addStringOption((option) =>
                option
                    .setName('reason')
                    .setDescription(this.t.commands({ key: 'parameters.reason.description' }))
                    .setNameLocalizations(this.getLocalizations('parameters.reason.name'))
                    .setDescriptionLocalizations(this.getLocalizations('parameters.reason.description'))
                    .setRequired(true),
            )
            .addStringOption((option) =>
                option
                    .setName('message_url')
                    .setDescription(this.t.commands({ key: 'parameters.message_urls.description' }))
                    .setNameLocalizations(this.getLocalizations('parameters.message_urls.name'))
                    .setDescriptionLocalizations(this.getLocalizations('parameters.message_urls.description'))
                    .setRequired(false),
            );
    }

    public async prepareCommandData(guild_id: bigint): Promise<void> {
        this.log('debug', 'prepare.start', { name: this.name, guild: guild_id });
        const guild = await this.db.getGuild(guild_id);
        const system_user = await this.db.getUser(BigInt(0));
        let report = await this.db.findOne(Reports, { where: { from_guild: guild! } });
        if (!report) {
            const new_settings = new Reports();
            new_settings.is_enabled = false;
            new_settings.latest_action_from_user = system_user!;
            new_settings.from_guild = guild!;
            report = await this.db.save(new_settings);
            this.log('log', 'prepare.database.success', { name: this.name, guild: guild_id });
        }
        this.enabled = report.is_enabled;
        this.log('debug', 'prepare.success', { name: this.name, guild: guild_id });
    }
    // ================================================================ //

    // =========================== EXECUTE ============================ //
    /**
     * Executes the report submission process.
     *
     * This method validates user input, checks if the report system is configured,
     * gathers details about the reporter and the reported user, and formats an
     * embed. It then sends this embed to the designated report channel, pinging
     * the moderator role if configured. Finally, it sends an ephemeral confirmation
     * message back to the user who filed the report.
     *
     * @param interaction The `ChatInputCommandInteraction` from the user.
     */
    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const user_post = new EmbedBuilder();
        const admin_post = new EmbedBuilder();
        const report = await this.db.findOne(Reports, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const msg_logger = await this.db.findOne(MessageLogger, {
            where: {
                is_enabled: true,
                from_guild: { gid: BigInt(interaction.guildId!) },
            },
        });
        const user = interaction.options.getUser('user')!;
        const reporter = interaction.user;
        const reason = interaction.options.getString('reason');
        const pattern = /^(https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+)$/;
        const message_url = interaction.options.getString('message_url');
        const message_channel_id = interaction.guild!.channels.cache.get(report!.channel_id);
        const message_in_database = await this.db.findOne(Messages, {
            where: {
                from_user: { uid: BigInt(user.id) },
                from_guild: { gid: BigInt(interaction.guildId!) },
                message_is_deleted: false,
            },
            order: { id: 'DESC' },
        });

        if (!report?.channel_id) {
            user_post
                .setTitle(
                    `:warning: ${this.t.system({ caller: 'messages', key: 'warning', guild_id: BigInt(interaction.guildId!) })}`,
                )
                .setDescription(
                    this.t.commands({ key: 'execute.command_not_configured', guild_id: BigInt(interaction.guildId!) }),
                )
                .setColor(Colors.Red);
            await interaction.reply({ embeds: [user_post], flags: MessageFlags.Ephemeral });
            this.log('warn', 'configuration.missing', { name: this.name, guild: interaction.guild?.id });
            return;
        }

        let message_urls: { real: string; in_database: string }[] = [];
        if (message_url) {
            const list = message_url.split(' ').map((u) => u.trim());
            if (list.length > 5) {
                user_post
                    .setTitle(
                        `:warning: ${this.t.system({ caller: 'messages', key: 'warning', guild_id: BigInt(interaction.guildId!) })}`,
                    )
                    .setDescription(
                        this.t.commands({
                            key: 'execute.too_many_urls',
                            replacements: { count: list.length },
                            guild_id: BigInt(interaction.guildId!),
                        }),
                    )
                    .setColor(Colors.Red);
                await interaction.reply({ embeds: [user_post], flags: MessageFlags.Ephemeral });
                this.log('warn', 'execute.too_many_urls', {
                    guild: interaction.guild,
                    user: interaction.user,
                    count: list.length,
                });
                return;
            }
            for (const url of list) {
                if (!pattern.test(url)) {
                    user_post
                        .setTitle(
                            `:warning: ${this.t.system({ caller: 'messages', key: 'warning', guild_id: BigInt(interaction.guildId!) })}`,
                        )
                        .setDescription(
                            this.t.commands({
                                key: 'execute.invalid_url',
                                replacements: { url },
                                guild_id: BigInt(interaction.guildId!),
                            }),
                        )
                        .setColor(Colors.Red);
                    await interaction.reply({ embeds: [user_post], flags: MessageFlags.Ephemeral });
                    this.log('warn', 'execute.invalid_url', {
                        guild: interaction.guild,
                        user: interaction.user,
                        url,
                    });
                    return;
                }
                const message_id = url.split('/').pop()!;
                const message_in_db = await this.db.findOne(Messages, {
                    where: {
                        from_user: { uid: BigInt(user.id) },
                        from_guild: { gid: BigInt(interaction.guildId!) },
                        message_id: BigInt(message_id),
                        message_is_deleted: false,
                    },
                });
                message_urls.push({
                    real: url,
                    in_database:
                        msg_logger && message_in_db
                            ? `https://discord.com/channels/${message_in_db.from_guild.gid}/${msg_logger!.channel_id}/${message_in_db.logged_message_id}`
                            : '`-`',
                });
            }
        } else {
            if (!message_in_database) {
                user_post
                    .setTitle(
                        `:warning: ${this.t.system({ caller: 'messages', key: 'warning', guild_id: BigInt(interaction.guildId!) })}`,
                    )
                    .setDescription(
                        this.t.commands({ key: 'execute.message_not_found', guild_id: BigInt(interaction.guildId!) }),
                    )
                    .setColor(Colors.Red);
                await interaction.reply({
                    embeds: [user_post],
                    flags: MessageFlags.Ephemeral,
                });
                this.log('warn', 'execute.message_not_found', {
                    guild: interaction.guild,
                    user: interaction.user,
                });
                return;
            }

            message_urls = [
                {
                    real: `https://discord.com/channels/${message_in_database.from_guild.gid}/${message_in_database.from_channel.cid}/${message_in_database.message_id}`,
                    in_database: msg_logger
                        ? `https://discord.com/channels/${message_in_database.from_guild.gid}/${msg_logger!.channel_id}/${message_in_database.logged_message_id}`
                        : '`-`',
                },
            ];
        }
        admin_post
            .setColor(0xee82ee)
            .setAuthor({ name: `${reporter.username} (${reporter.id})`, iconURL: reporter.displayAvatarURL() })
            .setThumbnail(user.displayAvatarURL())
            .setTimestamp()
            .setDescription(
                this.t.commands({
                    key: 'execute.admin_report_description',
                    replacements: {
                        username: user.username,
                        user_id: user.id,
                        reason,
                        message_urls: message_urls.map((mu) => mu.real).join(', '),
                        in_database_urls: msg_logger
                            ? message_urls.map((mu) => mu.in_database).join(', ')
                            : this.t.commands({
                                key: 'execute.message_logger_disabled',
                                guild_id: BigInt(interaction.guildId!),
                            }),
                        channel_id: interaction.channel!.id,
                    },
                    guild_id: BigInt(interaction.guildId!),
                }),
            );
        (message_channel_id as TextChannel).send({
            content: report.moderator_role_id ? `<@&${report.moderator_role_id}>` : undefined,
            embeds: [admin_post],
        });

        user_post
            .setTitle(
                `:white_check_mark: ${this.t.system({ caller: 'messages', key: 'success', guild_id: BigInt(interaction.guildId!) })}`,
            )
            .setColor(Colors.Green)
            .setDescription(
                this.t.commands({
                    key: 'execute.user_reported_description',
                    replacements: {
                        user: user.username,
                        reason,
                    },
                    guild_id: BigInt(interaction.guildId!),
                }),
            );
        await interaction.reply({ embeds: [user_post], flags: MessageFlags.Ephemeral });
    }
    // ================================================================ //

    // =========================== SETTINGS =========================== //
    /**
     * Toggles the report system on or off for the guild.
     *
     * @param interaction The interaction from the settings UI.
     */
    @SettingGenericSettingComponent({
        database: Reports,
        database_key: 'is_enabled',
        format_specifier: '%s',
    })
    public async toggle(interaction: StringSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.toggle.start', { name: this.name, guild: interaction.guild });
        const report = await this.db.findOne(Reports, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;
        report!.is_enabled = !report!.is_enabled;
        report!.latest_action_from_user = user;
        report!.timestamp = new Date();
        this.enabled = report!.is_enabled;
        await this.db.save(Reports, report!);
        CommandLoader.RESTCommandLoader(this, interaction.guildId!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggle.success', {
            name: this.name,
            guild: interaction.guild,
            toggle: this.enabled,
        });
    }

    /**
     * Sets the channel where reports will be sent.
     *
     * @param interaction The interaction from the settings UI.
     */
    @SettingChannelMenuComponent({
        database: Reports,
        database_key: 'channel_id',
        format_specifier: '<#%s>',
        options: {
            channel_types: [ChannelType.GuildText],
        },
    })
    public async changeTargetChannel(interaction: ChannelSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.channel.start', { name: this.name, guild: interaction.guild });
        const report = await this.db.findOne(Reports, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const selected_channel = interaction.values[0];
        report!.channel_id = selected_channel;
        report!.latest_action_from_user = user;
        report!.timestamp = new Date();
        await this.db.save(Reports, report!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.channel.success', {
            name: this.name,
            guild: interaction.guild,
            channel: selected_channel,
        });
    }

    /**
     * Sets the moderator role to be pinged when a new report is submitted.
     *
     * @param interaction The interaction from the settings UI.
     */
    @SettingRoleSelectMenuComponent({
        database: Reports,
        database_key: 'moderator_role_id',
        format_specifier: '<@&%s>',
        options: {
            min_values: 0,
            max_values: 1,
        },
    })
    public async changeModeratorRole(interaction: RoleSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.role.start', { name: this.name, guild: interaction.guild });
        const report = await this.db.findOne(Reports, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        report!.moderator_role_id = interaction.values[0];
        report!.latest_action_from_user = user;
        report!.timestamp = new Date();
        await this.db.save(Reports, report!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.role.success', {
            name: this.name,
            guild: interaction.guild,
            role: interaction.values[0],
        });
    }

    /**
     * Removes the configured moderator role, so no role is pinged on new reports.
     *
     * @param interaction The interaction from the settings UI.
     */
    @SettingGenericSettingComponent({ view_in_ui: false })
    public async removeModeratorRole(interaction: StringSelectMenuInteraction): Promise<void> {
        this.log('debug', 'removemoderatorrole.start', { guild: interaction.guild });
        const report = await this.db.findOne(Reports, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        report!.moderator_role_id = null;
        report!.latest_action_from_user = user;
        report!.timestamp = new Date();
        await this.db.save(Reports, report!);
        await this.settingsUI(interaction);
        this.log('debug', 'removemoderatorrole.success', { guild: interaction.guild });
    }
    // ================================================================ //
}
