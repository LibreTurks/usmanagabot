import { BotClient } from '@services/client';
import { Guilds } from '@src/types/database/entities/guilds';
import { Verification, VerificationSystem } from '@src/types/database/entities/verification';
import { ChainEvent } from '@src/types/decorator/chainevent';
import { Cron } from '@src/types/decorator/cronjob';
import {
    SettingChannelMenuComponent,
    SettingGenericSettingComponent,
    SettingModalComponent,
    SettingRoleSelectMenuComponent,
} from '@src/types/decorator/settingcomponents';
import { CustomizableCommand } from '@src/types/structure/command';
import {
    ChannelSelectMenuInteraction,
    ChannelType,
    Events,
    GuildMember,
    ModalSubmitInteraction,
    RoleSelectMenuInteraction,
    StringSelectMenuInteraction,
    TextInputStyle,
} from 'discord.js';

/**
 * A pseudo-command that implements a verification system for new members.
 *
 * This system checks the account age of new members. If an account is newer than a configured minimum age,
 * the member is assigned a temporary "verification" role and a notification is sent to a designated channel.
 * A cron job runs periodically to check if these members have passed the minimum account age; if so,
 * the verification role is removed.
 *
 * The command is highly configurable through the settings UI, allowing administrators to:
 * - Enable or disable the verification system.
 * - Set the channel for notifications.
 * - Define the verification role.
 * - Customize the notification message.
 * - Set the minimum account age in days.
 */
export default class VerificationCommand extends CustomizableCommand {
    // ============================ HEADER ============================ //
    constructor() {
        super({ name: 'verification', is_admin_command: true });
        this.base_cmd_data = null;
    }

    public async prepareCommandData(guild_id: bigint): Promise<void> {
        this.log('debug', 'prepare.start', { name: this.name, guild: guild_id });
        const guild = await this.db.getGuild(guild_id);
        const system_user = await this.db.getUser(BigInt(0));
        let verification_system = await this.db.findOne(VerificationSystem, { where: { from_guild: guild! } });
        if (!verification_system) {
            verification_system = new VerificationSystem();
            verification_system.is_enabled = false;
            verification_system.from_guild = guild!;
            verification_system.latest_action_from_user = system_user!;
            verification_system = await this.db.save(VerificationSystem, verification_system);
            this.log('log', 'prepare.database.success', { name: this.name, guild: guild_id });
        }
        this.enabled = verification_system.is_enabled;
        this.log('debug', 'prepare.success', { name: this.name, guild: guild_id });
    }
    // ================================================================ //

    // =========================== EXECUTE ============================ //
    /**
     * A periodic cron job that checks the status of members currently in verification.
     * This method runs every minute as defined by the `@Cron` decorator.
     * It iterates through all tracked verifications and removes the verification role from members
     * whose accounts have now reached the minimum required age.
     */
    @Cron({ schedule: '* * * * *' })
    public async routineCheck(): Promise<void> {
        this.log('debug', 'cronjob.start');
        const guilds = await this.db.find(Guilds);
        const client = BotClient.client;
        let verified_count = 0;
        for (const guild of guilds) {
            const verification_system = await this.db.findOne(VerificationSystem, { where: { from_guild: guild } });
            if (!verification_system || !verification_system.is_enabled) continue;
            const verifications = await this.db.find(Verification, {
                where: { from_guild: guild },
            });
            for (const verification of verifications) {
                if (verification.remaining_time.getTime() <= Date.now()) {
                    const g = client.guilds.cache.get(guild.gid.toString());
                    if (!g) continue;
                    const member = await g.members.fetch(verification.from_user.uid.toString()).catch(() => null);
                    if (!member) continue;
                    member.roles.remove(verification_system.role_id);
                    verified_count++;
                    await this.db.delete(Verification, { id: verification.id });
                }
            }
        }
        this.log('debug', 'cronjob.success', { guild: guilds.length, count: verified_count });
    }

