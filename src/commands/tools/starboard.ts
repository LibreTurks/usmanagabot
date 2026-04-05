import { StarboardSettings } from '@src/types/database/entities/starboard_settings';
import {
    SettingChannelMenuComponent,
    SettingModalComponent,
    SettingStringSelectComponent,
} from '@src/types/decorator/settingcomponents';
import { CustomizableCommand } from '@src/types/structure/command';
import {
    ChannelSelectMenuInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    ModalSubmitInteraction,
    SlashCommandBuilder,
    StringSelectMenuInteraction,
    TextInputStyle,
} from 'discord.js';
import { CommandLoader } from '..';

export default class StarboardCommand extends CustomizableCommand {
    constructor() {
        super({ name: 'starboard' });
        (this.base_cmd_data as SlashCommandBuilder).addSubcommand((subcommand) =>
            subcommand
                .setName('settings')
                .setDescription(this.t.commands({ key: 'subcommands.settings.description' }))
                .setNameLocalizations(this.getLocalizations('subcommands.settings.name'))
                .setDescriptionLocalizations(this.getLocalizations('subcommands.settings.description')),
        );
    }

    public async prepareCommandData(guild_id: bigint): Promise<void> {
        this.log('debug', 'prepare.start', { name: this.name, guild: guild_id });
        const guild = await this.db.getGuild(guild_id);
        const system_user = await this.db.getUser(BigInt(0));
        let settings = await this.db.findOne(StarboardSettings, { where: { from_guild: guild! } });
        if (!settings) {
            const new_settings = new StarboardSettings();
            new_settings.is_enabled = false;
            new_settings.threshold = 3;
            new_settings.allow_self_star = false;
            new_settings.remove_below_threshold = true;
            new_settings.latest_action_from_user = system_user!;
            new_settings.from_guild = guild!;
            settings = await this.db.save(StarboardSettings, new_settings);
            this.log('log', 'prepare.database.success', { name: this.name, guild: guild_id });
        }
        this.enabled = settings.is_enabled;
        this.log('debug', 'prepare.success', { name: this.name, guild: guild_id });
    }

    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'settings': {
                await this.settingsUI(interaction);
                break;
            }
        }
    }

    @SettingStringSelectComponent({
        database: StarboardSettings,
        database_key: 'is_enabled',
        format_specifier: '%s',
        options: {
            values: [
                { label: 'Yes', description: 'Enable the starboard system' },
                { label: 'No', description: 'Disable the starboard system' },
            ],
        },
    })
    public async toggle(interaction: StringSelectMenuInteraction, args: string): Promise<void> {
        this.log('debug', 'settings.toggle.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(StarboardSettings, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.is_enabled = args === 'Yes';
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        this.enabled = settings!.is_enabled;
        await this.db.save(StarboardSettings, settings!);
        CommandLoader.RESTCommandLoader(this, interaction.guildId!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggle.success', {
            name: this.name,
            guild: interaction.guild,
            toggle: this.enabled,
        });
    }

    @SettingChannelMenuComponent({
        database: StarboardSettings,
        database_key: 'starboard_channel_id',
        format_specifier: '<#%s>',
        options: {
            channel_types: [ChannelType.GuildText],
        },
    })
    public async setStarboardChannel(interaction: ChannelSelectMenuInteraction): Promise<void> {
        this.log('debug', 'settings.channel.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(StarboardSettings, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.starboard_channel_id = BigInt(interaction.values[0]);
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(StarboardSettings, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.channel.success', {
            name: this.name,
            guild: interaction.guild,
            channel: settings!.starboard_channel_id,
        });
    }

    @SettingModalComponent({
        database: StarboardSettings,
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
        const settings = await this.db.findOne(StarboardSettings, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const thresholdValue = interaction.fields.getTextInputValue('threshold');
        const threshold = parseInt(thresholdValue, 10);

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
        await this.db.save(StarboardSettings, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.threshold.success', {
            name: this.name,
            guild: interaction.guild,
            threshold: settings!.threshold,
        });
    }

    @SettingModalComponent({
        database: StarboardSettings,
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
        const settings = await this.db.findOne(StarboardSettings, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        const emojiValue = interaction.fields.getTextInputValue('emoji');

        settings!.emoji = emojiValue;
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(StarboardSettings, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.emoji.success', {
            name: this.name,
            guild: interaction.guild,
            emoji: settings!.emoji,
        });
    }

    @SettingStringSelectComponent({
        database: StarboardSettings,
        database_key: 'allow_self_star',
        format_specifier: '%s',
        options: {
            values: [
                { label: 'Yes', description: 'Users can star their own messages' },
                { label: 'No', description: 'Users cannot star their own messages' },
            ],
        },
    })
    public async toggleSelfStar(interaction: StringSelectMenuInteraction, args: string): Promise<void> {
        this.log('debug', 'settings.toggleselfstar.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(StarboardSettings, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.allow_self_star = args === 'Yes';
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(StarboardSettings, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggleselfstar.success', {
            name: this.name,
            guild: interaction.guild,
            allow_self_star: settings!.allow_self_star,
        });
    }

    @SettingStringSelectComponent({
        database: StarboardSettings,
        database_key: 'remove_below_threshold',
        format_specifier: '%s',
        options: {
            values: [
                { label: 'Yes', description: 'Remove messages when below threshold' },
                { label: 'No', description: 'Keep messages even when below threshold' },
            ],
        },
    })
    public async toggleRemoveBelowThreshold(interaction: StringSelectMenuInteraction, args: string): Promise<void> {
        this.log('debug', 'settings.toggleremove.start', { name: this.name, guild: interaction.guild });
        const settings = await this.db.findOne(StarboardSettings, {
            where: { from_guild: { gid: BigInt(interaction.guildId!) } },
        });
        const user = (await this.db.getUser(BigInt(interaction.user.id)))!;

        settings!.remove_below_threshold = args === 'Yes';
        settings!.latest_action_from_user = user;
        settings!.timestamp = new Date();
        await this.db.save(StarboardSettings, settings!);
        await this.settingsUI(interaction);
        this.log('debug', 'settings.toggleremove.success', {
            name: this.name,
            guild: interaction.guild,
            remove_below_threshold: settings!.remove_below_threshold,
        });
    }
}
