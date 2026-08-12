import { BaseCommand } from '@src/types/structure/command';
import pkg from '../../../package.json';
import { Colors, CommandInteraction, EmbedBuilder } from 'discord.js';
import { arch, cpus, freemem, hostname, platform, release, totalmem } from 'node:os';

/**
 * Displays information about the bot's host system and runtime environment.
 *
 * This command gathers and presents system-level metrics in a formatted embed, including:
 * - **Memory Usage (RSS)**: The bot process's resident set size as a percentage of total system memory.
 * - **Memory Usage (System)**: Total system memory usage (used vs. total).
 * - **Uptime**: How long the bot process has been running, formatted as weeks/days/hours/minutes/seconds.
 * - **Host**: Platform, hostname, architecture, kernel release, and CPU model.
 * - **Runtime**: Full version information for the Bun runtime and its embedded libraries.
 *
 * The bot's profile picture is displayed as the embed's thumbnail.
 */
export default class BotInfoCommand extends BaseCommand {
    // ============================ HEADER ============================ //
    constructor() {
        super({ name: 'botinfo', cooldown: 5 });
    }
    // ================================================================ //

    // =========================== EXECUTE ============================ //
    /**
     * Executes the botinfo command.
     *
     * Collects system and runtime metrics, formats them into a single embed with
     * the bot's avatar as the thumbnail, and sends it as a reply.
     *
     * @param interaction The command interaction.
     */
    public async execute(interaction: CommandInteraction): Promise<void> {
        this.log('debug', 'execute.start', {
            guild: interaction.guild,
            user: interaction.user,
        });
        const guild_id = BigInt(interaction.guildId!);
        const client = interaction.client;

        // --- Memory ---
        const rss = process.memoryUsage().rss;
        const sys_total = totalmem();
        const sys_used = sys_total - freemem();
        const rss_percent = Math.round((rss / sys_total) * 100);
        const sys_percent = Math.round((sys_used / sys_total) * 100);

        // --- Uptime ---
        const uptime_sec = Math.floor(process.uptime());
        const parts: string[] = [];
        const weeks = Math.floor(uptime_sec / 604800);
        const days = Math.floor((uptime_sec % 604800) / 86400);
        const hours = Math.floor((uptime_sec % 86400) / 3600);
        const minutes = Math.floor((uptime_sec % 3600) / 60);
        const seconds = uptime_sec % 60;
        if (weeks > 0) parts.push(`${weeks}w`);
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}min`);
        parts.push(`${seconds}s`);
        const uptime_str = parts.join(' ');

        // --- Host ---
        const cpu_model = cpus()[0]?.model ?? 'Unknown';
        const host_str = this.t.commands({
            key: 'execute.host_format',
            replacements: {
                platform: platform(),
                hostname: hostname(),
                arch: arch(),
                release: release(),
                cpu: cpu_model,
            },
            guild_id,
        });

        // --- Runtime ---
        let runtime_str = Object.entries(process.versions)
            .map(([k, v]) => `${k} - \`${v}\``)
            .join(', ');
        if (runtime_str.length > 1024) runtime_str = runtime_str.slice(0, 1021) + '...';

        // --- Build embed ---
        const embed = new EmbedBuilder()
            .setTitle(this.t.commands({ key: 'execute.title', guild_id }))
            .setColor(Colors.Blurple)
            .setThumbnail(client.user!.displayAvatarURL())
            .addFields(
                {
                    name: this.t.commands({ key: 'execute.memory_rss', guild_id }),
                    value: this.t.commands({
                        key: 'execute.memory_format',
                        replacements: {
                            percent: rss_percent,
                            used: this.formatBytes(rss),
                            total: this.formatBytes(sys_total),
                        },
                        guild_id,
                    }),
                },
                {
                    name: this.t.commands({ key: 'execute.memory_system', guild_id }),
                    value: this.t.commands({
                        key: 'execute.memory_format',
                        replacements: {
                            percent: sys_percent,
                            used: this.formatBytes(sys_used),
                            total: this.formatBytes(sys_total),
                        },
                        guild_id,
                    }),
                },
                {
                    name: this.t.commands({ key: 'execute.uptime', guild_id }),
                    value: uptime_str,
                },
                {
                    name: this.t.commands({ key: 'execute.host', guild_id }),
                    value: host_str,
                },
                {
                    name: this.t.commands({ key: 'execute.runtime', guild_id }),
                    value: runtime_str,
                },
            )
            .setFooter({
                text: `${client.user?.tag ?? pkg.name} v${pkg.version}`,
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        this.log('debug', 'execute.success', {
            guild: interaction.guild,
            user: interaction.user,
        });
    }
    // ================================================================ //

    // =========================== HELPERS ============================ //
    /**
     * Formats a byte count into a human-readable string with 2 decimal places.
     * Uses GB for values >= 1 GiB, MB for values >= 1 MiB, otherwise KB.
     * @private
     * @param {number} bytes The byte count to format.
     * @returns {string} The formatted string (e.g., "112.52 MB", "7.55 GB").
     */
    private formatBytes(bytes: number): string {
        const gb = bytes / (1024 * 1024 * 1024);
        const mb = bytes / (1024 * 1024);
        const kb = bytes / 1024;
        if (gb >= 1) return `${gb.toFixed(2)} GB`;
        if (mb >= 1) return `${mb.toFixed(2)} MB`;
        return `${kb.toFixed(2)} KB`;
    }
    // ================================================================ //
}