    /**
     * Prepares data related to a specific member for the verification process.
     * This is a helper method called by the event handlers.
     * @param member The guild member to prepare data for.
     * @returns An object containing message placeholders, the verification system settings, and the member's verification status.
     */
    public async execute(member: GuildMember): Promise<{
        message: { key: string; value: string }[];
        verification_system: VerificationSystem;
        verification: Verification;
    }> {
        const guild = await this.db.getGuild(BigInt(member.guild.id));
        const user = await this.db.getUser(BigInt(member.id));
        const verification_system = (await this.db.findOne(VerificationSystem, { where: { from_guild: guild! } }))!;
        const verification =
            (await this.db.findOne(Verification, { where: { from_user: user!, from_guild: guild! } })) ||
            new Verification();
        const message = [
            { key: '{{user}}', value: `<@${member.id}>` },
            { key: '{{user_id}}', value: member.id },
            { key: '{{guild}}', value: member.guild.name },
            { key: '{{minimum_age}}', value: verification_system.minimum_days.toString() },
        ];
        return { message, verification_system, verification };
    }

    /**
     * Handles the `GuildMemberAdd` event.
     * When a new member joins, it checks if their account is newer than the configured minimum age.
     * If it is, the member is assigned the verification role, a notification is sent, and their status is tracked in the database.
     * @param member The member who just joined.
     */
    @ChainEvent({ type: Events.GuildMemberAdd })
    public async onMemberAdd(member: GuildMember): Promise<void> {
        this.log('debug', 'event.trigger.start', {
            name: 'verification',
            event: 'GuildMemberAdd',
            guild: member.guild,
            member,
        });
        const { message, verification_system, verification } = await this.execute(member);
        if (!verification_system || !verification_system.is_enabled) return;
        if (member.user.createdTimestamp >= Date.now() - verification_system.minimum_days * 86400000) {
            const post_message = message.reduce(
                (msg, replacement) => msg.replaceAll(replacement.key, replacement.value),
                verification_system.message,
            );
            member.roles.add(verification_system.role_id);
            verification.user_created_at = new Date(member.user.createdTimestamp);
            verification.remaining_time = new Date(Date.now() + verification_system.minimum_days * 86400000);
            verification.from_user = (await this.db.getUser(BigInt(member.id)))!;
            verification.from_guild = (await this.db.getGuild(BigInt(member.guild.id)))!;
            await this.db.save(Verification, verification);
            const channel = BotClient.client.channels.cache.get(verification_system.channel_id);
            if (channel!.isSendable()) channel.send({ content: post_message });
        }
        this.log('debug', 'event.trigger.success', {
            name: 'verification',
            event: 'GuildMemberAdd',
            guild: member.guild,
            member: member,
        });
    }

    /**
     * Handles the `GuildMemberRemove` event.
     * If a member who is currently under verification leaves the guild, their tracking record is removed from the database.
     * @param member The member who just left.
     */
    @ChainEvent({ type: Events.GuildMemberRemove })
    public async onMemberRemove(member: GuildMember): Promise<void> {
        this.log('debug', 'event.trigger.start', {
            name: 'verification',
            event: 'GuildMemberRemove',
            guild: member.guild,
            member: member,
        });
        const { verification_system, verification } = await this.execute(member);
        if (!verification_system || !verification_system.is_enabled) return;
        if (!verification.id) return;
        await this.db.delete(Verification, { id: verification.id });
        this.log('debug', 'event.trigger.success', {
            name: 'verification',
            event: 'GuildMemberRemove',
            guild: member.guild,
            member: member,
        });
        return;
    }
    // ================================================================ //

    // =========================== SETTINGS =========================== //
    /**
     * Toggles the verification system on or off for the guild.
     * @param interaction The interaction from the settings select menu.
     */
    @SettingGenericSettingComponent({
        database: VerificationSystem,
        database_key: 'is_enabled',
        format_specifier: '%s',
    })
    public async toggle(interaction: StringSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.toggle.start', { name: this.name, guild: interaction.guild });
        const verification_system = await this.db.findOne(VerificationSystem, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        verification_system!.is_enabled = !verification_system!.is_enabled;
        verification_system!.latest_action_from_user = user;
        verification_system!.timestamp = new Date();
        this.enabled = verification_system!.is_enabled;
        await this.db.save(VerificationSystem, verification_system!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggle.success', {
            name: this.name,
            guild: interaction.guild,
            toggle: this.enabled,
        });
    }

