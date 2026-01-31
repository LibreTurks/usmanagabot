import { BaseCommand } from '@src/types/structure/command';
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

/**
 * A command that randomly selects one item from a user-provided list.
 *
 * This command takes at least two items and an optional list of extra items,
 * then replies with a single randomly chosen item from the combined list.
 */
export default class RandomizerCommand extends BaseCommand {
    // =========================== HEADER ============================ //
    constructor() {
        super({ name: 'randomizer', cooldown: 5 });

        (this.base_cmd_data as SlashCommandBuilder)
            .addStringOption((option) =>
                option
                    .setName('item_1')
                    .setDescription(this.t.commands({ key: 'parameters.first.description' }))
                    .setNameLocalizations(this.getLocalizations('parameters.first.name'))
                    .setDescriptionLocalizations(this.getLocalizations('parameters.first.description'))
                    .setRequired(true),
            )
            .addStringOption((option) =>
                option
                    .setName('item_2')
                    .setDescription(this.t.commands({ key: 'parameters.second.description' }))
                    .setNameLocalizations(this.getLocalizations('parameters.second.name'))
                    .setDescriptionLocalizations(this.getLocalizations('parameters.second.description'))
                    .setRequired(true),
            )
            .addStringOption((option) =>
                option
                    .setName('extra_items')
                    .setDescription(this.t.commands({ key: 'parameters.other.description' }))
                    .setNameLocalizations(this.getLocalizations('parameters.other.name'))
                    .setDescriptionLocalizations(this.getLocalizations('parameters.other.description'))
                    .setRequired(false),
            );
    }
    // ================================================================ //

    // =========================== EXECUTE ============================ //
    /**
     * The execution logic for the `randomizer` command.
     * It collects all provided items, randomly selects one, and sends it as a reply.
     * @param interaction The chat input command interaction.
     */
    public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        const item_1 = interaction.options.getString('item_1')!;
        const item_2 = interaction.options.getString('item_2')!;
        const extra_items = interaction.options.getString('extra_items');

        const choices: string[] = [item_1, item_2];

        if (extra_items) choices.push(...extra_items.split(/,| /));

        const random = choices[Math.floor(Math.random() * choices.length)];
        await interaction.reply({
            content: this.t.commands({
                key: 'execute.result',
                replacements: { result: random },
                guild_id: BigInt(interaction.guildId!),
            }),
            allowedMentions: { parse: [] },
        });
    }
    // ================================================================ //
}
