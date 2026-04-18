import { BotClient } from '@services/client';
import { Messages } from '@src/types/database/entities/messages';
import { Starboard, StarboardLogs } from '@src/types/database/entities/starboard';
import { ChainEvent } from '@src/types/decorator/chainevent';
import {
    SettingChannelMenuComponent,
    SettingGenericSettingComponent,
    SettingModalComponent,
} from '@src/types/decorator/settingcomponents';
import { CustomizableCommand } from '@src/types/structure/command';
import { RegisterFact } from '@utils/common';
import {
    Channel,
    ChannelSelectMenuInteraction,
    ChannelType,
    Events,
    GuildChannel,
    MessageReaction,
    ModalSubmitInteraction,
    StringSelectMenuInteraction,
    TextInputStyle,
    User,
} from 'discord.js';
import { CommandLoader } from '..';
import { QueryFailedError } from 'typeorm';

/*
 * Starboard system for highlighting popular messages in a dedicated channel based on user reactions.
 *
 * This command allows server administrators to configure the starboard settings, such as enabling/disabling the feature,
 * setting the starboard channel, defining the reaction threshold, customizing the star emoji, and toggling options like allowing self-stars or bot messages.
 */
export default class StarboardCommand extends CustomizableCommand {
    // ============================ HEADER ============================ //
    constructor() {
        super({ name: 'starboard', is_admin_command: true });
        this.base_cmd_data = null;
    }

    public async prepareCommandData(guild_id: bigint): Promise<void> {
        this.log('debug', 'prepare.start', { name: this.name, guild: guild_id });
        const guild = await this.db.getGuild(guild_id);
        const system_user = await this.db.getUser(BigInt(0));
        let settings = await this.db.findOne(Starboard, { where: { from_guild: guild! } });
        if (!settings) {
            const new_settings = new Starboard();
            new_settings.is_enabled = false;
            new_settings.threshold = 3;
            new_settings.allow_self_star = false;
            new_settings.allow_bot_messages = false;
            new_settings.latest_action_from_user = system_user!;
            new_settings.from_guild = guild!;
            settings = await this.db.save(Starboard, new_settings);
            this.log('log', 'prepare.database.success', { name: this.name, guild: guild_id });
        }
        this.enabled = settings.is_enabled;
        this.log('debug', 'prepare.success', { name: this.name, guild: guild_id });
    }
    // ================================================================ //