    /**
     * Sets the channel where verification notifications will be sent.
     * @param interaction The interaction from the channel select menu.
     */
    @SettingChannelMenuComponent({
        database: VerificationSystem,
        database_key: 'channel_id',
        format_specifier: '<#%s>',
        options: {
            channel_types: [ChannelType.GuildText],
        },
    })
    public async setTargetChannel(interaction: ChannelSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.channel.start', { name: this.name, guild: interaction.guild });
        const verification_system = (await this.db.findOne(VerificationSystem, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        }))!;
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const selected_channel = interaction.values[0];
        verification_system.channel_id = selected_channel;
        verification_system!.latest_action_from_user = user;
        verification_system!.timestamp = new Date();
        await this.db.save(VerificationSystem, verification_system);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.channel.success', {
            name: this.name,
            guild: interaction.guild,
            channel: selected_channel,
        });
    }

    /**
     * Sets the role to be temporarily assigned to members under verification.
     * Validates that the role is assignable by the bot.
     * @param interaction The interaction from the role select menu.
     */
    @SettingRoleSelectMenuComponent({
        database: VerificationSystem,
        database_key: 'role_id',
        format_specifier: '<@&%s>',
    })
    public async setVerificationRole(interaction: RoleSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.role.start', { name: this.name, guild: interaction.guild });
        const verification_system = await this.db.findOne(VerificationSystem, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;
        const server_roles = interaction.guild!.roles.cache.sort((a, b) => b.position - a.position);
        const bot_role = server_roles.find((r) => r.name === BotClient.client.user!.username)!;
        const requested_role = server_roles.get(interaction.values[0])!;

        if (requested_role.position >= bot_role.position) {
            this.warning = this.t.commands({
                key: 'settings.setverificationrole.role_hierarchy_error',
                guild_id: BigInt(interaction.guildId!),
            });
            await this.settingsUI(interaction);
            return;
        }
        verification_system!.role_id = requested_role.id;
        verification_system!.latest_action_from_user = user;
        verification_system!.timestamp = new Date();
        await this.db.save(VerificationSystem, verification_system!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.role.success', {
            name: this.name,
            guild: interaction.guild,
            role: verification_system!.role_id,
        });
    }

    /**
     * Sets the message that is sent to the notification channel when a new member is put into verification.
     * @param interaction The interaction from the modal submission.
     */
    @SettingModalComponent({
        database: VerificationSystem,
        database_key: 'message',
        format_specifier: '```\n%s\n```',
        inputs: [
            {
                id: 'verification_message',
                style: TextInputStyle.Paragraph,
                required: true,
                max_length: 1000,
            },
        ],
    })
    public async setVerificationSystemMessage(interaction: ModalSubmitInteraction): Promise<void> {
        this.log('debug', 'settings.modalsubmit.start', { name: this.name, guild: interaction.guild });
        const verification_system = await this.db.findOne(VerificationSystem, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const message = interaction.fields.getTextInputValue('verification_message');
        verification_system!.message = message;
        verification_system!.latest_action_from_user = user;
        verification_system!.timestamp = new Date();
        await this.db.save(VerificationSystem, verification_system!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.modalsubmit.success', {
            name: this.name,
            guild: interaction.guild,
        });
    }

    /**
     * Sets the minimum number of days an account must exist to bypass verification.
     * It also recalculates the remaining verification time for all currently tracked members.
     * @param interaction The interaction from the modal submission.
     */
    @SettingModalComponent({
        database: VerificationSystem,
        database_key: 'minimum_days',
        format_specifier: '%s',
        inputs: [
            {
                id: 'minimum_age',
                style: TextInputStyle.Short,
                required: true,
                max_length: 3,
            },
        ],
    })
    public async setVerificationMinimumAge(interaction: ModalSubmitInteraction): Promise<void> {
        this.log('debug', 'settings.modalsubmit.start', { name: this.name, guild: interaction.guild });
        const verification_system = await this.db.findOne(VerificationSystem, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const verifications = await this.db.find(Verification, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const new_age = parseInt(interaction.fields.getTextInputValue('minimum_age'));
        if (isNaN(new_age) || new_age < 0 || new_age > 730) {
            this.warning = this.t.commands({
                key: 'settings.setverificationminimumage.invalid_age',
                replacements: { age: new_age },
                guild_id: BigInt(interaction.guildId!),
            });
            await this.settingsUI(interaction);
            return;
        }

        for (const verification of verifications) {
            const remaining_time = verification.user_created_at.getTime() + new_age * 86400000;
            verification.remaining_time = new Date(remaining_time);
            await this.db.save(Verification, verification);
        }
        verification_system!.minimum_days = new_age;
        verification_system!.latest_action_from_user = user;
        verification_system!.timestamp = new Date();
        await this.db.save(VerificationSystem, verification_system!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.modalsubmit.success', {
            name: this.name,
            guild: interaction.guild,
        });
    }
    // ================================================================ //
}
