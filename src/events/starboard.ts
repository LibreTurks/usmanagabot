import { BotClient } from '@services/client';
import { BaseEvent } from '@src/types/structure/event';
import { RegisterFact } from '@utils/common';
import { Channel, Events, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import { Starboard } from '@src/types/database/entities/starboard';
import { StarboardSettings } from '@src/types/database/entities/starboard_settings';
import { Messages } from '@src/types/database/entities/messages';

class StarboardReactionAddEvent extends BaseEvent<Events.MessageReactionAdd> {
    constructor() {
        super({ enabled: true, type: Events.MessageReactionAdd, once: false });
    }

    public async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
        try {
            if (user.bot || !user.id) return;

            const message = await reaction.message.fetch();
            if (!message.guild?.id) return;

            const guild = await this.db.getGuild(BigInt(message.guild.id));
            if (!guild) return;

            const settings = await this.db.findOne(StarboardSettings, { where: { from_guild: { id: guild.id } } });
            if (!settings?.is_enabled || !settings?.starboard_channel_id) return;

            if (message.author?.bot && !settings.allow_bot_messages) return;

            const reactionEmoji = reaction.emoji.id ? reaction.emoji.toString() : reaction.emoji.name;
            if (reactionEmoji !== settings.emoji) return;

            if (!settings.allow_self_star && message.author?.id === user.id) return;

            await RegisterFact<User>(user as User, undefined);
            await RegisterFact<Channel>(message.channel as Channel, undefined);

            const reactionCount = reaction.count ?? 1;

            if (reactionCount < settings.threshold) return;

            let starboard = await this.db.findOne(Starboard, {
                where: { message_id: { message_id: BigInt(message.id) } },
            });

            if (!starboard) {
                let msgRecord = await this.db.findOne(Messages, { where: { message_id: BigInt(message.id) } });

                if (!msgRecord) {
                    const userRecord = await RegisterFact<User>(message.author!, undefined);
                    const channelRecord = await RegisterFact<Channel>(message.channel as Channel, undefined);

                    msgRecord = new Messages();
                    msgRecord.message_id = BigInt(message.id);
                    msgRecord.timestamp = new Date(message.createdTimestamp);
                    msgRecord.from_user = userRecord as any;
                    msgRecord.from_channel = channelRecord as any;
                    msgRecord.from_guild = guild;
                    await this.db.save(Messages, msgRecord);
                }

                const userRecord = await RegisterFact<User>(user as User, undefined);
                const channelRecord = await RegisterFact<Channel>(message.channel as Channel, undefined);

                starboard = new Starboard();
                starboard.star_count = reactionCount;
                starboard.message_id = msgRecord;
                starboard.from_user = userRecord as any;
                starboard.from_channel = channelRecord as any;
                starboard.from_guild = guild;
                await this.db.save(Starboard, starboard);
            } else {
                starboard.star_count = reactionCount;
                await this.db.save(Starboard, starboard);
            }

            const starboardChannel = await BotClient.client.guilds
                .fetch(message.guild.id)
                .then((g) => g.channels.fetch(settings.starboard_channel_id!.toString()));

            if (!starboardChannel?.isTextBased()) return;

            const embed: {
                author: { name: string; icon_url: string | undefined };
                description: string;
                color: 0xffac33;
                footer: { text: string };
                image?: { url: string };
            } = {
                author: {
                    name: message.author?.username ?? 'Unknown',
                    icon_url: message.author?.displayAvatarURL(),
                },
                description: message.content || '*No text content*',
                color: 0xffac33 as const,
                footer: { text: `in #${(message.channel as Channel).name}` },
            };

            if (message.attachments.size > 0) {
                embed.image = { url: message.attachments.first()!.url };
            } else if (message.embeds.length > 0) {
                const firstEmbed = message.embeds[0];
                embed.image = firstEmbed.thumbnail
                    ? { url: firstEmbed.thumbnail.url }
                    : firstEmbed.image
                      ? { url: firstEmbed.image.url }
                      : undefined;
            }

            if (starboard.starboard_message_id) {
                try {
                    const existingMessage = await starboardChannel.messages.fetch(
                        starboard.starboard_message_id.toString(),
                    );
                    await existingMessage.edit({
                        content: `**${reactionCount}** ${reactionEmoji}`,
                        embeds: [
                            {
                                ...embed,
                                fields: [{ name: 'Jump', value: `[Original message](${message.url})` }],
                            },
                        ],
                    });
                } catch {
                    starboard.starboard_message_id = null;
                    await this.db.save(Starboard, starboard);
                }
            } else {
                const sentMessage = await starboardChannel.send({
                    content: `**${reactionCount}** ${reactionEmoji}`,
                    embeds: [
                        {
                            ...embed,
                            fields: [{ name: 'Jump', value: `[Original message](${message.url})` }],
                        },
                    ],
                });
                starboard.starboard_message_id = BigInt(sentMessage.id);
                await this.db.save(Starboard, starboard);
            }
        } catch (err) {
            this.log.error(err);
        }
    }
}

class StarboardReactionRemoveEvent extends BaseEvent<Events.MessageReactionRemove> {
    constructor() {
        super({ enabled: true, type: Events.MessageReactionRemove, once: false });
    }

    public async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
        try {
            if (user.bot || !user.id) return;

            const message = await reaction.message.fetch();
            if (!message.guild?.id) return;

            const guild = await this.db.getGuild(BigInt(message.guild.id));
            if (!guild) return;

            const settings = await this.db.findOne(StarboardSettings, { where: { from_guild: { id: guild.id } } });
            if (!settings?.is_enabled || !settings?.starboard_channel_id) return;

            if (message.author?.bot && !settings.allow_bot_messages) return;

            const reactionEmoji = reaction.emoji.id ? reaction.emoji.toString() : reaction.emoji.name;
            if (reactionEmoji !== settings.emoji) return;

            let starboard = await this.db.findOne(Starboard, {
                where: { message_id: { message_id: BigInt(message.id) } },
            });

            if (!starboard) return;

            const reactionCount = reaction.count ?? 0;

            starboard.star_count = reactionCount;
            await this.db.save(Starboard, starboard);

            const starboardChannel = await BotClient.client.guilds
                .fetch(message.guild.id)
                .then((g) => g.channels.fetch(settings.starboard_channel_id!.toString()));

            if (!starboardChannel?.isTextBased()) return;

            if (reactionCount < settings.threshold && settings.remove_below_threshold) {
                if (starboard.starboard_message_id) {
                    try {
                        const existingMessage = await starboardChannel.messages.fetch(
                            starboard.starboard_message_id.toString(),
                        );
                        await existingMessage.delete();
                    } catch {}
                }
                await this.db.remove(Starboard, starboard);
            } else if (starboard.starboard_message_id) {
                try {
                    const existingMessage = await starboardChannel.messages.fetch(
                        starboard.starboard_message_id.toString(),
                    );
                    await existingMessage.edit({
                        content: `**${reactionCount}** ${reactionEmoji}`,
                    });
                } catch {}
            }
        } catch (err) {
            this.log.error(err);
        }
    }
}

export default [StarboardReactionAddEvent, StarboardReactionRemoveEvent];