    // =========================== EXECUTE ============================ //
    @ChainEvent({ type: Events.MessageReactionAdd })
    @ChainEvent({ type: Events.MessageReactionRemove })
    public async execute(reaction: MessageReaction, user: User): Promise<void> {
        const reaction_key = reaction.emoji.id ?? reaction.emoji.name ?? '';
        let reaction_count = reaction.count ?? 0;
        let is_add = reaction_count > 0;
        this.log('debug', 'event.trigger.start', {
            name: 'starboard',
            event: is_add ? 'MessageReactionAdd' : 'MessageReactionRemove',
            guild: reaction.message.guild,
            user: user,
        });
        // Fetch the full message object if it's a partial, as we need details like the author and channel
        const message = await reaction.message.fetch();
        if (!message.guild?.id) return;
        reaction_count = message.reactions.cache.get(reaction_key)?.count ?? 0;

        // Check if starboard is enabled for the guild
        const starboard = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(reaction.message.guild?.id ?? 0) } },
        });
        if (!starboard?.is_enabled || !starboard?.channel_id) return;

        // Ignore reactions from bots or without valid user IDs
        if (user.bot || !user.id) return;
        await RegisterFact<User>(user as User, undefined);
        await RegisterFact<Channel>(message.channel as Channel, undefined);

        // Check if the message author is a bot and if bot messages are allowed on the starboard
        if (message.author?.bot && !starboard.allow_bot_messages) return;

        // Check if the reaction emoji matches the configured starboard emoji
        const reaction_emoji = reaction.emoji.id ? reaction.emoji.toString() : reaction.emoji.name;
        if (reaction_emoji !== starboard.emoji) return;

        // Ignore reactions on messages already in the starboard channel
        if (message.channel.id === starboard.channel_id.toString()) return;

        // Fetch or create the starboard message record in the database
        const guild = await this.db.getGuild(BigInt(message.guild!.id));
        let starboard_msg = await this.db.findOne(StarboardLogs, {
            where: { source_message: { message_id: BigInt(message.id) } },
        });

        is_add = reaction_count > (starboard_msg?.star_count ?? 0);

        // Check if users are allowed to star their own messages and if the reactor is the message author
        if (is_add && !starboard.allow_self_star && message.author?.id === user.id) return;

        // Fetch the starboard channel and check if it's sendable
        const starboard_channel = await BotClient.client.guilds
            .fetch(message.guild!.id)
            .then((g) => g.channels.fetch(starboard.channel_id!.toString()));
        if (!starboard_channel?.isSendable()) return;

        // If no starboard message exists for this source message, create one if we're adding a reaction.
        // If we're removing a reaction and no record exists, there's nothing to update, so we can return early.
        if (!starboard_msg) {
            if (reaction_count < starboard.threshold) return;
            const chan = await RegisterFact<Channel>(message.channel, undefined);
            const author = await RegisterFact<User>(message.author!, undefined);
            let msg = await this.db.findOne(Messages, { where: { message_id: BigInt(message.id) } });
            if (!msg) {
                msg = new Messages();
                msg.timestamp = new Date(message.createdTimestamp);
                msg.message_id = BigInt(message.id);
                msg.from_channel = chan;
                msg.from_user = author;
                msg.from_guild = guild!;
                try {
                    await this.db.save(Messages, msg);
                } catch (e) {
                    if (e instanceof QueryFailedError && (e as any).driverError?.code === '23505') {
                        msg = (await this.db.findOne(Messages, { where: { message_id: BigInt(message.id) } }))!;
                    } else {
                        throw e;
                    }
                }
            }
            starboard_msg = new StarboardLogs();
            starboard_msg.star_count = reaction_count;
            starboard_msg.source_message = msg;
            starboard_msg.from_user = await RegisterFact<User>(message.author!, undefined);
            starboard_msg.from_channel = await RegisterFact<Channel>(message.channel, undefined);
            starboard_msg.from_guild = guild!;
            try {
                await this.db.save(StarboardLogs, starboard_msg);
            } catch (e) {
                if (e instanceof QueryFailedError && (e as any).driverError?.code === '23505') {
                    starboard_msg = (await this.db.findOne(StarboardLogs, {
                        where: { source_message: { message_id: BigInt(message.id) } },
                    }))!;
                    starboard_msg.star_count = reaction_count;
                    await this.db.save(StarboardLogs, starboard_msg);
                } else {
                    throw e;
                }
            }
        } else {
            starboard_msg.star_count = reaction_count;
            await this.db.save(StarboardLogs, starboard_msg);
        }

        // Create embed for the starboard message
        const embed = {
            author: { name: message.author?.username ?? 'Unknown', icon_url: message.author?.displayAvatarURL() },
            description: message.content || '*No text content*',
            color: 0xffac33 as const,
            footer: { text: `in #${(message.channel as GuildChannel).name}` },
            image:
                message.attachments.size > 0
                    ? { url: message.attachments.first()!.url }
                    : message.embeds.length > 0 && (message.embeds[0].thumbnail || message.embeds[0].image)
                      ? { url: (message.embeds[0].thumbnail ?? message.embeds[0].image)!.url }
                      : undefined,
        };

        if (reaction_count < starboard.threshold) {
            if (starboard_msg.starboard_message_id) {
                try {
                    await starboard_channel.messages
                        .fetch(starboard_msg.starboard_message_id.toString())
                        .then((m) => m.delete());
                } catch {
                    // Message already deleted
                }
            }
            await this.db.remove(StarboardLogs, starboard_msg);
        } else if (starboard_msg.starboard_message_id) {
            try {
                const existing = await starboard_channel.messages.fetch(starboard_msg.starboard_message_id.toString());
                await existing.edit({
                    content: `**${reaction_count}** ${reaction_emoji}`,
                    embeds: [{ ...embed, fields: [{ name: 'Jump', value: `[Original message](${message.url})` }] }],
                });
            } catch {
                starboard_msg.starboard_message_id = null;
                await this.db.save(StarboardLogs, starboard_msg);
            }
        } else {
            const sent = await starboard_channel.send({
                content: `**${reaction_count}** ${reaction_emoji}`,
                embeds: [{ ...embed, fields: [{ name: 'Jump', value: `[Original message](${message.url})` }] }],
            });
            starboard_msg.starboard_message_id = BigInt(sent.id);
            await this.db.save(StarboardLogs, starboard_msg);
        }

        this.log('debug', 'event.trigger.success', {
            name: 'starboard',
            event: is_add ? 'MessageReactionAdd' : 'MessageReactionRemove',
            guild: reaction.message.guild,
            user: user,
        });
    }
    // ================================================================ //

    // =========================== SETTINGS =========================== //
    /**
     * Toggles the starboard feature on or off.
     * @param interaction The string select menu interaction.
     */
    @SettingGenericSettingComponent({
        database: Starboard,
        database_key: 'is_enabled',
        format_specifier: '%s',
    })
    public async toggle(interaction: StringSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.toggle.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.is_enabled = !settings!.is_enabled;
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        this.enabled = settings!.is_enabled;
        await this.db.save(Starboard, settings!);
        CommandLoader.RESTCommandLoader(this, interaction.guildId!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggle.success', {
            name: this.name,
            guild: interaction.guild,
            toggle: this.enabled,
        });
    }

    /**
     * Sets the starboard channel where popular messages will be posted.
     * @param interaction The channel select menu interaction.
     */
    @SettingChannelMenuComponent({
        database: Starboard,
        database_key: 'channel_id',
        format_specifier: '<#%s>',
        options: {
            channel_types: [ChannelType.GuildText],
        },
    })
    public async setStarboardChannel(interaction: ChannelSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.channel.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.channel_id = BigInt(interaction.values[0]);
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(Starboard, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.channel.success', {
            name: this.name,
            guild: interaction.guild,
            channel: settings!.channel_id,
        });
    }

    /**
     * Sets the reaction threshold for a message to be posted on the starboard.
     * @param interaction The modal submit interaction.
     */
    @SettingModalComponent({
        database: Starboard,
        database_key: 'threshold',
        format_specifier: '%s',
        inputs: [
            {
                id: 'threshold',
                style: TextInputStyle.Short,
                required: true,
                placeholder: '3',
                min_length: 1,
                max_length: 3,
            },
        ],
    })
    public async setThreshold(interaction: ModalSubmitInteraction): Promise<void> {
        this.log('debug', 'settings.threshold.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const threshold_value = interaction.fields.getTextInputValue('threshold');
        const threshold = parseInt(threshold_value, 10);

        if (isNaN(threshold) || threshold < 1 || threshold > 100) {
            this.warning = this.t.commands({
                key: 'settings.setthreshold.invalid_value',
                guild_id: BigInt(interaction.guildId!),
            });
            await this.settingsUI(interaction);
            return;
        }

        settings!.threshold = threshold;
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(Starboard, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.threshold.success', {
            name: this.name,
            guild: interaction.guild,
            threshold: settings!.threshold,
        });
    }

    /**
     * Sets the emoji used for starring messages on the starboard.
     * @param interaction The modal submit interaction.
     */
    @SettingModalComponent({
        database: Starboard,
        database_key: 'emoji',
        format_specifier: '%s',
        inputs: [
            {
                id: 'emoji',
                style: TextInputStyle.Short,
                required: true,
                placeholder: '⭐',
                max_length: 100,
            },
        ],
    })
    public async setEmoji(interaction: ModalSubmitInteraction): Promise<void> {
        this.log('debug', 'settings.emoji.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const emoji_value = interaction.fields.getTextInputValue('emoji');

        settings!.emoji = emoji_value;
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(Starboard, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.emoji.success', {
            name: this.name,
            guild: interaction.guild,
            emoji: settings!.emoji,
        });
    }

    /**
     * Toggles whether users can star their own messages.
     * @param interaction The string select menu interaction.
     */
    @SettingGenericSettingComponent({
        database: Starboard,
        database_key: 'allow_self_star',
        format_specifier: '%s',
    })
    public async toggleSelfStar(interaction: StringSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.toggleselfstar.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.allow_self_star = !settings!.allow_self_star;
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(Starboard, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggleselfstar.success', {
            name: this.name,
            guild: interaction.guild,
            allow_self_star: settings!.allow_self_star,
        });
    }

    /**
     * Toggles whether messages from bots can be starred on the starboard.
     * @param interaction The string select menu interaction.
     */
    @SettingGenericSettingComponent({
        database: Starboard,
        database_key: 'allow_bot_messages',
        format_specifier: '%s',
    })
    public async toggleAllowBotMessages(interaction: StringSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.toggleallowbot.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(Starboard, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.allow_bot_messages = !settings!.allow_bot_messages;
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(Starboard, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggleallowbot.success', {
            name: this.name,
            guild: interaction.guild,
            allow_bot_messages: settings!.allow_bot_messages,
        });
    }
}
